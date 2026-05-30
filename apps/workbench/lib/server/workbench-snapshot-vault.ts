import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import {
  FigmaImportGovernanceError,
  FigmaRestFetchError,
  FigmaStagedImportError,
  classifyFigmaRateLimitRemediation,
  importStagedFigmaSnapshot,
  parseFigmaUrl,
  queryFigmaSnapshotNodeIndex,
  type FigmaImportBudgetPolicyInput,
  type FigmaImportRateLimitDiagnostics,
  validateFigmaSnapshotImportStatus,
  validateFigmaSnapshotManifest,
  validateFigmaSnapshotNodeIndex,
  validateFigmaSnapshotPreviewManifest,
} from "@oscharko-dev/ti-core-engine";
import { resolveFigmaSnapshotRunSource } from "@oscharko-dev/ti-production-runner";
import type {
  FigmaSnapshotImportStatus,
  FigmaSnapshotManifest,
  FigmaSnapshotNodeIndex,
  FigmaSnapshotNodeRecord,
  FigmaSnapshotPreviewManifest,
} from "@oscharko-dev/ti-contracts";
import isPathInside from "is-path-inside";
import { looksLikeFigmaDesignUrl } from "@/lib/runs-form";
import type {
  SnapshotImportAction,
  WorkbenchSnapshotCatalogRow,
  WorkbenchSnapshotBudgetSummary,
  WorkbenchSnapshotCredentialSummary,
  WorkbenchSnapshotDetail,
  WorkbenchSnapshotFailureClass,
  WorkbenchSnapshotImportJob,
  WorkbenchSnapshotNodeSummary,
  WorkbenchSnapshotPreviewTileSummary,
  WorkbenchSnapshotRateLimitSummary,
  WorkbenchSnapshotSearchResponse,
  WorkbenchSnapshotSelectionPreview,
} from "@/lib/snapshot-vault";
import type { SnapshotRunSelection } from "@/lib/types";
import { readPersistedWorkbenchSettingsOverrides } from "./workbench-settings-store";
import {
  mergeWorkbenchEnvWithSettings,
  resolveRepoRoot,
} from "./workbench-run-validation";
import {
  formatWorkbenchTenantScope,
  resolveWorkbenchTenantScope,
} from "./workbench-tenant-scope";
import {
  persistImportedSnapshot,
  readPersistedSnapshotIndex,
  resolvePersistedSummaryForSnapshot,
  synthesizePersistedCatalogRow,
} from "./workbench-snapshot-persistence";

const SNAPSHOT_ROOT_SEGMENT = ".test-intelligence";
const SNAPSHOT_DIRNAME = "figma-snapshots";
const MANIFEST_FILENAME = "manifest.json";
const NODE_INDEX_FILENAME = "node-index.json";
const PREVIEW_MANIFEST_FILENAME = "preview-manifest.json";
const IMPORT_STATUS_FILENAME = "import-status.json";
const MAX_SEARCH_RESULTS = 120;
const MAX_SAMPLE_NODES = 24;
const MAX_TRACE_ANCHORS = 24;
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/u;

type SnapshotArtifacts = {
  manifest: FigmaSnapshotManifest;
  nodeIndex: FigmaSnapshotNodeIndex;
  importStatus: FigmaSnapshotImportStatus;
  previewManifest?: FigmaSnapshotPreviewManifest;
  vaultPath: string;
};

type WorkbenchSnapshotImportStore = {
  activeJobIdsByTenant: Map<string, string>;
  jobs: Map<string, WorkbenchSnapshotImportRecord>;
};

type WorkbenchSnapshotImportRecord = {
  job: WorkbenchSnapshotImportJob;
  promise?: Promise<void>;
};

export class WorkbenchSnapshotVaultError extends Error {
  readonly status: number;
  readonly code: string;
  readonly failureClass?: WorkbenchSnapshotFailureClass;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    failureClass?: WorkbenchSnapshotFailureClass;
  }) {
    super(sanitizeDiagnostic(input.message));
    this.name = "WorkbenchSnapshotVaultError";
    this.status = input.status;
    this.code = input.code;
    if (input.failureClass !== undefined) {
      this.failureClass = input.failureClass;
    }
  }
}

const globalForSnapshots = globalThis as typeof globalThis & {
  __TI_WORKBENCH_SNAPSHOT_IMPORT_STORE__?: WorkbenchSnapshotImportStore;
};

const getImportStore = (): WorkbenchSnapshotImportStore => {
  if (globalForSnapshots.__TI_WORKBENCH_SNAPSHOT_IMPORT_STORE__ === undefined) {
    globalForSnapshots.__TI_WORKBENCH_SNAPSHOT_IMPORT_STORE__ = {
      activeJobIdsByTenant: new Map<string, string>(),
      jobs: new Map<string, WorkbenchSnapshotImportRecord>(),
    };
  }
  return globalForSnapshots.__TI_WORKBENCH_SNAPSHOT_IMPORT_STORE__;
};

export const resetWorkbenchSnapshotImportStoreForTests = (): void => {
  globalForSnapshots.__TI_WORKBENCH_SNAPSHOT_IMPORT_STORE__ = {
    activeJobIdsByTenant: new Map<string, string>(),
    jobs: new Map<string, WorkbenchSnapshotImportRecord>(),
  };
};

export const getWorkbenchSnapshotImportJob = (
  jobId: string,
  env: NodeJS.ProcessEnv = process.env,
): WorkbenchSnapshotImportJob | undefined => {
  const record = getImportStore().jobs.get(jobId);
  if (record === undefined) return undefined;
  return record.job.tenantScope ===
    formatWorkbenchTenantScope(resolveWorkbenchTenantScope(env))
    ? record.job
    : undefined;
};

export const getWorkbenchSnapshotImportCompletionForTests = (
  jobId: string,
): Promise<void> | undefined => getImportStore().jobs.get(jobId)?.promise;

export const listWorkbenchSnapshots = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkbenchSnapshotCatalogRow[]> => {
  const artifacts = await discoverSnapshotArtifacts(env);
  // Reconcile the disk vault (authoritative for rows/bytes) with the durable
  // SQLite index so persisted-but-evicted snapshots survive a restart and every
  // row reports its persisted node-index integrity. Joined by engine snapshotId.
  const persisted = readPersistedSnapshotIndex(
    storageEnvForRepoRoot(resolveRepoRoot(env)),
    formatWorkbenchTenantScope(resolveWorkbenchTenantScope(env)),
  );
  const diskRows = artifacts.map((snapshot) => ({
    ...toCatalogRow(snapshot),
    persistedNodeIndex: resolvePersistedSummaryForSnapshot(
      persisted,
      snapshot.manifest.snapshotId,
    ),
  }));
  const onDisk = new Set(diskRows.map((row) => row.snapshotId));
  const persistedOnly = [...persisted.bySnapshotId.values()]
    .filter((record) => !onDisk.has(record.source))
    .map((record) => synthesizePersistedCatalogRow(persisted, record));
  return [...diskRows, ...persistedOnly].sort((a, b) => {
    const byTime = b.importedAt.localeCompare(a.importedAt);
    return byTime === 0 ? a.snapshotId.localeCompare(b.snapshotId) : byTime;
  });
};

export const getWorkbenchSnapshotDetail = async (
  snapshotId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkbenchSnapshotDetail> => {
  const artifacts = await readSnapshotArtifacts(snapshotId, env);
  return {
    snapshot: toCatalogRow(artifacts),
    pages: summarizePages(artifacts.nodeIndex.nodes),
    frames: summarizeFrames(artifacts.nodeIndex.nodes),
    sampleNodes: artifacts.nodeIndex.nodes
      .filter((node) => node.visible)
      .slice(0, MAX_SAMPLE_NODES)
      .map((node) => toNodeSummary(node)),
    previewTiles: summarizePreviewTiles(artifacts.previewManifest),
  };
};

export const searchWorkbenchSnapshot = async ({
  snapshotId,
  query,
  includeHidden = false,
  env = process.env,
}: {
  snapshotId: string;
  query: string;
  includeHidden?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<WorkbenchSnapshotSearchResponse> => {
  const artifacts = await readSnapshotArtifacts(snapshotId, env);
  const q = query.trim();
  if (q.length === 0) {
    throw new WorkbenchSnapshotVaultError({
      status: 400,
      code: "SNAPSHOT_QUERY_INVALID",
      message: "Snapshot search query must be non-empty.",
    });
  }
  const records = new Map(
    artifacts.nodeIndex.nodes.map((node) => [node.nodeId, node]),
  );
  const hits = queryFigmaSnapshotNodeIndex({
    nodeIndex: artifacts.nodeIndex,
    query: q,
    includeHidden,
    limit: MAX_SEARCH_RESULTS,
  });
  return {
    snapshot: toCatalogRow(artifacts),
    query: q,
    results: hits.flatMap((hit) => {
      const record = records.get(hit.nodeId);
      if (record === undefined) return [];
      return [
        toNodeSummary(
          record,
          hit.matches.map((match) => `${match.kind}:${match.field}`),
        ),
      ];
    }),
  };
};

export const previewWorkbenchSnapshotSelection = async ({
  snapshotId,
  selection,
  env = process.env,
}: {
  snapshotId: string;
  selection: SnapshotRunSelection;
  env?: NodeJS.ProcessEnv;
}): Promise<WorkbenchSnapshotSelectionPreview> => {
  const repoRoot = resolveRepoRoot(env);
  const resolved = await resolveFigmaSnapshotRunSource({
    workspaceRoot: repoRoot,
    tenantScope: resolveWorkbenchTenantScope(env),
    snapshotId,
    selection: {
      nodeIds: selection.nodeIds,
      pageIds: selection.pageIds,
      frameIds: selection.frameIds,
    },
  });
  return {
    snapshotId,
    scopeDigest: resolved.auditRef.scopeDigest,
    payloadBytes: resolved.payloadBytes,
    resolvedNodeCount: resolved.auditRef.selectedNodeIds.length,
    requestedSelection: selection,
    traceAnchors: resolved.traceAnchors.slice(0, MAX_TRACE_ANCHORS),
  };
};

export const startWorkbenchSnapshotImport = async ({
  body,
  env = process.env,
  fetchImpl,
}: {
  body: unknown;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<WorkbenchSnapshotImportJob> => {
  const input = await parseImportRequest(body, env);
  const store = getImportStore();
  const tenantScopeKey = formatWorkbenchTenantScope(input.tenantScope);
  const activeJobId = store.activeJobIdsByTenant.get(tenantScopeKey);
  if (activeJobId !== undefined) {
    const active = store.jobs.get(activeJobId);
    if (
      active !== undefined &&
      (active.job.status === "queued" || active.job.status === "running")
    ) {
      throw new WorkbenchSnapshotVaultError({
        status: 409,
        code: "SNAPSHOT_IMPORT_ALREADY_ACTIVE",
        message: "Another snapshot import or refresh is already active.",
      });
    }
  }
  const queuedAt = new Date().toISOString();
  const record: WorkbenchSnapshotImportRecord = {
    job: {
      jobId: `ti-snapshot-${randomUUID()}`,
      action: input.action,
      status: "queued",
      queueState: "queued",
      sourceUrlHash: input.sourceUrlHash,
      tenantScope: tenantScopeKey,
      queuedAt,
    },
  };
  store.jobs.set(record.job.jobId, record);
  store.activeJobIdsByTenant.set(tenantScopeKey, record.job.jobId);
  record.promise = executeSnapshotImport({
    record,
    input,
    store,
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
  });
  return { ...record.job };
};

const executeSnapshotImport = async ({
  record,
  input,
  fetchImpl,
  store,
}: {
  record: WorkbenchSnapshotImportRecord;
  input: ResolvedSnapshotImportRequest;
  fetchImpl?: typeof fetch;
  store: WorkbenchSnapshotImportStore;
}): Promise<void> => {
  record.job = {
    ...record.job,
    status: "running",
    queueState: "running",
    startedAt: new Date().toISOString(),
  };
  try {
    await mkdir(path.join(input.repoRoot, SNAPSHOT_ROOT_SEGMENT), {
      recursive: true,
    });
    const result = await importStagedFigmaSnapshot({
      workspaceRoot: input.repoRoot,
      tenantScope: input.tenantScope,
      credential: {
        authMode: input.credentialMode,
        accessToken: input.accessToken,
      },
      figmaUrl: input.figmaUrl,
      reuseCache: input.action !== "refresh",
      ...(input.caCertPath !== undefined
        ? { caCertPath: input.caCertPath }
        : {}),
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
      ...(input.budgetPolicy !== undefined
        ? { budgetPolicy: input.budgetPolicy }
        : {}),
    });
    const credential = toCredentialSummary(result.importStatus);
    const budget = toBudgetSummary(result.importStatus);
    const rateLimit =
      toRateLimitSummaryFromDiagnostics(result.rateLimitDiagnostics) ??
      toRateLimitSummary(result.importStatus);
    record.job = {
      ...record.job,
      status: "completed",
      queueState: "idle",
      completedAt: new Date().toISOString(),
      snapshotId: result.snapshotId,
      rateLimit,
      ...(credential !== undefined ? { credential } : {}),
      ...(budget !== undefined ? { budget } : {}),
      ...(result.importStatus.failureClass !== undefined
        ? { failureClass: result.importStatus.failureClass }
        : {}),
      message: `Snapshot ${result.snapshotId} is available in the local vault.`,
    };
    // Best-effort durable index write AFTER a successful import only; failures
    // are logged operator-safely inside and never reach this success path. WHY
    // pin WORKBENCH_REPO_ROOT to the resolved import root: the content store
    // (writeArtifact) and the storage adapter must resolve to the same artifact
    // root the engine just wrote under.
    persistImportedSnapshot({
      manifest: result.manifest,
      nodeIndex: result.nodeIndex,
      importStatus: result.importStatus,
      env: storageEnvForRepoRoot(input.repoRoot),
    });
  } catch (error) {
    const importError =
      error instanceof FigmaStagedImportError ? error : undefined;
    const checkpoint = importError?.checkpoint;
    const rateLimit =
      toRateLimitSummaryFromDiagnostics(importError?.rateLimitDiagnostics) ??
      toRateLimitSummaryFromError(error) ??
      (checkpoint === undefined ? undefined : toRateLimitSummary(checkpoint));
    const credential =
      checkpoint === undefined ? undefined : toCredentialSummary(checkpoint);
    const budget =
      checkpoint === undefined ? undefined : toBudgetSummary(checkpoint);
    record.job = {
      ...record.job,
      status: "failed",
      queueState: "idle",
      completedAt: new Date().toISOString(),
      message: sanitizeDiagnostic(
        error instanceof Error ? error.message : "Snapshot import failed.",
      ),
      failureClass: classifyWorkbenchImportFailure(error),
      ...(rateLimit !== undefined ? { rateLimit } : {}),
      ...(credential !== undefined ? { credential } : {}),
      ...(budget !== undefined ? { budget } : {}),
    };
  } finally {
    const tenantScopeKey = formatWorkbenchTenantScope(input.tenantScope);
    if (store.activeJobIdsByTenant.get(tenantScopeKey) === record.job.jobId) {
      store.activeJobIdsByTenant.delete(tenantScopeKey);
    }
  }
};

interface ResolvedSnapshotImportRequest {
  action: SnapshotImportAction;
  figmaUrl: string;
  sourceUrlHash: string;
  repoRoot: string;
  accessToken: string;
  credentialMode: string;
  budgetPolicy?: FigmaImportBudgetPolicyInput;
  tenantScope: ReturnType<typeof resolveWorkbenchTenantScope>;
  caCertPath?: string;
}

const parseImportRequest = async (
  body: unknown,
  env: NodeJS.ProcessEnv,
): Promise<ResolvedSnapshotImportRequest> => {
  if (typeof body !== "object" || body === null) {
    throw new WorkbenchSnapshotVaultError({
      status: 400,
      code: "SNAPSHOT_IMPORT_REQUEST_INVALID",
      message: "Request body must be a snapshot import object.",
    });
  }
  const raw = body as Record<string, unknown>;
  const figmaUrl = typeof raw.figmaUrl === "string" ? raw.figmaUrl.trim() : "";
  const figma = looksLikeFigmaDesignUrl(figmaUrl);
  if (!figma.ok) {
    throw new WorkbenchSnapshotVaultError({
      status: 400,
      code: "SNAPSHOT_IMPORT_FIGMA_URL_INVALID",
      message: figma.reason ?? "Figma URL is invalid.",
    });
  }
  const action: SnapshotImportAction =
    raw.action === "refresh" ? "refresh" : "import";
  const parsedFigmaUrl = parseFigmaUrl(figmaUrl);
  const persistedSettings = await readPersistedWorkbenchSettingsOverrides(env);
  const merged = mergeWorkbenchEnvWithSettings(env, persistedSettings);
  const accessToken =
    merged.TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN?.trim() ||
    merged.FIGMA_ACCESS_TOKEN?.trim();
  if (accessToken === undefined || accessToken.length === 0) {
    throw new WorkbenchSnapshotVaultError({
      status: 503,
      code: "SNAPSHOT_IMPORT_FIGMA_TOKEN_MISSING",
      failureClass: "missing_credential",
      message:
        "Snapshot import requires TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN or FIGMA_ACCESS_TOKEN.",
    });
  }
  const credentialMode =
    merged.TEST_INTELLIGENCE_FIGMA_CREDENTIAL_MODE?.trim() ||
    "personal_access_token";
  const repoRoot = resolveRepoRoot(merged);
  const budgetPolicy = resolveImportBudgetPolicy(merged);
  return {
    action,
    figmaUrl,
    sourceUrlHash: sha256Hex({
      kind: "figma_source",
      fileKey: parsedFigmaUrl.fileKey,
      ...(parsedFigmaUrl.nodeId !== undefined
        ? { nodeId: parsedFigmaUrl.nodeId }
        : {}),
    }),
    repoRoot,
    accessToken,
    credentialMode,
    ...(budgetPolicy !== undefined ? { budgetPolicy } : {}),
    tenantScope: resolveWorkbenchTenantScope(merged),
    ...((await resolveOptionalWorkspacePath({
      repoRoot,
      value: merged.NODE_EXTRA_CA_CERTS?.trim(),
      label: "NODE_EXTRA_CA_CERTS",
    })) ?? {}),
  };
};

const resolveImportBudgetPolicy = (
  env: NodeJS.ProcessEnv,
): FigmaImportBudgetPolicyInput | undefined => {
  const windowSeconds = readPositiveIntegerEnv(
    env,
    "TEST_INTELLIGENCE_FIGMA_IMPORT_WINDOW_SECONDS",
  );
  const maxRequestsPerWindow = readPositiveIntegerEnv(
    env,
    "TEST_INTELLIGENCE_FIGMA_IMPORT_MAX_REQUESTS_PER_WINDOW",
  );
  const fileBootstrap = readPositiveIntegerEnv(
    env,
    "TEST_INTELLIGENCE_FIGMA_IMPORT_FILE_BOOTSTRAP_REQUESTS_PER_WINDOW",
  );
  const nodeBatch = readPositiveIntegerEnv(
    env,
    "TEST_INTELLIGENCE_FIGMA_IMPORT_NODE_BATCH_REQUESTS_PER_WINDOW",
  );
  const imageMetadata = readPositiveIntegerEnv(
    env,
    "TEST_INTELLIGENCE_FIGMA_IMPORT_IMAGE_METADATA_REQUESTS_PER_WINDOW",
  );
  const minimumDelayMs = readNonNegativeIntegerEnv(
    env,
    "TEST_INTELLIGENCE_FIGMA_IMPORT_MINIMUM_DELAY_MS",
  );
  const resourceMaxRequestsPerWindow = {
    ...(fileBootstrap !== undefined ? { file_bootstrap: fileBootstrap } : {}),
    ...(nodeBatch !== undefined ? { node_batch: nodeBatch } : {}),
    ...(imageMetadata !== undefined ? { image_metadata: imageMetadata } : {}),
  };
  const policy: FigmaImportBudgetPolicyInput = {
    ...(windowSeconds !== undefined ? { windowSeconds } : {}),
    ...(maxRequestsPerWindow !== undefined ? { maxRequestsPerWindow } : {}),
    ...(Object.keys(resourceMaxRequestsPerWindow).length > 0
      ? { resourceMaxRequestsPerWindow }
      : {}),
    ...(minimumDelayMs !== undefined ? { minimumDelayMs } : {}),
  };
  return Object.keys(policy).length === 0 ? undefined : policy;
};

const readPositiveIntegerEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
): number | undefined => readIntegerEnv(env, key, 1);

const readNonNegativeIntegerEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
): number | undefined => readIntegerEnv(env, key, 0);

const readIntegerEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
  minimum: number,
): number | undefined => {
  const raw = env[key]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new WorkbenchSnapshotVaultError({
      status: 400,
      code: "SNAPSHOT_IMPORT_BUDGET_INVALID",
      message: `${key} must be an integer greater than or equal to ${minimum}.`,
    });
  }
  return value;
};

const resolveOptionalWorkspacePath = async ({
  repoRoot,
  value,
  label,
}: {
  repoRoot: string;
  value: string | undefined;
  label: string;
}): Promise<{ caCertPath: string } | undefined> => {
  if (value === undefined || value.length === 0) return undefined;
  if (
    path.isAbsolute(value) ||
    WINDOWS_ABSOLUTE_PATH.test(value) ||
    value.includes("\0")
  ) {
    throw new WorkbenchSnapshotVaultError({
      status: 400,
      code: "SNAPSHOT_IMPORT_PATH_INVALID",
      message: `${label} must be a workspace-relative path.`,
    });
  }
  const normalized = path.normalize(value);
  if (normalized === "." || normalized.startsWith("..")) {
    throw new WorkbenchSnapshotVaultError({
      status: 400,
      code: "SNAPSHOT_IMPORT_PATH_INVALID",
      message: `${label} must stay inside the workspace.`,
    });
  }
  const candidate = path.join(repoRoot, normalized);
  const info = await lstat(candidate).catch(() => null);
  if (info === null || !info.isFile() || info.isSymbolicLink()) {
    throw new WorkbenchSnapshotVaultError({
      status: 400,
      code: "SNAPSHOT_IMPORT_PATH_INVALID",
      message: `${label} must point to a workspace-local file.`,
    });
  }
  const [realRepoRoot, realCandidate] = await Promise.all([
    realpath(repoRoot),
    realpath(candidate),
  ]);
  if (!isPathInside(realCandidate, realRepoRoot)) {
    throw new WorkbenchSnapshotVaultError({
      status: 400,
      code: "SNAPSHOT_IMPORT_PATH_INVALID",
      message: `${label} must stay inside the workspace.`,
    });
  }
  return { caCertPath: realCandidate };
};

/**
 * Pins `WORKBENCH_REPO_ROOT` to the resolved import root so the durable
 * persistence layer (content store + SQLite adapter) resolves to the SAME
 * artifact root the engine wrote the snapshot under, in both production and the
 * hermetic temp-root tests.
 */
const storageEnvForRepoRoot = (repoRoot: string): NodeJS.ProcessEnv => ({
  ...process.env,
  WORKBENCH_REPO_ROOT: repoRoot,
});

const discoverSnapshotArtifacts = async (
  env: NodeJS.ProcessEnv,
): Promise<SnapshotArtifacts[]> => {
  const repoRoot = resolveRepoRoot(env);
  const tenantScope = resolveWorkbenchTenantScope(env);
  const tenantRoot = snapshotTenantRoot(repoRoot, tenantScope);
  const exists = await stat(tenantRoot)
    .then((info) => info.isDirectory())
    .catch(() => false);
  if (!exists) return [];
  const realRepoRoot = await realpath(repoRoot);
  const realTenantRoot = await realpath(tenantRoot);
  if (!isPathInside(realTenantRoot, realRepoRoot)) return [];
  const artifacts: SnapshotArtifacts[] = [];
  for (const fileKeyEntry of await readdir(realTenantRoot, {
    withFileTypes: true,
  })) {
    if (!fileKeyEntry.isDirectory()) continue;
    const fileKeyPath = path.join(realTenantRoot, fileKeyEntry.name);
    for (const snapshotEntry of await readdir(fileKeyPath, {
      withFileTypes: true,
    }).catch(() => [])) {
      if (!snapshotEntry.isDirectory()) continue;
      const vaultPath = path.join(fileKeyPath, snapshotEntry.name);
      const snapshot = await readArtifactsAtVaultPath(vaultPath).catch(
        () => undefined,
      );
      if (snapshot !== undefined) artifacts.push(snapshot);
    }
  }
  return artifacts;
};

const readSnapshotArtifacts = async (
  snapshotId: string,
  env: NodeJS.ProcessEnv,
): Promise<SnapshotArtifacts> => {
  if (
    !/^[A-Za-z0-9._-]+$/u.test(snapshotId) ||
    snapshotId === "." ||
    snapshotId === ".."
  ) {
    throw new WorkbenchSnapshotVaultError({
      status: 400,
      code: "SNAPSHOT_ID_INVALID",
      message: "Snapshot ID is invalid.",
    });
  }
  const matches = (await discoverSnapshotArtifacts(env)).filter(
    (candidate) => candidate.manifest.snapshotId === snapshotId,
  );
  if (matches.length === 0) {
    throw new WorkbenchSnapshotVaultError({
      status: 404,
      code: "SNAPSHOT_NOT_FOUND",
      message: "Snapshot was not found for the active tenant scope.",
    });
  }
  if (matches.length > 1) {
    throw new WorkbenchSnapshotVaultError({
      status: 409,
      code: "SNAPSHOT_ID_AMBIGUOUS",
      message: "Snapshot ID resolved to multiple local vault entries.",
    });
  }
  return matches[0]!;
};

const readArtifactsAtVaultPath = async (
  vaultPath: string,
): Promise<SnapshotArtifacts> => {
  const realVaultPath = await realpath(vaultPath);
  const [manifest, nodeIndex, importStatus, previewManifest] =
    await Promise.all([
      readSnapshotJson(
        realVaultPath,
        MANIFEST_FILENAME,
        validateFigmaSnapshotManifest,
      ),
      readSnapshotJson(
        realVaultPath,
        NODE_INDEX_FILENAME,
        validateFigmaSnapshotNodeIndex,
      ),
      readSnapshotJson(
        realVaultPath,
        IMPORT_STATUS_FILENAME,
        validateFigmaSnapshotImportStatus,
      ),
      readOptionalSnapshotJson(
        realVaultPath,
        PREVIEW_MANIFEST_FILENAME,
        validateFigmaSnapshotPreviewManifest,
      ),
    ]);
  if (
    manifest.snapshotId !== nodeIndex.snapshotId ||
    manifest.snapshotId !== importStatus.snapshotId ||
    manifest.source.fileKeyHash !== nodeIndex.source.fileKeyHash ||
    manifest.source.fileKeyHash !== importStatus.source.fileKeyHash ||
    manifest.artifactDigests.nodeIndexDigest !== nodeIndex.contentDigest ||
    manifest.artifactDigests.importStatusDigest !== importStatus.contentDigest
  ) {
    throw new WorkbenchSnapshotVaultError({
      status: 422,
      code: "SNAPSHOT_ARTIFACT_MISMATCH",
      message: "Snapshot artifacts do not share the same validated identity.",
    });
  }
  if (
    previewManifest !== undefined &&
    (previewManifest.snapshotId !== manifest.snapshotId ||
      manifest.artifactDigests.previewManifestDigest !==
        previewManifest.contentDigest)
  ) {
    throw new WorkbenchSnapshotVaultError({
      status: 422,
      code: "SNAPSHOT_PREVIEW_MISMATCH",
      message:
        "Snapshot preview manifest does not match the snapshot manifest.",
    });
  }
  return {
    manifest,
    nodeIndex,
    importStatus,
    ...(previewManifest !== undefined ? { previewManifest } : {}),
    vaultPath: realVaultPath,
  };
};

const readSnapshotJson = async <T>(
  rootPath: string,
  filename: string,
  validate: (value: unknown) => T,
): Promise<T> => {
  const absolute = path.join(rootPath, filename);
  if (!isPathInside(absolute, rootPath)) {
    throw new WorkbenchSnapshotVaultError({
      status: 403,
      code: "SNAPSHOT_PATH_FORBIDDEN",
      message: "Snapshot artifact path escaped the vault root.",
    });
  }
  const info = await lstat(absolute).catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new WorkbenchSnapshotVaultError({
        status: 404,
        code: "SNAPSHOT_ARTIFACT_MISSING",
        message: "Snapshot artifact is missing.",
      });
    }
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new WorkbenchSnapshotVaultError({
      status: 404,
      code: "SNAPSHOT_ARTIFACT_MISSING",
      message: "Snapshot artifact is missing.",
    });
  }
  return validate(JSON.parse(await readFile(absolute, "utf8")) as unknown);
};

const readOptionalSnapshotJson = async <T>(
  rootPath: string,
  filename: string,
  validate: (value: unknown) => T,
): Promise<T | undefined> => {
  try {
    return await readSnapshotJson(rootPath, filename, validate);
  } catch (error) {
    if (
      error instanceof WorkbenchSnapshotVaultError &&
      error.code === "SNAPSHOT_ARTIFACT_MISSING"
    ) {
      return undefined;
    }
    throw error;
  }
};

const snapshotTenantRoot = (
  repoRoot: string,
  tenantScope: ReturnType<typeof resolveWorkbenchTenantScope>,
): string =>
  path.join(
    repoRoot,
    SNAPSHOT_ROOT_SEGMENT,
    SNAPSHOT_DIRNAME,
    ...formatWorkbenchTenantScope(tenantScope).split("/"),
  );

const toCatalogRow = ({
  manifest,
  nodeIndex,
  importStatus,
  previewManifest,
}: SnapshotArtifacts): WorkbenchSnapshotCatalogRow => {
  const pages = new Set(nodeIndex.nodes.map((node) => node.pageId));
  const frames = new Set(
    nodeIndex.nodes
      .map((node) => node.frameId)
      .filter((frameId): frameId is string => frameId !== undefined),
  );
  const componentCount = nodeIndex.nodes.filter(
    (node) =>
      node.nodeType.toUpperCase().includes("COMPONENT") ||
      node.componentHints.length > 0,
  ).length;
  const hiddenCount = nodeIndex.nodes.filter((node) => !node.visible).length;
  const lifecycleState = importStatus.lifecycleState;
  const previewStatus = previewManifest?.previewStatus ?? "not_requested";
  const credential = toCredentialSummary(importStatus);
  const budget = toBudgetSummary(importStatus);
  return {
    snapshotId: manifest.snapshotId,
    tenantScope: formatWorkbenchTenantScope(manifest.tenantScope),
    importedAt: manifest.importedAt,
    importStrategy: manifest.importStrategy,
    lifecycleState,
    previewStatus,
    boundedPreview: previewManifest?.boundedPreview ?? false,
    ...(manifest.figmaVersion !== undefined
      ? { figmaVersion: manifest.figmaVersion }
      : {}),
    ...(manifest.figmaLastModified !== undefined
      ? { figmaLastModified: manifest.figmaLastModified }
      : {}),
    nodeCount: nodeIndex.nodes.length,
    pageCount: pages.size,
    frameCount: frames.size,
    componentCount,
    hiddenCount,
    launchable: lifecycleState === "completed" && nodeIndex.nodes.length > 0,
    cacheState:
      lifecycleState === "completed"
        ? "complete"
        : lifecycleState === "failed"
          ? "failed"
          : "partial",
    rateLimit: toRateLimitSummary(importStatus),
    ...(credential !== undefined ? { credential } : {}),
    ...(budget !== undefined ? { budget } : {}),
    ...(importStatus.failureClass !== undefined
      ? { failureClass: importStatus.failureClass }
      : {}),
  };
};

const summarizePages = (
  nodes: readonly FigmaSnapshotNodeRecord[],
): WorkbenchSnapshotDetail["pages"] =>
  Array.from(
    nodes.reduce((acc, node) => {
      const current = acc.get(node.pageId) ?? {
        pageId: node.pageId,
        pageName: node.pageName,
        frameIds: new Set<string>(),
        nodeCount: 0,
      };
      if (node.frameId !== undefined) current.frameIds.add(node.frameId);
      current.nodeCount += 1;
      acc.set(node.pageId, current);
      return acc;
    }, new Map<string, { pageId: string; pageName: string; frameIds: Set<string>; nodeCount: number }>()),
  )
    .map(([, row]) => ({
      pageId: row.pageId,
      pageName: row.pageName,
      frameCount: row.frameIds.size,
      nodeCount: row.nodeCount,
    }))
    .sort((a, b) => a.pageName.localeCompare(b.pageName));

const summarizeFrames = (
  nodes: readonly FigmaSnapshotNodeRecord[],
): WorkbenchSnapshotDetail["frames"] =>
  Array.from(
    nodes.reduce((acc, node) => {
      if (node.frameId === undefined) return acc;
      const key = `${node.pageId}\0${node.frameId}`;
      const current = acc.get(key) ?? {
        pageId: node.pageId,
        pageName: node.pageName,
        frameId: node.frameId,
        frameName: node.frameName ?? node.frameId,
        nodeCount: 0,
      };
      current.nodeCount += 1;
      acc.set(key, current);
      return acc;
    }, new Map<string, { pageId: string; pageName: string; frameId: string; frameName: string; nodeCount: number }>()),
  )
    .map(([, row]) => row)
    .sort((a, b) => a.frameName.localeCompare(b.frameName));

const summarizePreviewTiles = (
  manifest: FigmaSnapshotPreviewManifest | undefined,
): WorkbenchSnapshotPreviewTileSummary[] =>
  manifest === undefined
    ? []
    : manifest.tiles.slice(0, 96).map((tile) => ({
        tileId: tile.tileId,
        assetId: tile.assetId,
        ...(tile.pageId !== undefined ? { pageId: tile.pageId } : {}),
        ...(tile.frameId !== undefined ? { frameId: tile.frameId } : {}),
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
      }));

const toNodeSummary = (
  node: FigmaSnapshotNodeRecord,
  matches: string[] = [],
): WorkbenchSnapshotNodeSummary => ({
  nodeId: node.nodeId,
  nodeName: node.nodeName,
  nodeType: node.nodeType,
  pageId: node.pageId,
  pageName: node.pageName,
  ...(node.frameId !== undefined ? { frameId: node.frameId } : {}),
  ...(node.frameName !== undefined ? { frameName: node.frameName } : {}),
  visible: node.visible,
  offCanvas: isOffCanvas(node),
  missingBounds: node.bbox === undefined,
  labels: [...node.labels].slice(0, 12),
  componentHints: [...node.componentHints].slice(0, 8),
  ...(node.textSnippet !== undefined ? { textSnippet: node.textSnippet } : {}),
  ...(node.bbox !== undefined ? { bbox: { ...node.bbox } } : {}),
  ...(matches.length > 0 ? { matches } : {}),
});

const isOffCanvas = (node: FigmaSnapshotNodeRecord): boolean =>
  node.bbox !== undefined && (node.bbox.x < 0 || node.bbox.y < 0);

const toRateLimitSummary = (
  status: FigmaSnapshotImportStatus,
): WorkbenchSnapshotRateLimitSummary => ({
  ...(status.rateLimit.retryAfterSeconds !== undefined
    ? { retryAfterSeconds: status.rateLimit.retryAfterSeconds }
    : {}),
  ...(status.rateLimit.remaining !== undefined
    ? { remaining: status.rateLimit.remaining }
    : {}),
  ...(status.rateLimit.resetAt !== undefined
    ? { resetAt: status.rateLimit.resetAt }
    : {}),
});

const toRateLimitSummaryFromDiagnostics = (
  diagnostics: FigmaImportRateLimitDiagnostics | undefined,
): WorkbenchSnapshotRateLimitSummary | undefined =>
  diagnostics === undefined
    ? undefined
    : {
        ...(diagnostics.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: diagnostics.retryAfterSeconds }
          : {}),
        ...(diagnostics.remaining !== undefined
          ? { remaining: diagnostics.remaining }
          : {}),
        ...(diagnostics.resetAt !== undefined
          ? { resetAt: diagnostics.resetAt }
          : {}),
        ...(diagnostics.figmaPlanTier !== undefined
          ? { figmaPlanTier: diagnostics.figmaPlanTier }
          : {}),
        ...(diagnostics.figmaRateLimitType !== undefined
          ? { figmaRateLimitType: diagnostics.figmaRateLimitType }
          : {}),
        ...(diagnostics.figmaUpgradeLinkDigest !== undefined
          ? { figmaUpgradeLinkDigest: diagnostics.figmaUpgradeLinkDigest }
          : {}),
        ...(diagnostics.remediation !== undefined
          ? { remediation: diagnostics.remediation }
          : {}),
      };

const toCredentialSummary = (
  status: FigmaSnapshotImportStatus,
): WorkbenchSnapshotCredentialSummary | undefined =>
  status.credential === undefined ? undefined : { ...status.credential };

const toBudgetSummary = (
  status: FigmaSnapshotImportStatus,
): WorkbenchSnapshotBudgetSummary | undefined =>
  status.budget === undefined ? undefined : { ...status.budget };

const toRateLimitSummaryFromError = (
  error: unknown,
): WorkbenchSnapshotRateLimitSummary | undefined => {
  const restError = findFigmaRestError(error);
  if (restError === undefined) return undefined;
  const summary: WorkbenchSnapshotRateLimitSummary = {
    ...(restError.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: restError.retryAfterSeconds }
      : {}),
    ...(restError.figmaPlanTier !== undefined
      ? { figmaPlanTier: restError.figmaPlanTier }
      : {}),
    ...(restError.figmaRateLimitType !== undefined
      ? { figmaRateLimitType: restError.figmaRateLimitType }
      : {}),
    ...(restError.figmaUpgradeLinkDigest !== undefined
      ? { figmaUpgradeLinkDigest: restError.figmaUpgradeLinkDigest }
      : {}),
  };
  if (
    summary.retryAfterSeconds !== undefined ||
    summary.figmaPlanTier !== undefined ||
    summary.figmaRateLimitType !== undefined
  ) {
    summary.remediation = classifyFigmaRateLimitRemediation({
      ...(summary.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: summary.retryAfterSeconds }
        : {}),
      ...(summary.figmaPlanTier !== undefined
        ? { figmaPlanTier: summary.figmaPlanTier }
        : {}),
      ...(summary.figmaRateLimitType !== undefined
        ? { figmaRateLimitType: summary.figmaRateLimitType }
        : {}),
    });
  }
  return Object.keys(summary).length === 0 ? undefined : summary;
};

const classifyWorkbenchImportFailure = (
  error: unknown,
): WorkbenchSnapshotFailureClass => {
  if (error instanceof FigmaStagedImportError) return error.failureClass;
  if (error instanceof FigmaImportGovernanceError) return error.failureClass;
  const restError = findFigmaRestError(error);
  if (restError !== undefined) {
    switch (restError.errorClass) {
      case "rate_limited":
        return "throttled";
      case "auth_failed":
        return "invalid_credential";
      case "not_found":
        return "not_found";
      case "request_invalid":
      case "parse_error":
      case "ssrf_refused":
        return "invalid_request";
      case "timeout":
      case "transport":
        return "transport";
    }
  }
  return "transport";
};

const findFigmaRestError = (
  error: unknown,
): FigmaRestFetchError | undefined => {
  if (error instanceof FigmaRestFetchError) return error;
  if (error instanceof Error) return findFigmaRestError(error.cause);
  return undefined;
};

const sha256Hex = (value: unknown): string =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

const sanitizeDiagnostic = (value: string): string =>
  value
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(
      /(?:\/[A-Za-z0-9._ -]+(?:\/[A-Za-z0-9._ -]+)+|[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]+)/gu,
      "[local-path]",
    )
    .replace(
      /(api[-_ ]?key|access[-_ ]?token|authorization|figma[-_ ]?token)\s*[:=]\s*\S+/giu,
      "$1=[redacted]",
    )
    .replace(/\bfigd_[A-Za-z0-9_-]{8,}\b/giu, "[redacted]")
    .replace(/\bhttps?:\/\/\S+/giu, "[redacted-url]")
    .slice(0, 700)
    .trim();
