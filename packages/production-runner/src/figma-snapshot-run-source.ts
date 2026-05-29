import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  FigmaSnapshotImportStatus,
  FigmaSnapshotManifest,
  FigmaSnapshotNodeIndex,
  FigmaSnapshotNodeRecord,
  GeneratedTestCaseSnapshotSourceRef,
  TenantScope,
} from "@oscharko-dev/ti-contracts";
import {
  canonicalJson,
  sanitizeErrorMessage,
  sha256Hex,
} from "@oscharko-dev/ti-security";
import { resolveTenantScopeSegments } from "@oscharko-dev/ti-tenant";
import {
  type IntentDerivationFigmaInput,
  validateFigmaSnapshotImportStatus,
  validateFigmaSnapshotManifest,
  validateFigmaSnapshotNodeIndex,
} from "@oscharko-dev/ti-core-engine";

const SNAPSHOT_VAULT_ROOT_SEGMENT = ".test-intelligence" as const;
const SNAPSHOT_VAULT_DIRNAME = "figma-snapshots" as const;
const MANIFEST_FILENAME = "manifest.json" as const;
const NODE_INDEX_FILENAME = "node-index.json" as const;
const IMPORT_STATUS_FILENAME = "import-status.json" as const;
const SNAPSHOT_ID_RE = /^[A-Za-z0-9._-]+$/u;
const URL_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;

export type FigmaSnapshotRunSourceErrorCode =
  | "unsafe_path"
  | "missing_snapshot"
  | "invalid_snapshot"
  | "cross_tenant_snapshot"
  | "empty_scope";

export class FigmaSnapshotRunSourceError extends Error {
  readonly errorCode: FigmaSnapshotRunSourceErrorCode;

  constructor(input: {
    errorCode: FigmaSnapshotRunSourceErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(
      sanitizeErrorMessage({
        error: input.message,
        fallback: "Figma snapshot source resolution failed",
      }),
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "FigmaSnapshotRunSourceError";
    this.errorCode = input.errorCode;
  }
}

export interface FigmaSnapshotScopeSelectionInput {
  readonly nodeIds?: readonly string[];
  readonly pageIds?: readonly string[];
  readonly frameIds?: readonly string[];
}

export interface FigmaSnapshotRunSourceInput {
  readonly workspaceRoot: string;
  readonly tenantScope: TenantScope;
  readonly snapshotId: string;
  readonly selection?: FigmaSnapshotScopeSelectionInput;
}

export interface FigmaSnapshotTraceAnchor {
  readonly screenId: string;
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodePath?: string;
}

export interface ResolvedFigmaSnapshotRunSource {
  readonly fileKey: string;
  readonly name: string;
  readonly payloadBytes: number;
  readonly manifest: FigmaSnapshotManifest;
  readonly nodeIndex: FigmaSnapshotNodeIndex;
  readonly importStatus: FigmaSnapshotImportStatus;
  readonly intentInput: IntentDerivationFigmaInput;
  readonly auditRef: GeneratedTestCaseSnapshotSourceRef;
  readonly traceAnchors: readonly FigmaSnapshotTraceAnchor[];
}

interface NormalizedSelection {
  readonly selectedNodeIds: readonly string[];
  readonly selectedPageIds: readonly string[];
  readonly selectedFrameIds: readonly string[];
}

interface SnapshotCandidate {
  readonly manifest: FigmaSnapshotManifest;
}

export const resolveFigmaSnapshotRunSource = async (
  input: FigmaSnapshotRunSourceInput,
): Promise<ResolvedFigmaSnapshotRunSource> => {
  assertSafeSnapshotId(input.snapshotId);
  const workspaceRoot = await resolveSafeWorkspaceRoot(input.workspaceRoot);
  const selection = normalizeSelection(input.selection);
  const manifest = await findSnapshotManifest({
    workspaceRoot,
    tenantScope: input.tenantScope,
    snapshotId: input.snapshotId,
  });
  assertSameTenantScope(input.tenantScope, manifest.tenantScope);
  const vaultPath = await assertVaultPathInsideWorkspace({
    workspaceRoot,
    tenantScope: input.tenantScope,
    fileKeyHash: manifest.source.fileKeyHash,
    snapshotId: input.snapshotId,
  });
  const nodeIndex = await readValidatedArtifact({
    path: join(vaultPath, NODE_INDEX_FILENAME),
    rootPath: vaultPath,
    label: "node index",
    validate: validateFigmaSnapshotNodeIndex,
  });
  const importStatus = await readValidatedArtifact({
    path: join(vaultPath, IMPORT_STATUS_FILENAME),
    rootPath: vaultPath,
    label: "import status",
    validate: validateFigmaSnapshotImportStatus,
  });
  assertSameSnapshotIdentity(manifest, nodeIndex, "node index");
  assertSameSnapshotIdentity(manifest, importStatus, "import status");
  if (manifest.artifactDigests.nodeIndexDigest !== nodeIndex.contentDigest) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "invalid_snapshot",
      message: "Figma snapshot manifest node-index digest mismatch.",
    });
  }
  if (manifest.artifactDigests.importStatusDigest !== importStatus.contentDigest) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "invalid_snapshot",
      message: "Figma snapshot manifest import-status digest mismatch.",
    });
  }
  if (importStatus.lifecycleState !== "completed") {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "invalid_snapshot",
      message: "Figma snapshot import status is not completed.",
    });
  }
  const selectedRecords = selectNodeRecords(nodeIndex.nodes, selection);
  if (selectedRecords.length === 0) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "empty_scope",
      message: "Figma snapshot selection matched no local nodes.",
    });
  }
  const resolvedNodeIds = selectedRecords.map((record) => record.nodeId).sort();
  const scopeDigest = sha256Hex({
    snapshotId: manifest.snapshotId,
    snapshotDigest: manifest.contentDigest,
    nodeIndexDigest: nodeIndex.contentDigest,
    requested: selection,
    resolvedNodeIds,
  });
  const intentInput = buildIntentInputFromSnapshotRecords({
    snapshotId: manifest.snapshotId,
    records: selectedRecords,
  });
  const traceAnchors = buildTraceAnchors(selectedRecords);
  return {
    fileKey: `snapshot-${manifest.snapshotId}`,
    name: `Figma snapshot ${manifest.snapshotId}`,
    payloadBytes: Buffer.byteLength(
      canonicalJson({
        manifestDigest: manifest.contentDigest,
        nodeIndexDigest: nodeIndex.contentDigest,
        scopeDigest,
        selectedNodeCount: selectedRecords.length,
      }),
      "utf8",
    ),
    manifest,
    nodeIndex,
    importStatus,
    intentInput,
    auditRef: {
      snapshotId: manifest.snapshotId,
      snapshotDigest: manifest.contentDigest,
      nodeIndexDigest: nodeIndex.contentDigest,
      scopeDigest,
      selectedNodeIds: resolvedNodeIds,
      selectedPageIds: [...selection.selectedPageIds],
      selectedFrameIds: [...selection.selectedFrameIds],
    },
    traceAnchors,
  };
};

const resolveSafeWorkspaceRoot = async (workspaceRoot: string): Promise<string> => {
  if (
    workspaceRoot.length === 0 ||
    workspaceRoot.includes("\0") ||
    URL_SCHEME_RE.test(workspaceRoot) ||
    !isAbsolute(workspaceRoot)
  ) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "unsafe_path",
      message: "Figma snapshot workspace root must be an absolute local path.",
    });
  }
  const absolute = resolve(workspaceRoot);
  try {
    const stats = await stat(absolute);
    if (!stats.isDirectory()) {
      throw new Error("workspace root is not a directory");
    }
    return await realpath(absolute);
  } catch (err) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "unsafe_path",
      message: `Figma snapshot workspace root rejected: ${sanitizeErrorMessage({
        error: err,
        fallback: "invalid workspace root",
      })}`,
      cause: err,
    });
  }
};

const findSnapshotManifest = async (input: {
  readonly workspaceRoot: string;
  readonly tenantScope: TenantScope;
  readonly snapshotId: string;
}): Promise<FigmaSnapshotManifest> => {
  const [tenantId, environmentId, projectId] = resolveTenantScopeSegments(
    input.tenantScope,
  );
  const tenantRoot = await resolveExistingDirectoryInsideWorkspace({
    workspaceRoot: input.workspaceRoot,
    path: join(
      input.workspaceRoot,
      SNAPSHOT_VAULT_ROOT_SEGMENT,
      SNAPSHOT_VAULT_DIRNAME,
      tenantId,
      environmentId,
      projectId,
    ),
    missingMessage: "Figma snapshot tenant vault was not found.",
  });
  const candidates: SnapshotCandidate[] = [];
  let entries;
  try {
    entries = await readdir(tenantRoot, { withFileTypes: true });
  } catch (err) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "missing_snapshot",
      message: "Figma snapshot tenant vault was not found.",
      cause: err,
    });
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidatePath = join(tenantRoot, entry.name, input.snapshotId);
    let candidateRoot: string;
    try {
      candidateRoot = await resolveExistingDirectoryInsideWorkspace({
        workspaceRoot: input.workspaceRoot,
        path: candidatePath,
        missingMessage: "Figma snapshot directory is missing.",
      });
    } catch (err) {
      if (
        err instanceof FigmaSnapshotRunSourceError &&
        err.errorCode === "missing_snapshot"
      ) {
        continue;
      }
      throw err;
    }
    try {
      const manifest = await readValidatedArtifact({
        path: join(candidateRoot, MANIFEST_FILENAME),
        rootPath: candidateRoot,
        label: "manifest",
        validate: validateFigmaSnapshotManifest,
      });
      if (manifest.snapshotId !== input.snapshotId) {
        throw new FigmaSnapshotRunSourceError({
          errorCode: "invalid_snapshot",
          message: "Figma snapshot manifest id does not match the requested snapshot.",
        });
      }
      if (manifest.source.fileKeyHash !== entry.name) {
        throw new FigmaSnapshotRunSourceError({
          errorCode: "invalid_snapshot",
          message: "Figma snapshot manifest source does not match the vault path.",
        });
      }
      candidates.push({ manifest });
    } catch (err) {
      if (
        err instanceof FigmaSnapshotRunSourceError &&
        err.errorCode === "missing_snapshot"
      ) {
        continue;
      }
      throw err;
    }
  }
  if (candidates.length === 0) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "missing_snapshot",
      message: "Figma snapshot was not found for the active tenant scope.",
    });
  }
  if (candidates.length > 1) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "invalid_snapshot",
      message: "Figma snapshot id resolved to multiple local vault entries.",
    });
  }
  return candidates[0]!.manifest;
};

const readValidatedArtifact = async <T>(input: {
  readonly path: string;
  readonly rootPath: string;
  readonly label: string;
  readonly validate: (value: unknown) => T;
}): Promise<T> => {
  let artifactPath: string;
  try {
    artifactPath = await resolveExistingFileInsideRoot({
      rootPath: input.rootPath,
      path: input.path,
      label: input.label,
    });
  } catch (err) {
    if (err instanceof FigmaSnapshotRunSourceError) {
      throw err;
    }
    throw new FigmaSnapshotRunSourceError({
      errorCode: "missing_snapshot",
      message: `Figma snapshot ${input.label} is missing.`,
      cause: err,
    });
  }
  let raw: string;
  try {
    raw = await readFile(artifactPath, "utf8");
  } catch (err) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "missing_snapshot",
      message: `Figma snapshot ${input.label} is missing.`,
      cause: err,
    });
  }
  try {
    return input.validate(JSON.parse(raw) as unknown);
  } catch (err) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "invalid_snapshot",
      message: `Figma snapshot ${input.label} is invalid: ${sanitizeErrorMessage({
        error: err,
        fallback: "validation failed",
      })}`,
      cause: err,
    });
  }
};

const resolveExistingDirectoryInsideWorkspace = async (input: {
  readonly workspaceRoot: string;
  readonly path: string;
  readonly missingMessage: string;
}): Promise<string> => {
  const absolutePath = resolve(input.path);
  assertPathInsideRoot({
    rootPath: input.workspaceRoot,
    candidatePath: absolutePath,
    message: "Figma snapshot path escaped the workspace root.",
  });
  let stats;
  try {
    stats = await stat(absolutePath);
  } catch (err) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "missing_snapshot",
      message: input.missingMessage,
      cause: err,
    });
  }
  if (!stats.isDirectory()) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "unsafe_path",
      message: "Figma snapshot path is not a directory.",
    });
  }
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(absolutePath);
  } catch (err) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "missing_snapshot",
      message: input.missingMessage,
      cause: err,
    });
  }
  assertPathInsideRoot({
    rootPath: input.workspaceRoot,
    candidatePath: canonicalPath,
    message: "Figma snapshot path resolved outside the workspace root.",
  });
  return canonicalPath;
};

const resolveExistingFileInsideRoot = async (input: {
  readonly rootPath: string;
  readonly path: string;
  readonly label: string;
}): Promise<string> => {
  const absolutePath = resolve(input.path);
  assertPathInsideRoot({
    rootPath: input.rootPath,
    candidatePath: absolutePath,
    message: `Figma snapshot ${input.label} path escaped its vault root.`,
  });
  let stats;
  try {
    stats = await stat(absolutePath);
  } catch (err) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "missing_snapshot",
      message: `Figma snapshot ${input.label} is missing.`,
      cause: err,
    });
  }
  if (!stats.isFile()) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "unsafe_path",
      message: `Figma snapshot ${input.label} path is not a file.`,
    });
  }
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(absolutePath);
  } catch (err) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "missing_snapshot",
      message: `Figma snapshot ${input.label} is missing.`,
      cause: err,
    });
  }
  assertPathInsideRoot({
    rootPath: input.rootPath,
    candidatePath: canonicalPath,
    message: `Figma snapshot ${input.label} resolved outside its vault root.`,
  });
  return canonicalPath;
};

const assertPathInsideRoot = (input: {
  readonly rootPath: string;
  readonly candidatePath: string;
  readonly message: string;
}): void => {
  const relativePath = relative(input.rootPath, input.candidatePath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    relativePath.includes(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "unsafe_path",
      message: input.message,
    });
  }
};

const assertVaultPathInsideWorkspace = async (input: {
  readonly workspaceRoot: string;
  readonly tenantScope: TenantScope;
  readonly fileKeyHash: string;
  readonly snapshotId: string;
}): Promise<string> => {
  const [tenantId, environmentId, projectId] = resolveTenantScopeSegments(
    input.tenantScope,
  );
  return resolveExistingDirectoryInsideWorkspace({
    workspaceRoot: input.workspaceRoot,
    path: resolve(
      input.workspaceRoot,
      SNAPSHOT_VAULT_ROOT_SEGMENT,
      SNAPSHOT_VAULT_DIRNAME,
      tenantId,
      environmentId,
      projectId,
      input.fileKeyHash,
      input.snapshotId,
    ),
    missingMessage: "Figma snapshot vault directory is missing.",
  });
};

/*
 * The helpers above intentionally use canonical `realpath` checks before any
 * snapshot artifact read. This rejects symlink escapes while still allowing a
 * normal workspace-local snapshot vault layout.
 */
const normalizeSelection = (
  selection: FigmaSnapshotScopeSelectionInput | undefined,
): NormalizedSelection => ({
  selectedNodeIds: normalizeIdList(selection?.nodeIds),
  selectedPageIds: normalizeIdList(selection?.pageIds),
  selectedFrameIds: normalizeIdList(selection?.frameIds),
});

const normalizeIdList = (values: readonly string[] | undefined): readonly string[] =>
  [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();

const selectNodeRecords = (
  records: readonly FigmaSnapshotNodeRecord[],
  selection: NormalizedSelection,
): readonly FigmaSnapshotNodeRecord[] => {
  const nodeIds = new Set(selection.selectedNodeIds);
  const pageIds = new Set(selection.selectedPageIds);
  const frameIds = new Set(selection.selectedFrameIds);
  const hasSelection = nodeIds.size > 0 || pageIds.size > 0 || frameIds.size > 0;
  return records
    .filter((record) => {
      if (!hasSelection) return true;
      return (
        nodeIds.has(record.nodeId) ||
        pageIds.has(record.pageId) ||
        (record.frameId !== undefined && frameIds.has(record.frameId))
      );
    })
    .sort(compareNodeRecords);
};

const buildIntentInputFromSnapshotRecords = (input: {
  readonly snapshotId: string;
  readonly records: readonly FigmaSnapshotNodeRecord[];
}): IntentDerivationFigmaInput => {
  const screenGroups = new Map<string, FigmaSnapshotNodeRecord[]>();
  for (const record of input.records) {
    const screenId = resolveScreenId(record);
    const existing = screenGroups.get(screenId);
    if (existing === undefined) {
      screenGroups.set(screenId, [record]);
    } else {
      existing.push(record);
    }
  }
  return {
    source: { kind: "hybrid" },
    screens: [...screenGroups.entries()]
      .map(([screenId, records]) => {
        const first = records[0]!;
        const screenName = first.frameName ?? first.pageName;
        const screenPath = [
          `snapshot:${input.snapshotId}`,
          first.pageName,
          first.frameName,
        ]
          .filter((value): value is string => value !== undefined)
          .join(" / ");
        return {
          screenId,
          screenName,
          screenPath,
          nodes: records.map((record) => ({
            nodeId: record.nodeId,
            nodeName: record.nodeName,
            nodeType: resolveIntentNodeType(record),
            nodePath: buildNodePath(record),
            ...(record.textSnippet !== undefined
              ? { text: record.textSnippet }
              : record.labels.length > 0
                ? { text: record.labels[0] }
                : {}),
            ...(record.componentHints.length > 0
              ? { componentName: record.componentHints.join(" ") }
              : {}),
            ...(record.bbox !== undefined ? { bbox: record.bbox } : {}),
          })),
        };
      })
      .sort((left, right) => left.screenId.localeCompare(right.screenId)),
  };
};

const buildTraceAnchors = (
  records: readonly FigmaSnapshotNodeRecord[],
): readonly FigmaSnapshotTraceAnchor[] => {
  const seenScreens = new Set<string>();
  const anchors: FigmaSnapshotTraceAnchor[] = [];
  for (const record of records) {
    const screenId = resolveScreenId(record);
    if (seenScreens.has(screenId)) continue;
    seenScreens.add(screenId);
    anchors.push({
      screenId,
      nodeId: record.nodeId,
      nodeName: record.nodeName,
      nodePath: buildNodePath(record),
    });
  }
  return anchors.sort((left, right) => left.screenId.localeCompare(right.screenId));
};

const resolveIntentNodeType = (record: FigmaSnapshotNodeRecord): string => {
  const search = [
    record.nodeType,
    record.nodeName,
    record.textSnippet,
    ...record.labels,
    ...record.componentHints,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase();
  if (/action:|button|submit|continue|weiter|absenden|confirm|save/u.test(search)) {
    return "BUTTON";
  }
  if (/field:|control:text-entry|input|textfield|textarea|eingabe|iban|bic/u.test(search)) {
    return "TEXT_FIELD";
  }
  if (/select|dropdown|radio|checkbox|choice|auswahl/u.test(search)) {
    return "SELECT_FIELD";
  }
  return record.nodeType;
};

const resolveScreenId = (record: FigmaSnapshotNodeRecord): string =>
  record.frameId ?? record.pageId;

const buildNodePath = (record: FigmaSnapshotNodeRecord): string =>
  [record.pageName, record.frameName, record.nodeName]
    .filter((value): value is string => value !== undefined)
    .join(" / ");

const compareNodeRecords = (
  left: FigmaSnapshotNodeRecord,
  right: FigmaSnapshotNodeRecord,
): number =>
  left.pageId.localeCompare(right.pageId) ||
  (left.frameId ?? "").localeCompare(right.frameId ?? "") ||
  left.nodeId.localeCompare(right.nodeId);

const assertSafeSnapshotId = (snapshotId: string): void => {
  if (!SNAPSHOT_ID_RE.test(snapshotId) || snapshotId === "." || snapshotId === "..") {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "unsafe_path",
      message: "Figma snapshot id contains unsafe path characters.",
    });
  }
};

const assertSameTenantScope = (
  expected: TenantScope,
  actual: TenantScope,
): void => {
  if (
    canonicalJson(resolveTenantScopeSegments(expected)) !==
    canonicalJson(resolveTenantScopeSegments(actual))
  ) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "cross_tenant_snapshot",
      message: "Figma snapshot tenant scope does not match the active run scope.",
    });
  }
};

const assertSameSnapshotIdentity = (
  manifest: FigmaSnapshotManifest,
  artifact: Pick<
    FigmaSnapshotNodeIndex | FigmaSnapshotImportStatus,
    "snapshotId" | "tenantScope" | "source"
  >,
  label: string,
): void => {
  if (
    manifest.snapshotId !== artifact.snapshotId ||
    canonicalJson(resolveTenantScopeSegments(manifest.tenantScope)) !==
      canonicalJson(resolveTenantScopeSegments(artifact.tenantScope)) ||
    canonicalJson(manifest.source) !== canonicalJson(artifact.source)
  ) {
    throw new FigmaSnapshotRunSourceError({
      errorCode: "invalid_snapshot",
      message: `Figma snapshot ${label} identity does not match manifest.`,
    });
  }
};
