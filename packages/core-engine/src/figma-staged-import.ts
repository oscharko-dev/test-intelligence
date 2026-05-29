import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION,
  FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
  type FigmaSnapshotImportBudgetMetadata,
  type FigmaSnapshotImportChunkInventoryEntry,
  type FigmaSnapshotImportCredentialMetadata,
  type FigmaSnapshotImportFailureClass,
  type FigmaSnapshotImportLifecycleState,
  type FigmaSnapshotImportLimitMetadata,
  type FigmaSnapshotImportPerformanceMetrics,
  type FigmaSnapshotImportRateLimitRemediation,
  type FigmaSnapshotImportStatus,
  type FigmaSnapshotManifest,
  type FigmaSnapshotNodeRecord,
  type FigmaSnapshotNodeIndex,
  type FigmaSnapshotPreviewManifest,
  type FigmaSnapshotSourceIdentifier,
  type TenantScope,
} from "@oscharko-dev/ti-contracts";
import {
  canonicalJson,
  redactHighRiskSecrets,
  sanitizeErrorMessage,
  sha256Hex,
} from "@oscharko-dev/ti-security";

import {
  FigmaRestFetchError,
  fetchFigmaFileForTestIntelligence,
  fetchFigmaImageMetadataForTestIntelligence,
  fetchFigmaNodesForTestIntelligence,
  parseFigmaUrl,
  type FigmaRestImageMetadataRecord,
  type FigmaRestNode,
  type FigmaRestRateLimitMetadata,
} from "./figma-rest-adapter.js";
import {
  FigmaImportGovernanceError,
  classifyFigmaRateLimitRemediation,
  createFigmaImportGovernance,
  resolveFigmaImportCredential,
  type FigmaImportBudgetPolicyInput,
  type FigmaImportCredentialInput,
  type FigmaImportGovernance,
} from "./figma-import-governance.js";
import {
  buildFigmaSnapshotLocalNodeIndex,
  planFigmaSnapshotPreviewCache,
  writeFigmaSnapshotPreviewCacheAssets,
} from "./figma-snapshot-explorer.js";
import {
  buildFigmaSnapshotVaultPath,
  computeFigmaSnapshotArtifactDigest,
  ensureFigmaSnapshotVaultDirectory,
  FigmaSnapshotVaultError,
  serializeFigmaSnapshotArtifact,
  assertFigmaSnapshotVaultPathContained,
  validateFigmaSnapshotImportStatus,
  validateFigmaSnapshotManifest,
} from "./figma-snapshot-vault.js";

const PLANNER_VERSION = "figma-staged-import/v1" as const;
const STAGING_SCHEMA_VERSION = "1.0.0" as const;
const ZERO_DIGEST =
  "0000000000000000000000000000000000000000000000000000000000000000";
const DEFAULT_BOOTSTRAP_DEPTH = 2;
const DEFAULT_NODE_BATCH_SIZE = 8;
const DEFAULT_IMAGE_BATCH_SIZE = 16;
const MAX_PERSISTED_ANCESTOR_NODE_IDS = 128;
const MAX_TEXT_LENGTH = 240;
const FIGMA_NODE_ID_RE = /^[A-Za-z0-9_.:;-]+$/u;
const URI_LIKE_RE =
  /(?:\b[A-Za-z][A-Za-z0-9+.-]*:\/\/|\b(?:mailto|tel|sms|urn|data|javascript):)\S+/iu;
const URI_LIKE_GLOBAL_RE =
  /(?:\b[A-Za-z][A-Za-z0-9+.-]*:\/\/|\b(?:mailto|tel|sms|urn|data|javascript):)\S+/giu;
const FIGMA_TOKEN_LIKE_RE = /\bfigd_[A-Za-z0-9_-]{8,}\b/iu;
const FIGMA_TOKEN_LIKE_GLOBAL_RE = /\bfigd_[A-Za-z0-9_-]{8,}\b/giu;
const MANIFEST_FILENAME = "manifest.json";
const NODE_INDEX_FILENAME = "node-index.json";
const PREVIEW_MANIFEST_FILENAME = "preview-manifest.json";
const IMPORT_STATUS_FILENAME = "import-status.json";
const STAGING_CHUNKS_DIRECTORY = ".staging/chunks";

type StagedChunkKind = "node" | "image_metadata";

type AncestorTrailFrame = {
  readonly nodeId: string;
  readonly previous?: AncestorTrailFrame;
  readonly depth: number;
};

type MutableRateLimitMetadata = {
  retryAfterSeconds?: number;
  remaining?: number;
  resetAt?: string;
  figmaPlanTier?: string;
  figmaRateLimitType?: string;
  figmaUpgradeLinkDigest?: string;
  remediation?: FigmaSnapshotImportRateLimitRemediation;
};

export interface FigmaImportRateLimitDiagnostics {
  readonly retryAfterSeconds?: number;
  readonly remaining?: number;
  readonly resetAt?: string;
  readonly figmaPlanTier?: string;
  readonly figmaRateLimitType?: string;
  readonly figmaUpgradeLinkDigest?: string;
  readonly remediation?: FigmaSnapshotImportRateLimitRemediation;
}

export type FigmaStagedImportErrorCode =
  | "missing_credential"
  | "invalid_credential"
  | "unsupported_auth_mode"
  | "rate_limited"
  | "budget_exhausted"
  | "oversized_board"
  | "corrupted_checkpoint"
  | "missing_chunk"
  | "invalid_snapshot"
  | "unsafe_path"
  | "non_resumable_partial_state"
  | "checkpoint_rejected"
  | "chunk_rejected"
  | "figma_fetch_failed"
  | "invalid_request"
  | "persist_failed";

export class FigmaStagedImportError extends Error {
  readonly errorCode: FigmaStagedImportErrorCode;
  readonly failureClass: FigmaSnapshotImportFailureClass;
  readonly retryable: boolean;
  readonly checkpoint?: FigmaSnapshotImportStatus;
  readonly rateLimitDiagnostics?: FigmaImportRateLimitDiagnostics;

  constructor(input: {
    errorCode: FigmaStagedImportErrorCode;
    failureClass?: FigmaSnapshotImportFailureClass;
    message: string;
    retryable: boolean;
    checkpoint?: FigmaSnapshotImportStatus;
    rateLimitDiagnostics?: FigmaImportRateLimitDiagnostics;
    cause?: unknown;
  }) {
    super(
      sanitizeDiagnosticMessage(input.message),
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "FigmaStagedImportError";
    this.errorCode = input.errorCode;
    this.failureClass =
      input.failureClass ?? errorCodeToFailureClass(input.errorCode);
    this.retryable = input.retryable;
    if (input.checkpoint !== undefined) {
      this.checkpoint = input.checkpoint;
    }
    if (input.rateLimitDiagnostics !== undefined) {
      this.rateLimitDiagnostics = input.rateLimitDiagnostics;
    }
  }
}

export interface ImportStagedFigmaSnapshotInput {
  readonly workspaceRoot: string;
  readonly tenantScope: TenantScope;
  readonly accessToken?: string;
  readonly credential?: FigmaImportCredentialInput;
  readonly budgetPolicy?: FigmaImportBudgetPolicyInput;
  readonly largeBoardPolicy?: FigmaSnapshotImportLimitMetadata;
  readonly figmaUrl?: string;
  readonly fileKey?: string;
  readonly nodeId?: string;
  readonly nodeIds?: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly caCertPath?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly bootstrapDepth?: number;
  readonly nodeBatchSize?: number;
  readonly imageBatchSize?: number;
  readonly imageScale?: number;
  readonly checkpoint?: unknown;
  readonly reuseCache?: boolean;
  readonly now?: () => Date;
  readonly monotonicNowMs?: () => number;
  readonly memoryUsage?: () => { readonly heapUsed: number };
  readonly sleepMs?: (ms: number) => Promise<void>;
}

export interface ImportStagedFigmaSnapshotResult {
  readonly snapshotId: string;
  readonly vaultPath: string;
  readonly manifest: FigmaSnapshotManifest;
  readonly nodeIndex: FigmaSnapshotNodeIndex;
  readonly previewManifest: FigmaSnapshotPreviewManifest;
  readonly importStatus: FigmaSnapshotImportStatus;
  readonly rateLimitDiagnostics?: FigmaImportRateLimitDiagnostics;
  readonly fetchedChunkIds: readonly string[];
  readonly reusedChunkIds: readonly string[];
}

interface SourceResolution {
  readonly fileKey: string;
  readonly nodeId?: string;
  readonly source: FigmaSnapshotSourceIdentifier;
}

interface LogicalRootPlan {
  readonly nodeId: string;
  readonly pageId: string;
  readonly pageName: string;
  readonly frameId?: string;
  readonly frameName?: string;
  readonly nodeChunkId: string;
  readonly imageChunkId: string;
}

interface StagedNodeChunkArtifact {
  readonly schemaVersion: typeof STAGING_SCHEMA_VERSION;
  readonly plannerVersion: typeof PLANNER_VERSION;
  readonly chunkKind: "node";
  readonly chunkId: string;
  readonly snapshotId: string;
  readonly source: FigmaSnapshotSourceIdentifier;
  readonly figmaRevisionDigest: string;
  readonly nodeIds: readonly string[];
  readonly records: readonly FigmaSnapshotNodeRecord[];
  readonly contentDigest: string;
}

interface StagedImageMetadataChunkArtifact {
  readonly schemaVersion: typeof STAGING_SCHEMA_VERSION;
  readonly plannerVersion: typeof PLANNER_VERSION;
  readonly chunkKind: "image_metadata";
  readonly chunkId: string;
  readonly snapshotId: string;
  readonly source: FigmaSnapshotSourceIdentifier;
  readonly figmaRevisionDigest: string;
  readonly nodeIds: readonly string[];
  readonly images: readonly FigmaRestImageMetadataRecord[];
  readonly contentDigest: string;
}

type StagedChunkArtifact =
  | StagedNodeChunkArtifact
  | StagedImageMetadataChunkArtifact;

interface MutableImportState {
  readonly workspaceRoot: string;
  readonly fileKey: string;
  readonly source: FigmaSnapshotSourceIdentifier;
  readonly snapshotId: string;
  readonly tenantScope: TenantScope;
  readonly vaultPath: string;
  readonly credential: FigmaSnapshotImportCredentialMetadata;
  readonly governance: FigmaImportGovernance;
  readonly allChunkIds: readonly string[];
  readonly limits?: FigmaSnapshotImportLimitMetadata;
  readonly startedAtMs: number;
  readonly nowMs: () => number;
  readonly memoryUsage?: () => { readonly heapUsed: number };
  readonly metrics: MutableImportMetrics;
  readonly completedChunkIds: Set<string>;
  readonly chunkInventory: Map<string, FigmaSnapshotImportChunkInventoryEntry>;
  readonly rateLimit: MutableRateLimitMetadata;
  budget?: FigmaSnapshotImportBudgetMetadata;
  failureClass?: FigmaSnapshotImportFailureClass;
  readonly fetchedChunkIds: string[];
  readonly reusedChunkIds: string[];
  dirty: boolean;
  status?: FigmaSnapshotImportStatus;
}

interface MutableImportMetrics {
  nodeCount: number;
  previewCount: number;
  skippedPreviewCount: number;
  liveRestCallCount: number;
  resumedChunkCount: number;
  peakWorkingSetBytes: number;
  peakHeapUsedBytes?: number;
  readonly chunkPayloadBytes: Map<string, number>;
  nodeIndexBytes: number;
  previewManifestBytes: number;
  previewAssetBytes: number;
  manifestBytes: number;
  importStatusBytes: number;
}

export const importStagedFigmaSnapshot = async (
  input: ImportStagedFigmaSnapshotInput,
): Promise<ImportStagedFigmaSnapshotResult> => {
  const importedAt = (input.now ?? (() => new Date()))().toISOString();
  const nowMs = input.monotonicNowMs ?? (() => Date.now());
  const startedAtMs = nowMs();
  const limits = resolveLargeBoardPolicy(input.largeBoardPolicy);
  const source = resolveSource(input);
  const credential = (() => {
    try {
      return resolveFigmaImportCredential(
        input.credential ?? {
          authMode: "personal_access_token",
          ...(input.accessToken !== undefined
            ? { accessToken: input.accessToken }
            : {}),
        },
      );
    } catch (err) {
      throw wrapInitialImportError(err);
    }
  })();
  const governance = createFigmaImportGovernance({
    credential,
    source: source.source,
    ...(input.budgetPolicy !== undefined ? { policy: input.budgetPolicy } : {}),
    windowStartedAt: new Date(importedAt),
    ...(input.sleepMs !== undefined ? { sleepMs: input.sleepMs } : {}),
  });
  const rateLimit: MutableRateLimitMetadata = {};
  let bootstrapLiveRestCallCount = 0;
  const onBootstrapFigmaRestRequest = (): void => {
    bootstrapLiveRestCallCount += 1;
  };
  const onRateLimited = (metadata: Readonly<FigmaRestRateLimitMetadata>) => {
    if (metadata.retryAfterSeconds !== undefined) {
      rateLimit.retryAfterSeconds = metadata.retryAfterSeconds;
    }
    const planTier = sanitizeRateLimitLabel(metadata.figmaPlanTier);
    if (planTier !== undefined) {
      rateLimit.figmaPlanTier = planTier;
    }
    const rateLimitType = sanitizeRateLimitLabel(metadata.figmaRateLimitType);
    if (rateLimitType !== undefined) {
      rateLimit.figmaRateLimitType = rateLimitType;
    }
    if (metadata.figmaUpgradeLinkDigest !== undefined) {
      rateLimit.figmaUpgradeLinkDigest = metadata.figmaUpgradeLinkDigest;
    }
    rateLimit.remediation = classifyFigmaRateLimitRemediation({
      ...(metadata.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: metadata.retryAfterSeconds }
        : {}),
      ...(planTier !== undefined ? { figmaPlanTier: planTier } : {}),
      ...(rateLimitType !== undefined
        ? { figmaRateLimitType: rateLimitType }
        : {}),
    });
  };
  let bootstrap: Awaited<ReturnType<typeof fetchFigmaFileForTestIntelligence>>;
  try {
    await governance.beforeRequest("file_bootstrap");
    bootstrap = await fetchFigmaFileForTestIntelligence({
      fileKey: source.fileKey,
      accessToken: credential.accessToken,
      depth: input.bootstrapDepth ?? DEFAULT_BOOTSTRAP_DEPTH,
      ...(source.nodeId !== undefined ? { nodeId: source.nodeId } : {}),
      ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
      ...(input.caCertPath !== undefined
        ? { caCertPath: input.caCertPath }
        : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.maxResponseBytes !== undefined
        ? { maxResponseBytes: input.maxResponseBytes }
        : {}),
      onRateLimited,
      onFigmaRestRequest: onBootstrapFigmaRestRequest,
      ...(input.sleepMs !== undefined ? { sleepMs: input.sleepMs } : {}),
    });
  } catch (err) {
    throw wrapInitialImportError(err, rateLimit);
  }
  const figmaRevisionDigest = computeFigmaRevisionDigest(bootstrap);
  const rootPlans = buildLogicalRootPlans({
    document: bootstrap.document,
    source: source.source,
    requestedNodeIds:
      input.nodeIds ?? (source.nodeId === undefined ? [] : [source.nodeId]),
    figmaRevisionDigest,
  });
  if (rootPlans.length === 0) {
    throw new FigmaStagedImportError({
      errorCode: "figma_fetch_failed",
      message: "Figma bootstrap returned no importable nodes",
      retryable: false,
    });
  }
  const snapshotId = buildSnapshotId({
    source: source.source,
    figmaRevisionDigest,
    rootNodeIds: rootPlans.map((root) => root.nodeId),
  });
  const vaultPath = buildFigmaSnapshotVaultPath({
    workspaceRoot: input.workspaceRoot,
    tenantScope: input.tenantScope,
    fileKeyHash: source.source.fileKeyHash,
    snapshotId,
  });
  const allChunkIds = rootPlans.flatMap((root) => [
    root.nodeChunkId,
    root.imageChunkId,
  ]);
  const state: MutableImportState = {
    workspaceRoot: input.workspaceRoot,
    fileKey: source.fileKey,
    source: source.source,
    snapshotId,
    tenantScope: input.tenantScope,
    vaultPath,
    credential: credential.metadata,
    governance,
    allChunkIds,
    ...(limits !== undefined ? { limits } : {}),
    startedAtMs,
    nowMs,
    memoryUsage: input.memoryUsage ?? process.memoryUsage.bind(process),
    metrics: {
      nodeCount: 0,
      previewCount: 0,
      skippedPreviewCount: 0,
      liveRestCallCount: bootstrapLiveRestCallCount,
      resumedChunkCount: 0,
      peakWorkingSetBytes: 0,
      chunkPayloadBytes: new Map<string, number>(),
      nodeIndexBytes: 0,
      previewManifestBytes: 0,
      previewAssetBytes: 0,
      manifestBytes: 0,
      importStatusBytes: 0,
    },
    completedChunkIds: new Set<string>(),
    chunkInventory: new Map<string, FigmaSnapshotImportChunkInventoryEntry>(),
    rateLimit,
    fetchedChunkIds: [],
    reusedChunkIds: [],
    dirty: true,
  };
  try {
    assertImportLimits(state, "planned import chunk inventory");
    for (const chunkId of allChunkIds) {
      state.chunkInventory.set(chunkId, {
        chunkId,
        state: "pending",
        nodeCount: 0,
      });
    }
    await ensureFigmaSnapshotVaultDirectory({
      workspaceRoot: input.workspaceRoot,
      directoryPath: vaultPath,
      label: "Figma snapshot vault",
    });
    await ensureFigmaSnapshotVaultDirectory({
      workspaceRoot: input.workspaceRoot,
      directoryPath: join(vaultPath, STAGING_CHUNKS_DIRECTORY),
      label: "Figma snapshot staging chunks",
    });
  } catch (err) {
    const failureClass = classifyImportFailure(err);
    throw buildImportError({ err, failureClass });
  }
  const checkpoint = await resolveCheckpoint({
    explicitCheckpoint: input.checkpoint,
    workspaceRoot: input.workspaceRoot,
    vaultPath,
    snapshotId,
    source: source.source,
    tenantScope: input.tenantScope,
  });
  if (checkpoint !== undefined) {
    await applyCheckpoint({
      checkpoint,
      state,
      figmaRevisionDigest,
    });
  }
  await persistImportStatus(state, "fetching");

  await importNodeChunks({
    input,
    state,
    rootPlans,
    figmaRevisionDigest,
    onRateLimited,
  });
  await importImageMetadataChunks({
    input,
    state,
    rootPlans,
    figmaRevisionDigest,
    onRateLimited,
  });

  try {
    const nodeRecords = await loadCommittedNodeRecords({
      state,
      rootPlans,
      figmaRevisionDigest,
    });
    state.metrics.nodeCount = nodeRecords.length;
    updatePeakWorkingSetBytes(state);
    assertImportLimits(state, "node index generation");
    const nodeIndex = buildFigmaSnapshotLocalNodeIndex({
      snapshotId,
      tenantScope: input.tenantScope,
      source: source.source,
      records: nodeRecords,
    });
    const nodeIndexContent = serializeFigmaSnapshotArtifact(nodeIndex);
    state.metrics.nodeIndexBytes = Buffer.byteLength(nodeIndexContent, "utf8");
    updatePeakWorkingSetBytes(state);
    assertImportLimits(state, "node index payload");
    await writeJsonAtomically(
      join(vaultPath, NODE_INDEX_FILENAME),
      nodeIndexContent,
      {
        workspaceRoot: input.workspaceRoot,
        label: "Figma snapshot node index",
      },
    );
    await persistImportStatus(state, "previewing");
    const previewManifest = planFigmaSnapshotPreviewCache({
      nodeIndex,
      ...(limits?.maxPreviewTiles !== undefined
        ? { maxTiles: limits.maxPreviewTiles }
        : {}),
    });
    const previewManifestContent =
      serializeFigmaSnapshotArtifact(previewManifest);
    state.metrics.previewCount = previewManifest.assets.length;
    state.metrics.skippedPreviewCount =
      previewManifest.budget?.skippedTileCount ?? 0;
    state.metrics.previewManifestBytes = Buffer.byteLength(
      previewManifestContent,
      "utf8",
    );
    state.metrics.previewAssetBytes = previewManifest.assets.reduce(
      (total, asset) => total + asset.byteLength,
      0,
    );
    updatePeakWorkingSetBytes(state);
    assertImportLimits(state, "preview generation");
    await writeFigmaSnapshotPreviewCacheAssets(vaultPath, previewManifest, {
      workspaceRoot: input.workspaceRoot,
    });
    await writeJsonAtomically(
      join(vaultPath, PREVIEW_MANIFEST_FILENAME),
      previewManifestContent,
      {
        workspaceRoot: input.workspaceRoot,
        label: "Figma snapshot preview manifest",
      },
    );
    const completedStatus = await persistImportStatus(state, "completed");
    const manifest = withArtifactDigest<FigmaSnapshotManifest>({
      schemaVersion: FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
      snapshotId,
      tenantScope: input.tenantScope,
      source: source.source,
      importStrategy: "hybrid",
      ...(bootstrap.version !== undefined
        ? { figmaVersion: bootstrap.version }
        : {}),
      ...(bootstrap.lastModified !== undefined
        ? { figmaLastModified: bootstrap.lastModified }
        : {}),
      importedAt,
      artifactDigests: {
        nodeIndexDigest: nodeIndex.contentDigest,
        importStatusDigest: completedStatus.contentDigest,
        previewManifestDigest: previewManifest.contentDigest,
      },
    });
    validateFigmaSnapshotManifest(manifest);
    const manifestContent = serializeFigmaSnapshotArtifact(manifest);
    state.metrics.manifestBytes = Buffer.byteLength(manifestContent, "utf8");
    updatePeakWorkingSetBytes(state);
    assertImportLimits(state, "snapshot manifest");
    await writeJsonAtomically(
      join(vaultPath, MANIFEST_FILENAME),
      manifestContent,
      {
        workspaceRoot: input.workspaceRoot,
        label: "Figma snapshot manifest",
      },
    );
    const rateLimitDiagnostics = buildRateLimitDiagnostics(rateLimit);
    return {
      snapshotId,
      vaultPath,
      manifest,
      nodeIndex,
      previewManifest,
      importStatus: completedStatus,
      ...(rateLimitDiagnostics !== undefined ? { rateLimitDiagnostics } : {}),
      fetchedChunkIds: state.fetchedChunkIds,
      reusedChunkIds: state.reusedChunkIds,
    };
  } catch (err) {
    const failureClass = classifyImportFailure(err);
    await persistFailedStatus(state, undefined, failureClass);
    throw wrapImportError(err, state, failureClass);
  }
};

const resolveSource = (
  input: ImportStagedFigmaSnapshotInput,
): SourceResolution => {
  const parsed =
    input.figmaUrl === undefined ? undefined : parseFigmaUrl(input.figmaUrl);
  const fileKey = normalizeRequiredString(
    "fileKey",
    input.fileKey ?? parsed?.fileKey,
  );
  const nodeId = normalizeSourceNodeId(input.nodeId ?? parsed?.nodeId);
  if (
    input.fileKey !== undefined &&
    parsed !== undefined &&
    parsed.fileKey !== input.fileKey
  ) {
    throw new FigmaStagedImportError({
      errorCode: "figma_fetch_failed",
      message: "Figma source fileKey does not match the provided figmaUrl",
      retryable: false,
    });
  }
  const sourceUrlHash = sha256Hex({
    kind: "figma_source",
    fileKey,
    ...(nodeId !== undefined ? { nodeId } : {}),
  });
  const source: FigmaSnapshotSourceIdentifier = {
    fileKeyHash: sha256Hex({ kind: "figma_file_key", fileKey }),
    sourceUrlHash,
    ...(nodeId !== undefined ? { nodeId } : {}),
  };
  return {
    fileKey,
    ...(nodeId !== undefined ? { nodeId } : {}),
    source,
  };
};

const normalizeSourceNodeId = (
  nodeId: string | undefined,
): string | undefined => {
  if (nodeId === undefined) return undefined;
  const normalized = nodeId.trim();
  if (
    normalized.length === 0 ||
    !FIGMA_NODE_ID_RE.test(normalized) ||
    URI_LIKE_RE.test(normalized) ||
    FIGMA_TOKEN_LIKE_RE.test(normalized)
  ) {
    throw new FigmaStagedImportError({
      errorCode: "figma_fetch_failed",
      message: `Figma source nodeId is invalid (${sanitizeDiagnosticMessage(normalized)})`,
      retryable: false,
    });
  }
  return normalized;
};

const buildLogicalRootPlans = (input: {
  document: FigmaRestNode;
  source: FigmaSnapshotSourceIdentifier;
  requestedNodeIds: readonly string[];
  figmaRevisionDigest: string;
}): readonly LogicalRootPlan[] => {
  const contextByNodeId = new Map<
    string,
    Omit<LogicalRootPlan, "nodeChunkId" | "imageChunkId">
  >();
  collectBootstrapContexts({
    node: input.document,
    pageId: input.document.id,
    pageName: sanitizePersistedText(
      input.document.name ?? input.document.id,
      input.document.id,
    ),
    contextByNodeId,
  });
  const requested = input.requestedNodeIds
    .map((nodeId) => nodeId.trim())
    .filter((nodeId) => nodeId.length > 0);
  const rootContexts =
    requested.length === 0
      ? inferTopLevelImportRoots(input.document, contextByNodeId)
      : requested.map(
          (nodeId) =>
            contextByNodeId.get(nodeId) ?? {
              nodeId,
              pageId: input.document.id,
              pageName: sanitizePersistedText(
                input.document.name ?? input.document.id,
                input.document.id,
              ),
            },
        );
  const deduped = new Map<
    string,
    Omit<LogicalRootPlan, "nodeChunkId" | "imageChunkId">
  >();
  for (const root of rootContexts) deduped.set(root.nodeId, root);
  return [...deduped.values()].map((root) => ({
    ...root,
    nodeChunkId: buildChunkId({
      kind: "node",
      source: input.source,
      figmaRevisionDigest: input.figmaRevisionDigest,
      nodeId: root.nodeId,
    }),
    imageChunkId: buildChunkId({
      kind: "image_metadata",
      source: input.source,
      figmaRevisionDigest: input.figmaRevisionDigest,
      nodeId: root.nodeId,
    }),
  }));
};

const collectBootstrapContexts = (input: {
  node: FigmaRestNode;
  pageId: string;
  pageName: string;
  frameId?: string;
  frameName?: string;
  contextByNodeId: Map<
    string,
    Omit<LogicalRootPlan, "nodeChunkId" | "imageChunkId">
  >;
}): void => {
  const stack: Array<{
    node: FigmaRestNode;
    pageId: string;
    pageName: string;
    frameId?: string;
    frameName?: string;
  }> = [
    {
      node: input.node,
      pageId: input.pageId,
      pageName: input.pageName,
      ...(input.frameId !== undefined ? { frameId: input.frameId } : {}),
      ...(input.frameName !== undefined ? { frameName: input.frameName } : {}),
    },
  ];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const nodeName = sanitizePersistedText(
      current.node.name ?? current.node.id,
      current.node.id,
    );
    const isPage = current.node.type === "CANVAS";
    const isFrame =
      current.node.type === "FRAME" || current.node.type === "COMPONENT";
    const pageId = isPage ? current.node.id : current.pageId;
    const pageName = isPage ? nodeName : current.pageName;
    const frameId = isFrame ? current.node.id : current.frameId;
    const frameName = isFrame ? nodeName : current.frameName;
    input.contextByNodeId.set(current.node.id, {
      nodeId: current.node.id,
      pageId,
      pageName,
      ...(frameId !== undefined ? { frameId } : {}),
      ...(frameName !== undefined ? { frameName } : {}),
    });
    const children = current.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child === undefined) continue;
      stack.push({
        node: child,
        pageId,
        pageName,
        ...(frameId !== undefined ? { frameId } : {}),
        ...(frameName !== undefined ? { frameName } : {}),
      });
    }
  }
};

const inferTopLevelImportRoots = (
  document: FigmaRestNode,
  contextByNodeId: ReadonlyMap<
    string,
    Omit<LogicalRootPlan, "nodeChunkId" | "imageChunkId">
  >,
): readonly Omit<LogicalRootPlan, "nodeChunkId" | "imageChunkId">[] => {
  const roots: Array<Omit<LogicalRootPlan, "nodeChunkId" | "imageChunkId">> =
    [];
  for (const page of document.children ?? []) {
    const pageContext = contextByNodeId.get(page.id);
    if (page.children !== undefined && page.children.length > 0) {
      for (const child of page.children) {
        const childContext = contextByNodeId.get(child.id);
        if (childContext !== undefined) roots.push(childContext);
      }
    } else if (pageContext !== undefined) {
      roots.push(pageContext);
    }
  }
  if (roots.length > 0) return roots;
  const documentContext = contextByNodeId.get(document.id);
  return documentContext === undefined ? [] : [documentContext];
};

const importNodeChunks = async (input: {
  input: ImportStagedFigmaSnapshotInput;
  state: MutableImportState;
  rootPlans: readonly LogicalRootPlan[];
  figmaRevisionDigest: string;
  onRateLimited: (metadata: Readonly<FigmaRestRateLimitMetadata>) => void;
}): Promise<void> => {
  const missing: LogicalRootPlan[] = [];
  for (const root of input.rootPlans) {
    const cached = await readCachedChunk({
      state: input.state,
      chunkKind: "node",
      chunkId: root.nodeChunkId,
      figmaRevisionDigest: input.figmaRevisionDigest,
      reuseCache: input.input.reuseCache !== false,
    });
    if (cached !== undefined) {
      stateAddNodeCount(
        input.state,
        cached.records.length,
        "cached node chunk",
      );
      markChunkCompleted(input.state, {
        chunkId: cached.chunkId,
        nodeCount: cached.records.length,
        contentDigest: cached.contentDigest,
        reused: true,
      });
    } else {
      missing.push(root);
    }
  }
  for (const batch of chunkArray(
    missing,
    input.input.nodeBatchSize ?? DEFAULT_NODE_BATCH_SIZE,
  )) {
    await fetchNodeBatchAdaptive({ ...input, batch });
  }
};

const fetchNodeBatchAdaptive = async (input: {
  input: ImportStagedFigmaSnapshotInput;
  state: MutableImportState;
  batch: readonly LogicalRootPlan[];
  figmaRevisionDigest: string;
  onRateLimited: (metadata: Readonly<FigmaRestRateLimitMetadata>) => void;
}): Promise<void> => {
  try {
    input.state.budget =
      await input.state.governance.beforeRequest("node_batch");
    input.state.dirty = true;
    const batchResult = await fetchFigmaNodesForTestIntelligence({
      fileKey: input.state.fileKey,
      accessToken: input.state.governance.credential.accessToken,
      nodeIds: input.batch.map((root) => root.nodeId),
      ...(input.input.fetchImpl !== undefined
        ? { fetchImpl: input.input.fetchImpl }
        : {}),
      ...(input.input.caCertPath !== undefined
        ? { caCertPath: input.input.caCertPath }
        : {}),
      ...(input.input.timeoutMs !== undefined
        ? { timeoutMs: input.input.timeoutMs }
        : {}),
      ...(input.input.maxResponseBytes !== undefined
        ? { maxResponseBytes: input.input.maxResponseBytes }
        : {}),
      onRateLimited: input.onRateLimited,
      onFigmaRestRequest: () => {
        input.state.metrics.liveRestCallCount += 1;
      },
      ...(input.input.sleepMs !== undefined
        ? { sleepMs: input.input.sleepMs }
        : {}),
    });
    for (const root of input.batch) {
      const node = batchResult.nodes.get(root.nodeId);
      if (node === undefined) {
        throw new FigmaStagedImportError({
          errorCode: "figma_fetch_failed",
          message: `Figma node batch did not include requested node ${sanitizeDiagnosticMessage(root.nodeId)}`,
          retryable: false,
        });
      }
      const records = flattenNodeRecords({
        root,
        node,
        chunkId: root.nodeChunkId,
      });
      stateAddNodeCount(input.state, records.length, "fetched node chunk");
      const artifact = withChunkDigest<StagedNodeChunkArtifact>({
        schemaVersion: STAGING_SCHEMA_VERSION,
        plannerVersion: PLANNER_VERSION,
        chunkKind: "node",
        chunkId: root.nodeChunkId,
        snapshotId: input.state.snapshotId,
        source: input.state.source,
        figmaRevisionDigest: input.figmaRevisionDigest,
        nodeIds: [root.nodeId],
        records,
      });
      await persistChunk(input.state, artifact);
      markChunkCompleted(input.state, {
        chunkId: root.nodeChunkId,
        nodeCount: records.length,
        contentDigest: artifact.contentDigest,
        reused: false,
      });
    }
    await persistImportStatus(input.state, "fetching");
  } catch (err) {
    if (isOversizedFigmaError(err) && input.batch.length > 1) {
      const midpoint = Math.ceil(input.batch.length / 2);
      await fetchNodeBatchAdaptive({
        ...input,
        batch: input.batch.slice(0, midpoint),
      });
      await fetchNodeBatchAdaptive({
        ...input,
        batch: input.batch.slice(midpoint),
      });
      return;
    }
    const failureClass = classifyImportFailure(err);
    await persistFailedStatus(
      input.state,
      input.batch[0]?.nodeChunkId,
      failureClass,
    );
    throw wrapImportError(err, input.state, failureClass);
  }
};

const importImageMetadataChunks = async (input: {
  input: ImportStagedFigmaSnapshotInput;
  state: MutableImportState;
  rootPlans: readonly LogicalRootPlan[];
  figmaRevisionDigest: string;
  onRateLimited: (metadata: Readonly<FigmaRestRateLimitMetadata>) => void;
}): Promise<void> => {
  const missing: LogicalRootPlan[] = [];
  for (const root of input.rootPlans) {
    const cached = await readCachedChunk({
      state: input.state,
      chunkKind: "image_metadata",
      chunkId: root.imageChunkId,
      figmaRevisionDigest: input.figmaRevisionDigest,
      reuseCache: input.input.reuseCache !== false,
    });
    if (cached !== undefined) {
      markChunkCompleted(input.state, {
        chunkId: cached.chunkId,
        nodeCount: cached.nodeIds.length,
        contentDigest: cached.contentDigest,
        reused: true,
      });
    } else {
      missing.push(root);
    }
  }
  for (const batch of chunkArray(
    missing,
    input.input.imageBatchSize ?? DEFAULT_IMAGE_BATCH_SIZE,
  )) {
    await fetchImageMetadataBatchAdaptive({ ...input, batch });
  }
};

const fetchImageMetadataBatchAdaptive = async (input: {
  input: ImportStagedFigmaSnapshotInput;
  state: MutableImportState;
  batch: readonly LogicalRootPlan[];
  figmaRevisionDigest: string;
  onRateLimited: (metadata: Readonly<FigmaRestRateLimitMetadata>) => void;
}): Promise<void> => {
  try {
    input.state.budget =
      await input.state.governance.beforeRequest("image_metadata");
    input.state.dirty = true;
    const batchResult = await fetchFigmaImageMetadataForTestIntelligence({
      fileKey: input.state.fileKey,
      accessToken: input.state.governance.credential.accessToken,
      nodeIds: input.batch.map((root) => root.nodeId),
      ...(input.input.fetchImpl !== undefined
        ? { fetchImpl: input.input.fetchImpl }
        : {}),
      ...(input.input.caCertPath !== undefined
        ? { caCertPath: input.input.caCertPath }
        : {}),
      ...(input.input.timeoutMs !== undefined
        ? { timeoutMs: input.input.timeoutMs }
        : {}),
      ...(input.input.maxResponseBytes !== undefined
        ? { maxResponseBytes: input.input.maxResponseBytes }
        : {}),
      ...(input.input.imageScale !== undefined
        ? { scale: input.input.imageScale }
        : {}),
      onRateLimited: input.onRateLimited,
      onFigmaRestRequest: () => {
        input.state.metrics.liveRestCallCount += 1;
      },
      ...(input.input.sleepMs !== undefined
        ? { sleepMs: input.input.sleepMs }
        : {}),
    });
    const byNodeId = new Map(
      batchResult.images.map((image) => [image.nodeId, image]),
    );
    for (const root of input.batch) {
      const image = byNodeId.get(root.nodeId) ?? {
        nodeId: root.nodeId,
        renderable: false,
        reason: "missing" as const,
      };
      const artifact = withChunkDigest<StagedImageMetadataChunkArtifact>({
        schemaVersion: STAGING_SCHEMA_VERSION,
        plannerVersion: PLANNER_VERSION,
        chunkKind: "image_metadata",
        chunkId: root.imageChunkId,
        snapshotId: input.state.snapshotId,
        source: input.state.source,
        figmaRevisionDigest: input.figmaRevisionDigest,
        nodeIds: [root.nodeId],
        images: [image],
      });
      await persistChunk(input.state, artifact);
      markChunkCompleted(input.state, {
        chunkId: root.imageChunkId,
        nodeCount: artifact.images.length,
        contentDigest: artifact.contentDigest,
        reused: false,
      });
    }
    await persistImportStatus(input.state, "fetching");
  } catch (err) {
    if (isOversizedFigmaError(err) && input.batch.length > 1) {
      const midpoint = Math.ceil(input.batch.length / 2);
      await fetchImageMetadataBatchAdaptive({
        ...input,
        batch: input.batch.slice(0, midpoint),
      });
      await fetchImageMetadataBatchAdaptive({
        ...input,
        batch: input.batch.slice(midpoint),
      });
      return;
    }
    const failureClass = classifyImportFailure(err);
    await persistFailedStatus(
      input.state,
      input.batch[0]?.imageChunkId,
      failureClass,
    );
    throw wrapImportError(err, input.state, failureClass);
  }
};

const flattenNodeRecords = (input: {
  root: LogicalRootPlan;
  node: FigmaRestNode;
  chunkId: string;
}): readonly FigmaSnapshotNodeRecord[] => {
  const records: FigmaSnapshotNodeRecord[] = [];
  const stack: Array<{
    node: FigmaRestNode;
    ancestorTrail?: AncestorTrailFrame;
    parentNodeId?: string;
    nearestFrameId?: string;
    nearestFrameName?: string;
  }> = [{ node: input.node }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const { node, parentNodeId } = current;
    const nodeName = sanitizePersistedText(node.name ?? node.id, node.id);
    const isFrame = node.type === "FRAME" || node.type === "COMPONENT";
    const nearestFrameId = isFrame ? node.id : current.nearestFrameId;
    const nearestFrameName = isFrame ? nodeName : current.nearestFrameName;
    const bbox = buildSafeBoundingBox(node);
    const ancestorNodeIds = materializeAncestorNodeIds(current.ancestorTrail);
    const ancestorDepth = current.ancestorTrail?.depth ?? 0;
    records.push({
      pageId: input.root.pageId,
      pageName: input.root.pageName,
      ...(nearestFrameId !== undefined
        ? { frameId: nearestFrameId }
        : input.root.frameId !== undefined
          ? { frameId: input.root.frameId }
          : {}),
      ...(nearestFrameName !== undefined
        ? { frameName: nearestFrameName }
        : input.root.frameName !== undefined
          ? { frameName: input.root.frameName }
          : {}),
      nodeId: node.id,
      nodeName,
      nodeType: sanitizePersistedText(node.type, "UNKNOWN"),
      ...(parentNodeId !== undefined ? { parentNodeId } : {}),
      ancestorNodeIds,
      ...(bbox !== undefined ? { bbox } : {}),
      labels: [
        ...(node.visible === false ? ["hidden"] : []),
        ...(ancestorDepth > MAX_PERSISTED_ANCESTOR_NODE_IDS
          ? ["deeply-nested"]
          : []),
      ],
      ...(node.characters !== undefined
        ? { textSnippet: sanitizePersistedText(node.characters, "text") }
        : {}),
      componentHints: Object.keys(node.componentPropertyDefinitions ?? {})
        .map((hint) => sanitizePersistedText(hint, "component"))
        .slice(0, 20),
      visible: node.visible !== false,
      sourceChunkRefs: [{ chunkId: input.chunkId }],
    });
    const children = node.children ?? [];
    const childAncestorTrail = appendAncestorTrail(
      current.ancestorTrail,
      node.id,
    );
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child === undefined) continue;
      stack.push({
        node: child,
        ancestorTrail: childAncestorTrail,
        parentNodeId: node.id,
        ...(nearestFrameId !== undefined ? { nearestFrameId } : {}),
        ...(nearestFrameName !== undefined ? { nearestFrameName } : {}),
      });
    }
  }
  return records;
};

const appendAncestorTrail = (
  previous: AncestorTrailFrame | undefined,
  nodeId: string,
): AncestorTrailFrame => ({
  nodeId,
  ...(previous !== undefined ? { previous } : {}),
  depth: (previous?.depth ?? 0) + 1,
});

const materializeAncestorNodeIds = (
  trail: AncestorTrailFrame | undefined,
): readonly string[] => {
  if (trail === undefined) return [];
  const nodeIds: string[] = [];
  let current: AncestorTrailFrame | undefined = trail;
  while (
    current !== undefined &&
    nodeIds.length < MAX_PERSISTED_ANCESTOR_NODE_IDS
  ) {
    nodeIds.push(current.nodeId);
    current = current.previous;
  }
  nodeIds.reverse();
  return nodeIds;
};

const buildSafeBoundingBox = (
  node: FigmaRestNode,
): FigmaSnapshotNodeRecord["bbox"] | undefined => {
  const bbox = node.absoluteBoundingBox;
  if (bbox === undefined) return undefined;
  const { x, y, width, height } = bbox;
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 0 ||
    height < 0
  ) {
    return undefined;
  }
  return { x, y, width, height };
};

const loadCommittedNodeRecords = async (input: {
  state: MutableImportState;
  rootPlans: readonly LogicalRootPlan[];
  figmaRevisionDigest: string;
}): Promise<readonly FigmaSnapshotNodeRecord[]> => {
  const records = new Map<string, FigmaSnapshotNodeRecord>();
  for (const root of input.rootPlans) {
    const chunk = await readChunkFile({
      state: input.state,
      chunkKind: "node",
      chunkId: root.nodeChunkId,
      figmaRevisionDigest: input.figmaRevisionDigest,
    });
    for (const record of chunk.records) records.set(record.nodeId, record);
  }
  return [...records.values()].sort((left, right) =>
    left.nodeId.localeCompare(right.nodeId),
  );
};

const resolveCheckpoint = async (input: {
  explicitCheckpoint: unknown;
  workspaceRoot: string;
  vaultPath: string;
  snapshotId: string;
  source: FigmaSnapshotSourceIdentifier;
  tenantScope: TenantScope;
}): Promise<FigmaSnapshotImportStatus | undefined> => {
  if (input.explicitCheckpoint !== undefined) {
    return validateCompatibleCheckpoint(input.explicitCheckpoint, input);
  }
  const persisted = await readJsonIfExists(
    join(input.vaultPath, IMPORT_STATUS_FILENAME),
    {
      workspaceRoot: input.workspaceRoot,
      label: "Figma staged import checkpoint",
    },
  );
  if (persisted === undefined) return undefined;
  return validateCompatibleCheckpoint(persisted, input);
};

const validateCompatibleCheckpoint = (
  value: unknown,
  expected: {
    snapshotId: string;
    source: FigmaSnapshotSourceIdentifier;
    tenantScope: TenantScope;
  },
): FigmaSnapshotImportStatus => {
  try {
    const checkpoint = validateFigmaSnapshotImportStatus(value);
    if (
      checkpoint.snapshotId !== expected.snapshotId ||
      !jsonEqual(checkpoint.source, expected.source) ||
      !jsonEqual(checkpoint.tenantScope, expected.tenantScope)
    ) {
      throw new Error(
        "checkpoint source, tenant scope, or snapshot id is incompatible",
      );
    }
    const chunkById = new Map(
      checkpoint.chunks.map((chunk) => [chunk.chunkId, chunk]),
    );
    const completed = new Set(checkpoint.checkpoint.completedChunkIds);
    if (
      checkpoint.checkpoint.resumeFromChunkId !== undefined &&
      !completed.has(checkpoint.checkpoint.resumeFromChunkId)
    ) {
      throw new Error("checkpoint resumeFromChunkId is not completed");
    }
    for (const chunkId of completed) {
      const inventory = chunkById.get(chunkId);
      if (inventory === undefined || inventory.state !== "completed") {
        throw new Error(
          "checkpoint completedChunkIds do not match chunk inventory",
        );
      }
    }
    return checkpoint;
  } catch (err) {
    throw new FigmaStagedImportError({
      errorCode: "checkpoint_rejected",
      failureClass: "corrupted_checkpoint",
      message: `Figma staged import checkpoint rejected: ${sanitizeErrorMessage(
        {
          error: err,
          fallback: "invalid checkpoint",
        },
      )}`,
      retryable: false,
      cause: err,
    });
  }
};

const applyCheckpoint = async (input: {
  checkpoint: FigmaSnapshotImportStatus;
  state: MutableImportState;
  figmaRevisionDigest: string;
}): Promise<void> => {
  try {
    const chunkById = new Map(
      input.checkpoint.chunks.map((chunk) => [chunk.chunkId, chunk]),
    );
    if (input.checkpoint.lifecycleState === "completed") {
      const completed = new Set(input.checkpoint.checkpoint.completedChunkIds);
      const missing = input.state.allChunkIds.filter(
        (chunkId) => !completed.has(chunkId),
      );
      if (missing.length > 0) {
        throw new FigmaStagedImportError({
          errorCode: "non_resumable_partial_state",
          failureClass: "non_resumable_partial_state",
          message:
            "Figma staged import checkpoint is completed but missing chunk inventory",
          retryable: false,
        });
      }
    }
    for (const chunk of input.checkpoint.chunks) {
      input.state.chunkInventory.set(chunk.chunkId, chunk);
    }
    for (const chunkId of input.checkpoint.checkpoint.completedChunkIds) {
      const inventory = chunkById.get(chunkId);
      if (inventory === undefined) continue;
      const chunkKind = chunkId.startsWith("node-") ? "node" : "image_metadata";
      await readChunkFile({
        state: input.state,
        chunkKind,
        chunkId,
        figmaRevisionDigest: input.figmaRevisionDigest,
      });
      input.state.completedChunkIds.add(chunkId);
      input.state.metrics.resumedChunkCount += 1;
    }
  } catch (err) {
    if (err instanceof FigmaStagedImportError) throw err;
    const failureClass = isFileNotFound(err)
      ? "missing_chunk"
      : "corrupted_checkpoint";
    throw new FigmaStagedImportError({
      errorCode: "checkpoint_rejected",
      failureClass,
      message: `Figma staged import checkpoint chunk inventory rejected: ${sanitizeErrorMessage(
        {
          error: err,
          fallback: "invalid checkpoint chunks",
        },
      )}`,
      retryable: false,
      cause: err,
    });
  }
};

const readCachedChunk = async <TKind extends StagedChunkKind>(input: {
  state: MutableImportState;
  chunkKind: TKind;
  chunkId: string;
  figmaRevisionDigest: string;
  reuseCache: boolean;
}): Promise<Extract<StagedChunkArtifact, { chunkKind: TKind }> | undefined> => {
  if (!input.reuseCache) return undefined;
  try {
    return await readChunkFile(input);
  } catch (err) {
    if (isFileNotFound(err)) return undefined;
    if (err instanceof FigmaSnapshotVaultError) {
      throw new FigmaStagedImportError({
        errorCode: failureClassToErrorCode(
          err.errorCode === "unsafe_path" ? "unsafe_path" : "invalid_snapshot",
        ),
        failureClass:
          err.errorCode === "unsafe_path" ? "unsafe_path" : "invalid_snapshot",
        message: "Figma staged import JSON artifact failed vault checks",
        retryable: false,
        cause: err,
      });
    }
    throw err;
  }
};

const readChunkFile = async <TKind extends StagedChunkKind>(input: {
  state: MutableImportState;
  chunkKind: TKind;
  chunkId: string;
  figmaRevisionDigest: string;
}): Promise<Extract<StagedChunkArtifact, { chunkKind: TKind }>> => {
  try {
    const path = chunkFilePath(input.state.vaultPath, input.chunkId);
    await assertFigmaSnapshotVaultPathContained({
      workspaceRoot: input.state.workspaceRoot,
      targetPath: path,
      label: "Figma staged import chunk",
    });
    const payload = JSON.parse(await readFile(path, "utf8")) as unknown;
    const chunk = validateChunkArtifact(payload);
    if (
      chunk.chunkKind !== input.chunkKind ||
      chunk.chunkId !== input.chunkId ||
      chunk.snapshotId !== input.state.snapshotId ||
      chunk.figmaRevisionDigest !== input.figmaRevisionDigest ||
      !jsonEqual(chunk.source, input.state.source)
    ) {
      throw new Error("chunk metadata is incompatible with the current import");
    }
    return chunk as Extract<StagedChunkArtifact, { chunkKind: TKind }>;
  } catch (err) {
    if (isFileNotFound(err)) throw err;
    if (err instanceof FigmaSnapshotVaultError) {
      throw new FigmaStagedImportError({
        errorCode: "unsafe_path",
        failureClass: "unsafe_path",
        message:
          "Figma staged import chunk failed vault path containment checks",
        retryable: false,
        cause: err,
      });
    }
    throw new FigmaStagedImportError({
      errorCode: "chunk_rejected",
      failureClass: "invalid_snapshot",
      message: `Figma staged import chunk rejected: ${sanitizeErrorMessage({
        error: err,
        fallback: "invalid chunk",
      })}`,
      retryable: false,
      cause: err,
    });
  }
};

const validateChunkArtifact = (value: unknown): StagedChunkArtifact => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("chunk artifact must be a JSON object");
  }
  const chunk = value as StagedChunkArtifact;
  if (
    chunk.schemaVersion !== STAGING_SCHEMA_VERSION ||
    chunk.plannerVersion !== PLANNER_VERSION ||
    (chunk.chunkKind !== "node" && chunk.chunkKind !== "image_metadata") ||
    typeof chunk.chunkId !== "string" ||
    typeof chunk.snapshotId !== "string" ||
    typeof chunk.figmaRevisionDigest !== "string" ||
    !Array.isArray(chunk.nodeIds) ||
    typeof chunk.contentDigest !== "string"
  ) {
    throw new Error("chunk artifact has an invalid envelope");
  }
  if (chunk.chunkKind === "node" && !Array.isArray(chunk.records)) {
    throw new Error("node chunk artifact is missing records");
  }
  if (chunk.chunkKind === "image_metadata" && !Array.isArray(chunk.images)) {
    throw new Error("image metadata chunk artifact is missing images");
  }
  assertNoUnsafeStrings(chunk);
  const expected = computeChunkDigest(chunk);
  if (chunk.contentDigest !== expected) {
    throw new Error("chunk contentDigest mismatch");
  }
  return chunk;
};

const persistChunk = async (
  state: MutableImportState,
  artifact: StagedChunkArtifact,
): Promise<void> => {
  validateChunkArtifact(artifact);
  const content = `${canonicalJson(artifact)}\n`;
  state.metrics.chunkPayloadBytes.set(
    artifact.chunkId,
    Buffer.byteLength(content, "utf8"),
  );
  updatePeakWorkingSetBytes(state);
  assertImportLimits(state, `${artifact.chunkKind} chunk payload`);
  try {
    await writeJsonAtomically(
      chunkFilePath(state.vaultPath, artifact.chunkId),
      content,
      {
        workspaceRoot: state.workspaceRoot,
        label: "Figma staged import chunk",
      },
    );
  } catch (err) {
    if (err instanceof FigmaStagedImportError) throw err;
    throw new FigmaStagedImportError({
      errorCode: "persist_failed",
      message: `Figma staged import chunk persistence failed: ${sanitizeErrorMessage(
        {
          error: err,
          fallback: "write failed",
        },
      )}`,
      retryable: true,
      cause: err,
    });
  }
};

const persistImportStatus = async (
  state: MutableImportState,
  lifecycleState: FigmaSnapshotImportLifecycleState,
): Promise<FigmaSnapshotImportStatus> => {
  if (
    !state.dirty &&
    state.status !== undefined &&
    state.status.lifecycleState === lifecycleState
  ) {
    return state.status;
  }
  const status = withArtifactDigest<FigmaSnapshotImportStatus>({
    schemaVersion: FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION,
    snapshotId: state.snapshotId,
    tenantScope: state.tenantScope,
    source: state.source,
    lifecycleState,
    retry: { attempt: 0, maxAttempts: 2 },
    rateLimit: {
      ...(state.rateLimit.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: state.rateLimit.retryAfterSeconds }
        : {}),
      ...(state.rateLimit.remaining !== undefined
        ? { remaining: state.rateLimit.remaining }
        : {}),
      ...(state.rateLimit.resetAt !== undefined
        ? { resetAt: state.rateLimit.resetAt }
        : {}),
    },
    credential: state.credential,
    budget: state.budget ?? state.governance.snapshotBudget(),
    ...(state.failureClass !== undefined
      ? { failureClass: state.failureClass }
      : {}),
    ...(state.limits !== undefined ? { limits: state.limits } : {}),
    metrics: snapshotPerformanceMetrics(state),
    chunks: [...state.chunkInventory.values()].sort((left, right) =>
      left.chunkId.localeCompare(right.chunkId),
    ),
    checkpoint: {
      lastSuccessfulPhase: lifecycleState,
      completedChunkIds: [...state.completedChunkIds].sort(),
    },
  });
  const content = serializeFigmaSnapshotArtifact(status);
  state.metrics.importStatusBytes = Buffer.byteLength(content, "utf8");
  updatePeakWorkingSetBytes(state);
  validateFigmaSnapshotImportStatus(status);
  await writeJsonAtomically(
    join(state.vaultPath, IMPORT_STATUS_FILENAME),
    content,
    {
      workspaceRoot: state.workspaceRoot,
      label: "Figma staged import status",
    },
  );
  state.status = status;
  state.dirty = false;
  return status;
};

const persistFailedStatus = async (
  state: MutableImportState,
  failedChunkId: string | undefined,
  failureClass: FigmaSnapshotImportFailureClass,
): Promise<void> => {
  state.failureClass = failureClass;
  if (failureClass === "budget_exhausted" && state.budget === undefined) {
    state.budget = state.governance.snapshotBudget();
  }
  if (failedChunkId !== undefined) {
    const current = state.chunkInventory.get(failedChunkId);
    state.chunkInventory.set(failedChunkId, {
      chunkId: failedChunkId,
      state: "failed",
      nodeCount: current?.nodeCount ?? 0,
      ...(current?.contentDigest !== undefined
        ? { contentDigest: current.contentDigest }
        : {}),
    });
  }
  state.dirty = true;
  await persistImportStatus(state, "failed");
};

const markChunkCompleted = (
  state: MutableImportState,
  input: {
    chunkId: string;
    nodeCount: number;
    contentDigest: string;
    reused: boolean;
  },
): void => {
  state.completedChunkIds.add(input.chunkId);
  state.chunkInventory.set(input.chunkId, {
    chunkId: input.chunkId,
    state: "completed",
    nodeCount: input.nodeCount,
    contentDigest: input.contentDigest,
  });
  if (input.reused) state.reusedChunkIds.push(input.chunkId);
  else state.fetchedChunkIds.push(input.chunkId);
  state.dirty = true;
};

const stateAddNodeCount = (
  state: MutableImportState,
  nodeCount: number,
  phase: string,
): void => {
  state.metrics.nodeCount += nodeCount;
  updatePeakWorkingSetBytes(state);
  assertImportLimits(state, phase);
};

const resolveLargeBoardPolicy = (
  policy: FigmaSnapshotImportLimitMetadata | undefined,
): FigmaSnapshotImportLimitMetadata | undefined => {
  if (policy === undefined) return undefined;
  const normalized: FigmaSnapshotImportLimitMetadata = {
    ...(policy.maxNodeCount !== undefined
      ? {
          maxNodeCount: assertPositiveInteger(
            policy.maxNodeCount,
            "maxNodeCount",
          ),
        }
      : {}),
    ...(policy.maxPayloadBytes !== undefined
      ? {
          maxPayloadBytes: assertPositiveInteger(
            policy.maxPayloadBytes,
            "maxPayloadBytes",
          ),
        }
      : {}),
    ...(policy.maxPreviewTiles !== undefined
      ? {
          maxPreviewTiles: assertPositiveInteger(
            policy.maxPreviewTiles,
            "maxPreviewTiles",
          ),
        }
      : {}),
    ...(policy.maxPreviewBytes !== undefined
      ? {
          maxPreviewBytes: assertPositiveInteger(
            policy.maxPreviewBytes,
            "maxPreviewBytes",
          ),
        }
      : {}),
    ...(policy.maxElapsedMs !== undefined
      ? {
          maxElapsedMs: assertPositiveInteger(
            policy.maxElapsedMs,
            "maxElapsedMs",
          ),
        }
      : {}),
    ...(policy.maxWorkingSetBytes !== undefined
      ? {
          maxWorkingSetBytes: assertPositiveInteger(
            policy.maxWorkingSetBytes,
            "maxWorkingSetBytes",
          ),
        }
      : {}),
    ...(policy.maxChunkCount !== undefined
      ? {
          maxChunkCount: assertPositiveInteger(
            policy.maxChunkCount,
            "maxChunkCount",
          ),
        }
      : {}),
  };
  return Object.keys(normalized).length === 0 ? undefined : normalized;
};

const assertImportLimits = (state: MutableImportState, phase: string): void => {
  const limits = state.limits;
  if (limits === undefined) return;
  const metrics = snapshotPerformanceMetrics(state);
  if (
    limits.maxChunkCount !== undefined &&
    state.allChunkIds.length > limits.maxChunkCount
  ) {
    throwLimitExceeded("oversized_board", phase, "chunk count", {
      observed: state.allChunkIds.length,
      limit: limits.maxChunkCount,
    });
  }
  if (
    limits.maxNodeCount !== undefined &&
    metrics.nodeCount > limits.maxNodeCount
  ) {
    throwLimitExceeded("oversized_board", phase, "node count", {
      observed: metrics.nodeCount,
      limit: limits.maxNodeCount,
    });
  }
  if (
    limits.maxPayloadBytes !== undefined &&
    metrics.payloadBytes > limits.maxPayloadBytes
  ) {
    throwLimitExceeded("oversized_board", phase, "payload bytes", {
      observed: metrics.payloadBytes,
      limit: limits.maxPayloadBytes,
    });
  }
  if (
    limits.maxPreviewBytes !== undefined &&
    metrics.previewBytes > limits.maxPreviewBytes
  ) {
    throwLimitExceeded("oversized_board", phase, "preview bytes", {
      observed: metrics.previewBytes,
      limit: limits.maxPreviewBytes,
    });
  }
  if (
    limits.maxElapsedMs !== undefined &&
    metrics.elapsedMs > limits.maxElapsedMs
  ) {
    throwLimitExceeded("budget_exhausted", phase, "elapsed milliseconds", {
      observed: metrics.elapsedMs,
      limit: limits.maxElapsedMs,
    });
  }
  if (
    limits.maxWorkingSetBytes !== undefined &&
    metrics.peakWorkingSetBytes > limits.maxWorkingSetBytes
  ) {
    throwLimitExceeded("budget_exhausted", phase, "working-set bytes", {
      observed: metrics.peakWorkingSetBytes,
      limit: limits.maxWorkingSetBytes,
    });
  }
};

const snapshotPerformanceMetrics = (
  state: MutableImportState,
): FigmaSnapshotImportPerformanceMetrics => {
  const payloadBytes =
    sumValues(state.metrics.chunkPayloadBytes) +
    state.metrics.nodeIndexBytes +
    state.metrics.previewManifestBytes +
    state.metrics.previewAssetBytes +
    state.metrics.manifestBytes;
  const elapsedMs = Math.max(0, Math.ceil(state.nowMs() - state.startedAtMs));
  const peakHeapUsedBytes = state.metrics.peakHeapUsedBytes;
  return {
    elapsedMs,
    nodeCount: state.metrics.nodeCount,
    payloadBytes,
    previewBytes:
      state.metrics.previewManifestBytes + state.metrics.previewAssetBytes,
    chunkCount: state.allChunkIds.length,
    previewCount: state.metrics.previewCount,
    skippedPreviewCount: state.metrics.skippedPreviewCount,
    fetchedChunkCount: state.fetchedChunkIds.length,
    reusedChunkCount: state.reusedChunkIds.length,
    cacheHitCount: state.reusedChunkIds.length,
    liveRestCallCount: state.metrics.liveRestCallCount,
    liveRestCallsAvoided: state.reusedChunkIds.length,
    resumedChunkCount: state.metrics.resumedChunkCount,
    peakWorkingSetBytes: state.metrics.peakWorkingSetBytes,
    ...(peakHeapUsedBytes !== undefined ? { peakHeapUsedBytes } : {}),
  };
};

const updatePeakWorkingSetBytes = (state: MutableImportState): void => {
  const payloadBytes =
    sumValues(state.metrics.chunkPayloadBytes) +
    state.metrics.nodeIndexBytes +
    state.metrics.previewManifestBytes +
    state.metrics.previewAssetBytes +
    state.metrics.manifestBytes +
    state.metrics.importStatusBytes;
  state.metrics.peakWorkingSetBytes = Math.max(
    state.metrics.peakWorkingSetBytes,
    payloadBytes,
  );
  const heapUsed = state.memoryUsage?.().heapUsed;
  if (heapUsed !== undefined && Number.isFinite(heapUsed) && heapUsed >= 0) {
    state.metrics.peakHeapUsedBytes = Math.max(
      state.metrics.peakHeapUsedBytes ?? 0,
      Math.ceil(heapUsed),
    );
  }
};

const sumValues = (values: ReadonlyMap<string, number>): number => {
  let total = 0;
  for (const value of values.values()) total += value;
  return total;
};

const assertPositiveInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new FigmaStagedImportError({
      errorCode: "invalid_request",
      failureClass: "invalid_request",
      message: `Figma staged import ${label} must be a positive integer`,
      retryable: false,
    });
  }
  return value;
};

const throwLimitExceeded = (
  failureClass: FigmaSnapshotImportFailureClass,
  phase: string,
  label: string,
  input: { readonly observed: number; readonly limit: number },
): never => {
  throw new FigmaStagedImportError({
    errorCode: failureClassToErrorCode(failureClass),
    failureClass,
    message: `Figma staged import ${phase} exceeded ${label} budget (${input.observed} > ${input.limit})`,
    retryable: false,
  });
};

const withArtifactDigest = <
  T extends
    | FigmaSnapshotManifest
    | FigmaSnapshotNodeIndex
    | FigmaSnapshotImportStatus,
>(
  input: Omit<T, "contentDigest">,
): T => {
  const candidate = { ...input, contentDigest: ZERO_DIGEST } as T;
  return {
    ...candidate,
    contentDigest: computeFigmaSnapshotArtifactDigest(candidate),
  };
};

const withChunkDigest = <T extends StagedChunkArtifact>(
  input: Omit<T, "contentDigest">,
): T => {
  const candidate = { ...input, contentDigest: ZERO_DIGEST } as T;
  return {
    ...candidate,
    contentDigest: computeChunkDigest(candidate),
  };
};

const computeChunkDigest = (chunk: StagedChunkArtifact): string => {
  const { contentDigest: _contentDigest, ...rest } = chunk;
  return sha256Hex(rest);
};

const computeFigmaRevisionDigest = (input: {
  version?: string;
  lastModified?: string;
  document: FigmaRestNode;
}): string =>
  sha256Hex({
    plannerVersion: PLANNER_VERSION,
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.lastModified !== undefined
      ? { lastModified: input.lastModified }
      : {}),
    bootstrapRoot: summarizeBootstrapNode(input.document),
  });

const summarizeBootstrapNode = (node: FigmaRestNode): unknown => ({
  id: node.id,
  type: node.type,
  name: sanitizePersistedText(node.name ?? node.id, node.id),
  children: summarizeBootstrapChildren(node),
});

const summarizeBootstrapChildren = (root: FigmaRestNode): unknown[] => {
  const outputByNode = new Map<FigmaRestNode, unknown>();
  const stack: Array<{ node: FigmaRestNode; visited: boolean }> = [
    { node: root, visited: false },
  ];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current.visited) {
      outputByNode.set(current.node, {
        id: current.node.id,
        type: current.node.type,
        name: sanitizePersistedText(
          current.node.name ?? current.node.id,
          current.node.id,
        ),
        children: (current.node.children ?? []).map((child) =>
          outputByNode.get(child),
        ),
      });
      continue;
    }
    stack.push({ node: current.node, visited: true });
    const children = current.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) stack.push({ node: child, visited: false });
    }
  }
  const rootSummary = outputByNode.get(root) as
    | { children?: unknown[] }
    | undefined;
  return rootSummary?.children ?? [];
};

const buildSnapshotId = (input: {
  source: FigmaSnapshotSourceIdentifier;
  figmaRevisionDigest: string;
  rootNodeIds: readonly string[];
}): string =>
  `snap-${sha256Hex({
    plannerVersion: PLANNER_VERSION,
    source: input.source,
    figmaRevisionDigest: input.figmaRevisionDigest,
    rootNodeIds: [...input.rootNodeIds].sort(),
  }).slice(0, 32)}`;

const buildChunkId = (input: {
  kind: StagedChunkKind;
  source: FigmaSnapshotSourceIdentifier;
  figmaRevisionDigest: string;
  nodeId: string;
}): string =>
  `${input.kind === "node" ? "node" : "image"}-${sha256Hex({
    plannerVersion: PLANNER_VERSION,
    kind: input.kind,
    source: input.source,
    figmaRevisionDigest: input.figmaRevisionDigest,
    nodeId: input.nodeId,
  }).slice(0, 32)}`;

const writeJsonAtomically = async (
  path: string,
  content: string,
  options: { readonly workspaceRoot?: string; readonly label?: string } = {},
): Promise<void> => {
  const label = options.label ?? "Figma staged import artifact";
  try {
    if (options.workspaceRoot !== undefined) {
      await ensureFigmaSnapshotVaultDirectory({
        workspaceRoot: options.workspaceRoot,
        directoryPath: dirname(path),
        label,
      });
      await assertFigmaSnapshotVaultPathContained({
        workspaceRoot: options.workspaceRoot,
        targetPath: path,
        label,
      });
    } else {
      await mkdir(dirname(path), { recursive: true });
    }
  } catch (err) {
    throw wrapVaultPersistenceError(err, label);
  }
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  if (options.workspaceRoot !== undefined) {
    try {
      await assertFigmaSnapshotVaultPathContained({
        workspaceRoot: options.workspaceRoot,
        targetPath: tempPath,
        label: `${label} temporary file`,
      });
    } catch (err) {
      throw wrapVaultPersistenceError(err, label);
    }
  }
  await writeFile(
    tempPath,
    content.endsWith("\n") ? content : `${content}\n`,
    "utf8",
  );
  await rename(tempPath, path);
};

const chunkFilePath = (vaultPath: string, chunkId: string): string =>
  join(vaultPath, STAGING_CHUNKS_DIRECTORY, `${chunkId}.json`);

const wrapVaultPersistenceError = (err: unknown, label: string): Error => {
  if (err instanceof FigmaStagedImportError) return err;
  if (err instanceof FigmaSnapshotVaultError) {
    const failureClass =
      err.errorCode === "unsafe_path" ? "unsafe_path" : "persistence_failed";
    return new FigmaStagedImportError({
      errorCode: failureClassToErrorCode(failureClass),
      failureClass,
      message: `${label} failed Snapshot Vault containment or persistence checks`,
      retryable: false,
      cause: err,
    });
  }
  return err instanceof Error
    ? err
    : new Error("Snapshot Vault persistence failed");
};

const readJsonIfExists = async (
  path: string,
  options: { readonly workspaceRoot?: string; readonly label?: string } = {},
): Promise<unknown | undefined> => {
  try {
    if (options.workspaceRoot !== undefined) {
      await assertFigmaSnapshotVaultPathContained({
        workspaceRoot: options.workspaceRoot,
        targetPath: path,
        label: options.label ?? "Figma staged import JSON artifact",
      });
    }
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (err) {
    if (isFileNotFound(err)) return undefined;
    throw err;
  }
};

const chunkArray = <T>(items: readonly T[], size: number): readonly T[][] => {
  if (!Number.isInteger(size) || size <= 0) {
    throw new FigmaStagedImportError({
      errorCode: "figma_fetch_failed",
      message: "Figma staged import batch size must be a positive integer",
      retryable: false,
    });
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const wrapInitialImportError = (
  err: unknown,
  rateLimit?: MutableRateLimitMetadata,
): FigmaStagedImportError => {
  const rateLimitDiagnostics =
    rateLimit === undefined ? undefined : buildRateLimitDiagnostics(rateLimit);
  if (err instanceof FigmaStagedImportError) {
    if (
      err.rateLimitDiagnostics !== undefined ||
      rateLimitDiagnostics === undefined
    ) {
      return err;
    }
    return new FigmaStagedImportError({
      errorCode: err.errorCode,
      failureClass: err.failureClass,
      message: err.message,
      retryable: err.retryable,
      ...(err.checkpoint !== undefined ? { checkpoint: err.checkpoint } : {}),
      rateLimitDiagnostics,
      cause: err,
    });
  }
  const failureClass = classifyImportFailure(err);
  return buildImportError({
    err,
    failureClass,
    ...(rateLimitDiagnostics !== undefined ? { rateLimitDiagnostics } : {}),
  });
};

const wrapImportError = (
  err: unknown,
  state: MutableImportState,
  failureClass: FigmaSnapshotImportFailureClass = classifyImportFailure(err),
): FigmaStagedImportError => {
  if (err instanceof FigmaStagedImportError) {
    if (err.checkpoint !== undefined || state.status === undefined) return err;
    const rateLimitDiagnostics =
      err.rateLimitDiagnostics ?? buildRateLimitDiagnostics(state.rateLimit);
    return new FigmaStagedImportError({
      errorCode: err.errorCode,
      failureClass: err.failureClass,
      message: err.message,
      retryable: err.retryable,
      checkpoint: state.status,
      ...(rateLimitDiagnostics !== undefined ? { rateLimitDiagnostics } : {}),
      cause: err,
    });
  }
  const rateLimitDiagnostics = buildRateLimitDiagnostics(state.rateLimit);
  return buildImportError({
    err,
    failureClass,
    ...(state.status !== undefined ? { checkpoint: state.status } : {}),
    ...(rateLimitDiagnostics !== undefined ? { rateLimitDiagnostics } : {}),
  });
};

const buildImportError = (input: {
  err: unknown;
  failureClass: FigmaSnapshotImportFailureClass;
  checkpoint?: FigmaSnapshotImportStatus;
  rateLimitDiagnostics?: FigmaImportRateLimitDiagnostics;
}): FigmaStagedImportError => {
  const errorCode = failureClassToErrorCode(input.failureClass);
  if (input.err instanceof FigmaImportGovernanceError) {
    return new FigmaStagedImportError({
      errorCode,
      failureClass: input.failureClass,
      message: `Figma staged import governance failed (${input.failureClass}): ${input.err.message}`,
      retryable: false,
      ...(input.checkpoint !== undefined
        ? { checkpoint: input.checkpoint }
        : {}),
      ...(input.rateLimitDiagnostics !== undefined
        ? { rateLimitDiagnostics: input.rateLimitDiagnostics }
        : {}),
      cause: input.err,
    });
  }
  if (input.err instanceof FigmaRestFetchError) {
    return new FigmaStagedImportError({
      errorCode,
      failureClass: input.failureClass,
      message: `Figma staged import REST fetch failed (${input.err.errorClass}).`,
      retryable: input.err.retryable,
      ...(input.checkpoint !== undefined
        ? { checkpoint: input.checkpoint }
        : {}),
      ...(input.rateLimitDiagnostics !== undefined
        ? { rateLimitDiagnostics: input.rateLimitDiagnostics }
        : {}),
      cause: input.err,
    });
  }
  return new FigmaStagedImportError({
    errorCode,
    failureClass: input.failureClass,
    message: `Figma staged import failed: ${sanitizeErrorMessage({
      error: input.err,
      fallback: "unknown failure",
    })}`,
    retryable: false,
    ...(input.checkpoint !== undefined ? { checkpoint: input.checkpoint } : {}),
    ...(input.rateLimitDiagnostics !== undefined
      ? { rateLimitDiagnostics: input.rateLimitDiagnostics }
      : {}),
    cause: input.err,
  });
};

const buildRateLimitDiagnostics = (
  metadata: MutableRateLimitMetadata,
): FigmaImportRateLimitDiagnostics | undefined => {
  const diagnostics: FigmaImportRateLimitDiagnostics = {
    ...(metadata.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: metadata.retryAfterSeconds }
      : {}),
    ...(metadata.remaining !== undefined
      ? { remaining: metadata.remaining }
      : {}),
    ...(metadata.resetAt !== undefined ? { resetAt: metadata.resetAt } : {}),
    ...(metadata.figmaPlanTier !== undefined
      ? { figmaPlanTier: metadata.figmaPlanTier }
      : {}),
    ...(metadata.figmaRateLimitType !== undefined
      ? { figmaRateLimitType: metadata.figmaRateLimitType }
      : {}),
    ...(metadata.figmaUpgradeLinkDigest !== undefined
      ? { figmaUpgradeLinkDigest: metadata.figmaUpgradeLinkDigest }
      : {}),
    ...(metadata.remediation !== undefined
      ? { remediation: metadata.remediation }
      : {}),
  };
  return Object.keys(diagnostics).length === 0 ? undefined : diagnostics;
};

const classifyImportFailure = (
  err: unknown,
): FigmaSnapshotImportFailureClass => {
  if (err instanceof FigmaImportGovernanceError) return err.failureClass;
  if (err instanceof FigmaStagedImportError) return err.failureClass;
  if (err instanceof FigmaSnapshotVaultError) {
    switch (err.errorCode) {
      case "unsafe_path":
        return "unsafe_path";
      case "invalid_snapshot":
        return "invalid_snapshot";
      case "persistence_failed":
        return "persistence_failed";
    }
  }
  if (err instanceof FigmaRestFetchError) {
    switch (err.errorClass) {
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
      case "transport":
      case "timeout":
        return "transport";
    }
  }
  return "transport";
};

const failureClassToErrorCode = (
  failureClass: FigmaSnapshotImportFailureClass,
): FigmaStagedImportErrorCode => {
  switch (failureClass) {
    case "throttled":
      return "rate_limited";
    case "oversized_board":
    case "corrupted_checkpoint":
    case "missing_chunk":
    case "invalid_snapshot":
    case "unsafe_path":
    case "non_resumable_partial_state":
      return failureClass;
    case "missing_credential":
    case "invalid_credential":
    case "unsupported_auth_mode":
    case "budget_exhausted":
    case "invalid_request":
      return failureClass;
    case "persistence_failed":
      return "persist_failed";
    case "not_found":
    case "transport":
      return "figma_fetch_failed";
  }
};

const errorCodeToFailureClass = (
  errorCode: FigmaStagedImportErrorCode,
): FigmaSnapshotImportFailureClass => {
  switch (errorCode) {
    case "rate_limited":
      return "throttled";
    case "missing_credential":
    case "invalid_credential":
    case "unsupported_auth_mode":
    case "budget_exhausted":
    case "invalid_request":
      return errorCode;
    case "oversized_board":
    case "corrupted_checkpoint":
    case "missing_chunk":
    case "invalid_snapshot":
    case "unsafe_path":
    case "non_resumable_partial_state":
      return errorCode;
    case "persist_failed":
      return "persistence_failed";
    case "checkpoint_rejected":
    case "chunk_rejected":
      return "invalid_request";
    case "figma_fetch_failed":
      return "transport";
  }
};

const isOversizedFigmaError = (err: unknown): boolean =>
  err instanceof FigmaRestFetchError &&
  err.errorClass === "transport" &&
  /exceeds\s+\d+\s+bytes/iu.test(err.message);

const isFileNotFound = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: unknown }).code === "ENOENT";

const normalizeRequiredString = (
  label: string,
  value: string | undefined,
): string => {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new FigmaStagedImportError({
      errorCode: "figma_fetch_failed",
      message: `${label} is required`,
      retryable: false,
    });
  }
  return normalized;
};

const sanitizePersistedText = (value: string, fallback: string): string => {
  const sanitized = redactHighRiskSecrets(value, "[REDACTED]")
    .replace(FIGMA_TOKEN_LIKE_GLOBAL_RE, "[REDACTED]")
    .replace(URI_LIKE_GLOBAL_RE, "[URI_REDACTED]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
  if (sanitized.length > 0) return sanitized;
  return fallback
    .replace(URI_LIKE_GLOBAL_RE, "[URI_REDACTED]")
    .slice(0, MAX_TEXT_LENGTH);
};

const sanitizeDiagnosticMessage = (value: string): string =>
  redactHighRiskSecrets(value, "[REDACTED]")
    .replace(FIGMA_TOKEN_LIKE_GLOBAL_RE, "[REDACTED]")
    .replace(URI_LIKE_GLOBAL_RE, "[URI_REDACTED]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);

const sanitizeRateLimitLabel = (
  value: string | undefined,
): string | undefined => {
  const sanitized =
    value === undefined
      ? undefined
      : sanitizeDiagnosticMessage(value)
          .replace(/[^\w.-]+/gu, "_")
          .slice(0, 120);
  return sanitized === undefined || sanitized.length === 0
    ? undefined
    : sanitized;
};

const assertNoUnsafeStrings = (value: unknown, path = "$"): void => {
  if (typeof value === "string") {
    const redacted = redactHighRiskSecrets(value, "[REDACTED]");
    if (redacted !== value || FIGMA_TOKEN_LIKE_RE.test(value)) {
      throw new Error(`${path} contains token-bearing content`);
    }
    if (URI_LIKE_RE.test(value)) {
      throw new Error(`${path} contains a raw URI`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoUnsafeStrings(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertNoUnsafeStrings(entry, `${path}.${key}`);
    }
  }
};

const jsonEqual = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);
