import { lstat, mkdir, readdir, realpath, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION,
  FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
  FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION,
  FIGMA_SNAPSHOT_PREVIEW_MANIFEST_SCHEMA_VERSION,
  type FigmaSnapshotImportStatus,
  type FigmaSnapshotManifest,
  type FigmaSnapshotNodeIndex,
  type FigmaSnapshotPreviewManifest,
  type TenantScope,
} from "@oscharko-dev/ti-contracts";
import {
  canonicalJson,
  redactHighRiskSecrets,
  sha256Hex,
} from "@oscharko-dev/ti-security";
import { resolveTenantScopeSegments } from "@oscharko-dev/ti-tenant";
import * as z from "zod";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/u;
const SNAPSHOT_SEGMENT_RE = /^[A-Za-z0-9._-]+$/u;
const URL_LIKE_RE = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/u;
const FIGMA_TOKEN_LIKE_RE = /\bfigd_[A-Za-z0-9_-]{8,}\b/iu;
const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

const SNAPSHOT_VAULT_ROOT_SEGMENT = ".test-intelligence";
const SNAPSHOT_VAULT_DIRNAME = "figma-snapshots";

const PreviewStatuses = [
  "not_requested",
  "pending",
  "complete",
  "failed",
] as const;
const ImportStrategies = ["rest_file", "rest_nodes", "hybrid"] as const;
const LifecycleStates = [
  "queued",
  "fetching",
  "normalizing",
  "indexing",
  "previewing",
  "completed",
  "failed",
] as const;
const ChunkStates = ["pending", "completed", "failed"] as const;

export type FigmaSnapshotVaultErrorCode =
  | "invalid_snapshot"
  | "unsafe_path"
  | "persistence_failed";

export class FigmaSnapshotVaultError extends Error {
  readonly errorCode: FigmaSnapshotVaultErrorCode;

  constructor(input: {
    errorCode: FigmaSnapshotVaultErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "FigmaSnapshotVaultError";
    this.errorCode = input.errorCode;
  }
}

const sha256HexSchema = z
  .string()
  .regex(SHA256_HEX_RE, "must be 64 lowercase hex characters");

const stableSegmentSchema = (label: string): z.ZodType<string> =>
  z
    .string()
    .min(1, `${label} must be non-empty`)
    .regex(
      SNAPSHOT_SEGMENT_RE,
      `${label} must contain only ASCII letters, digits, '.', '_' or '-'`,
    )
    .refine(
      (value) => value !== "." && value !== "..",
      `${label} must not be '.' or '..'`,
    );

const isoTimestampSchema = z
  .string()
  .regex(ISO_8601_RE, "must be an ISO-8601 timestamp");

const tenantScopeSchema = z
  .strictObject({
    tenantId: stableSegmentSchema("tenantScope.tenantId"),
    environmentId: stableSegmentSchema("tenantScope.environmentId"),
    projectId: stableSegmentSchema("tenantScope.projectId").optional(),
  })
  .superRefine((scope, ctx) => {
    try {
      resolveTenantScopeSegments(
        scope.projectId === undefined
          ? {
              tenantId: scope.tenantId,
              environmentId: scope.environmentId,
            }
          : {
              tenantId: scope.tenantId,
              environmentId: scope.environmentId,
              projectId: scope.projectId,
            },
      );
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: (error as Error).message,
      });
    }
  });

const sourceIdentifierSchema = z.strictObject({
  fileKeyHash: sha256HexSchema,
  sourceUrlHash: sha256HexSchema,
  nodeId: z.string().min(1).optional(),
});

const bboxSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

const nodeChunkRefSchema = z.strictObject({
  chunkId: stableSegmentSchema("sourceChunkRefs.chunkId"),
  startNodePath: z.string().min(1).optional(),
  endNodePath: z.string().min(1).optional(),
});

const nodeRecordSchema = z.strictObject({
  pageId: z.string().min(1),
  pageName: z.string().min(1),
  frameId: z.string().min(1).optional(),
  frameName: z.string().min(1).optional(),
  nodeId: z.string().min(1),
  nodeName: z.string().min(1),
  nodeType: z.string().min(1),
  parentNodeId: z.string().min(1).optional(),
  ancestorNodeIds: z.array(z.string().min(1)),
  bbox: bboxSchema.optional(),
  labels: z.array(z.string().min(1)),
  textSnippet: z.string().min(1).optional(),
  componentHints: z.array(z.string().min(1)),
  visible: z.boolean(),
  sourceChunkRefs: z.array(nodeChunkRefSchema),
});

const previewAssetSchema = z.strictObject({
  assetId: stableSegmentSchema("assets.assetId"),
  relativePath: z
    .string()
    .min(1)
    .superRefine((value, ctx) => {
      try {
        assertSafeRelativePath("assets.relativePath", value);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: (error as Error).message,
        });
      }
    }),
  mediaType: z.string().min(1),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  byteLength: z.number().int().nonnegative(),
  sha256: sha256HexSchema,
});

const previewTileSchema = z.strictObject({
  tileId: stableSegmentSchema("tiles.tileId"),
  assetId: stableSegmentSchema("tiles.assetId"),
  pageId: z.string().min(1).optional(),
  frameId: z.string().min(1).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

const importRetrySchema = z.strictObject({
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextRetryAt: isoTimestampSchema.optional(),
  lastErrorCode: stableSegmentSchema("retry.lastErrorCode").optional(),
});

const importRateLimitSchema = z.strictObject({
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  remaining: z.number().int().nonnegative().optional(),
  resetAt: isoTimestampSchema.optional(),
});

const importCredentialSchema = z.strictObject({
  authMode: z.enum([
    "personal_access_token",
    "oauth_access_token",
    "enterprise_service_token",
  ]),
});

const importBudgetSchema = z.strictObject({
  policyVersion: z.string().min(1).max(120),
  resourceType: z
    .enum(["file_bootstrap", "node_batch", "image_metadata"])
    .optional(),
  windowSeconds: z.number().int().positive(),
  maxRequestsPerWindow: z.number().int().positive(),
  usedRequests: z.number().int().nonnegative(),
  remainingRequests: z.number().int().nonnegative(),
  resetAt: isoTimestampSchema.optional(),
});

const previewBudgetSchema = z.strictObject({
  maxTiles: z.number().int().positive(),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  candidateTileCount: z.number().int().nonnegative(),
  selectedTileCount: z.number().int().nonnegative(),
  skippedTileCount: z.number().int().nonnegative(),
});

const importFailureClassSchema = z.enum([
  "throttled",
  "budget_exhausted",
  "oversized_board",
  "corrupted_checkpoint",
  "missing_chunk",
  "invalid_snapshot",
  "unsafe_path",
  "non_resumable_partial_state",
  "missing_credential",
  "invalid_credential",
  "unsupported_auth_mode",
  "transport",
  "invalid_request",
  "not_found",
  "persistence_failed",
]);

const importLimitSchema = z.strictObject({
  maxNodeCount: z.number().int().positive().optional(),
  maxPayloadBytes: z.number().int().positive().optional(),
  maxPreviewTiles: z.number().int().positive().optional(),
  maxPreviewBytes: z.number().int().positive().optional(),
  maxElapsedMs: z.number().int().positive().optional(),
  maxWorkingSetBytes: z.number().int().positive().optional(),
  maxChunkCount: z.number().int().positive().optional(),
});

const importMetricsSchema = z.strictObject({
  elapsedMs: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  payloadBytes: z.number().int().nonnegative(),
  previewBytes: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  previewCount: z.number().int().nonnegative(),
  skippedPreviewCount: z.number().int().nonnegative(),
  fetchedChunkCount: z.number().int().nonnegative(),
  reusedChunkCount: z.number().int().nonnegative(),
  cacheHitCount: z.number().int().nonnegative(),
  liveRestCallCount: z.number().int().nonnegative(),
  liveRestCallsAvoided: z.number().int().nonnegative(),
  resumedChunkCount: z.number().int().nonnegative(),
  peakWorkingSetBytes: z.number().int().nonnegative(),
  peakHeapUsedBytes: z.number().int().nonnegative().optional(),
});

const importChunkSchema = z.strictObject({
  chunkId: stableSegmentSchema("chunks.chunkId"),
  state: z.enum(ChunkStates),
  nodeCount: z.number().int().nonnegative(),
  contentDigest: sha256HexSchema.optional(),
});

const importCheckpointSchema = z.strictObject({
  lastSuccessfulPhase: z.enum(LifecycleStates).optional(),
  resumeFromChunkId: stableSegmentSchema(
    "checkpoint.resumeFromChunkId",
  ).optional(),
  completedChunkIds: z.array(
    stableSegmentSchema("checkpoint.completedChunkIds"),
  ),
});

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION),
  snapshotId: stableSegmentSchema("snapshotId"),
  tenantScope: tenantScopeSchema,
  source: sourceIdentifierSchema,
  importStrategy: z.enum(ImportStrategies),
  figmaVersion: z.string().min(1).optional(),
  figmaLastModified: isoTimestampSchema.optional(),
  importedAt: isoTimestampSchema,
  artifactDigests: z.strictObject({
    nodeIndexDigest: sha256HexSchema,
    importStatusDigest: sha256HexSchema,
    previewManifestDigest: sha256HexSchema.optional(),
  }),
  contentDigest: sha256HexSchema,
});

const nodeIndexSchema = z.strictObject({
  schemaVersion: z.literal(FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION),
  snapshotId: stableSegmentSchema("snapshotId"),
  tenantScope: tenantScopeSchema,
  source: sourceIdentifierSchema,
  nodes: z.array(nodeRecordSchema),
  contentDigest: sha256HexSchema,
});

const previewManifestSchema = z.strictObject({
  schemaVersion: z.literal(FIGMA_SNAPSHOT_PREVIEW_MANIFEST_SCHEMA_VERSION),
  snapshotId: stableSegmentSchema("snapshotId"),
  tenantScope: tenantScopeSchema,
  source: sourceIdentifierSchema,
  previewStatus: z.enum(PreviewStatuses),
  boundedPreview: z.boolean(),
  budget: previewBudgetSchema.optional(),
  assets: z.array(previewAssetSchema),
  tiles: z.array(previewTileSchema),
  contentDigest: sha256HexSchema,
});

const importStatusSchema = z.strictObject({
  schemaVersion: z.literal(FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION),
  snapshotId: stableSegmentSchema("snapshotId"),
  tenantScope: tenantScopeSchema,
  source: sourceIdentifierSchema,
  lifecycleState: z.enum(LifecycleStates),
  retry: importRetrySchema,
  rateLimit: importRateLimitSchema,
  credential: importCredentialSchema.optional(),
  budget: importBudgetSchema.optional(),
  failureClass: importFailureClassSchema.optional(),
  limits: importLimitSchema.optional(),
  metrics: importMetricsSchema.optional(),
  chunks: z.array(importChunkSchema),
  checkpoint: importCheckpointSchema,
  contentDigest: sha256HexSchema,
});

export interface FigmaSnapshotVaultPathInput {
  readonly workspaceRoot: string;
  readonly tenantScope: TenantScope;
  readonly fileKeyHash: string;
  readonly snapshotId: string;
}

export interface FigmaSnapshotVaultContainmentInput {
  readonly workspaceRoot: string;
  readonly targetPath: string;
  readonly label: string;
}

export interface EnsureFigmaSnapshotVaultDirectoryInput {
  readonly workspaceRoot: string;
  readonly directoryPath: string;
  readonly label: string;
}

export interface CollectFigmaSnapshotVaultGarbageInput {
  readonly workspaceRoot: string;
  readonly tenantScope: TenantScope;
  readonly fileKeyHash: string;
  readonly retainSnapshotIds: readonly string[];
  readonly maxDeletedSnapshots?: number;
}

export interface FigmaSnapshotVaultGarbageCollectionResult {
  readonly rootPath: string;
  readonly deletedSnapshotIds: readonly string[];
  readonly deletedTempFiles: readonly string[];
  readonly retainedSnapshotIds: readonly string[];
}

type ArtifactWithDigest = { readonly contentDigest: string };

type ArtifactKind =
  | FigmaSnapshotManifest
  | FigmaSnapshotNodeIndex
  | FigmaSnapshotPreviewManifest
  | FigmaSnapshotImportStatus;

export const serializeFigmaSnapshotArtifact = (
  artifact: ArtifactKind,
): string => canonicalJson(artifact);

export const computeFigmaSnapshotArtifactDigest = <
  T extends ArtifactWithDigest,
>(
  artifact: T,
): string => sha256Hex(stripContentDigest(artifact));

export const buildFigmaSnapshotVaultPath = (
  input: FigmaSnapshotVaultPathInput,
): string => {
  if (input.workspaceRoot.length === 0) {
    throw new Error("workspaceRoot must be a non-empty string");
  }
  const [tenantId, environmentId, projectId] = resolveTenantScopeSegments(
    input.tenantScope,
  );
  assertSnapshotSegment("fileKeyHash", input.fileKeyHash, SHA256_HEX_RE);
  assertSnapshotSegment("snapshotId", input.snapshotId, SNAPSHOT_SEGMENT_RE);
  return join(
    input.workspaceRoot,
    SNAPSHOT_VAULT_ROOT_SEGMENT,
    SNAPSHOT_VAULT_DIRNAME,
    tenantId,
    environmentId,
    projectId,
    input.fileKeyHash,
    input.snapshotId,
  );
};

export const assertFigmaSnapshotVaultPathContained = async (
  input: FigmaSnapshotVaultContainmentInput,
): Promise<void> => {
  try {
    await assertNoSymlinkPathSegments({
      workspaceRoot: input.workspaceRoot,
      targetPath: input.targetPath,
      label: input.label,
    });
  } catch (err) {
    if (err instanceof FigmaSnapshotVaultError) throw err;
    throw new FigmaSnapshotVaultError({
      errorCode: "unsafe_path",
      message: `${input.label} failed Snapshot Vault path containment checks`,
      cause: err,
    });
  }
};

export const ensureFigmaSnapshotVaultDirectory = async (
  input: EnsureFigmaSnapshotVaultDirectoryInput,
): Promise<void> => {
  await assertFigmaSnapshotVaultPathContained({
    workspaceRoot: input.workspaceRoot,
    targetPath: input.directoryPath,
    label: input.label,
  });
  try {
    await mkdir(input.directoryPath, { recursive: true });
  } catch (err) {
    throw new FigmaSnapshotVaultError({
      errorCode: "persistence_failed",
      message: `${input.label} directory creation failed`,
      cause: err,
    });
  }
  await assertFigmaSnapshotVaultPathContained({
    workspaceRoot: input.workspaceRoot,
    targetPath: input.directoryPath,
    label: input.label,
  });
  await assertRealPathContained({
    workspaceRoot: input.workspaceRoot,
    targetPath: input.directoryPath,
    label: input.label,
  });
};

export const collectFigmaSnapshotVaultGarbage = async (
  input: CollectFigmaSnapshotVaultGarbageInput,
): Promise<FigmaSnapshotVaultGarbageCollectionResult> => {
  assertSnapshotSegment("fileKeyHash", input.fileKeyHash, SHA256_HEX_RE);
  for (const snapshotId of input.retainSnapshotIds) {
    assertSnapshotSegment("retainSnapshotIds", snapshotId, SNAPSHOT_SEGMENT_RE);
  }
  if (
    input.maxDeletedSnapshots !== undefined &&
    (!Number.isInteger(input.maxDeletedSnapshots) ||
      input.maxDeletedSnapshots < 0)
  ) {
    throw new FigmaSnapshotVaultError({
      errorCode: "invalid_snapshot",
      message: "maxDeletedSnapshots must be a non-negative integer",
    });
  }

  const probePath = buildFigmaSnapshotVaultPath({
    workspaceRoot: input.workspaceRoot,
    tenantScope: input.tenantScope,
    fileKeyHash: input.fileKeyHash,
    snapshotId: "gc-root-probe",
  });
  const rootPath = dirname(probePath);
  await assertFigmaSnapshotVaultPathContained({
    workspaceRoot: input.workspaceRoot,
    targetPath: rootPath,
    label: "Figma snapshot GC root",
  });
  if (!(await pathExists(rootPath))) {
    return {
      rootPath,
      deletedSnapshotIds: [],
      deletedTempFiles: [],
      retainedSnapshotIds: [...input.retainSnapshotIds].sort(),
    };
  }
  await assertRealPathContained({
    workspaceRoot: input.workspaceRoot,
    targetPath: rootPath,
    label: "Figma snapshot GC root",
  });

  const retain = new Set(input.retainSnapshotIds);
  const deletedSnapshotIds: string[] = [];
  const deletedTempFiles: string[] = [];
  const maxDeletedSnapshots =
    input.maxDeletedSnapshots ?? Number.POSITIVE_INFINITY;
  const entries = [...(await readdir(rootPath, { withFileTypes: true }))].sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const entryPath = join(rootPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new FigmaSnapshotVaultError({
        errorCode: "unsafe_path",
        message: "Figma snapshot GC refused a symlinked vault entry",
      });
    }
    if (entry.isFile() && entry.name.endsWith(".tmp")) {
      await assertFigmaSnapshotVaultPathContained({
        workspaceRoot: input.workspaceRoot,
        targetPath: entryPath,
        label: "Figma snapshot GC temporary file",
      });
      await unlink(entryPath);
      deletedTempFiles.push(entry.name);
      continue;
    }
    if (!entry.isDirectory()) continue;
    assertSnapshotSegment("snapshotId", entry.name, SNAPSHOT_SEGMENT_RE);
    if (retain.has(entry.name)) continue;
    if (deletedSnapshotIds.length >= maxDeletedSnapshots) continue;
    await assertNoSymlinkDescendants({
      workspaceRoot: input.workspaceRoot,
      rootPath: entryPath,
      label: "Figma snapshot GC candidate",
    });
    await rm(entryPath, { recursive: true, force: false });
    deletedSnapshotIds.push(entry.name);
  }
  return {
    rootPath,
    deletedSnapshotIds,
    deletedTempFiles,
    retainedSnapshotIds: [...retain].sort(),
  };
};

export const validateFigmaSnapshotManifest = (
  input: unknown,
): FigmaSnapshotManifest =>
  validateArtifact(
    "figma snapshot manifest",
    input,
    manifestSchema,
  ) as FigmaSnapshotManifest;

export const validateFigmaSnapshotNodeIndex = (
  input: unknown,
): FigmaSnapshotNodeIndex =>
  validateArtifact(
    "figma snapshot node index",
    input,
    nodeIndexSchema,
  ) as FigmaSnapshotNodeIndex;

export const validateFigmaSnapshotPreviewManifest = (
  input: unknown,
): FigmaSnapshotPreviewManifest =>
  validateArtifact(
    "figma snapshot preview manifest",
    input,
    previewManifestSchema,
  ) as FigmaSnapshotPreviewManifest;

export const validateFigmaSnapshotImportStatus = (
  input: unknown,
): FigmaSnapshotImportStatus => {
  try {
    return validateArtifact(
      "figma snapshot import status",
      input,
      importStatusSchema,
    ) as FigmaSnapshotImportStatus;
  } catch (error) {
    const normalized = stripLegacyImportStatusRateLimitFields(input);
    if (normalized === input) throw error;
    const parsed = importStatusSchema.parse(
      normalized,
    ) as FigmaSnapshotImportStatus;
    assertNoSensitiveStrings(parsed);
    assertNoSensitiveStrings(input);
    const expectedLegacyDigest = computeFigmaSnapshotArtifactDigest(
      input as ArtifactWithDigest,
    );
    if (parsed.contentDigest !== expectedLegacyDigest) throw error;
    return parsed;
  }
};

const validateArtifact = (
  label: string,
  input: unknown,
  schema: z.ZodTypeAny,
): ArtifactKind => {
  const parsed = schema.parse(input) as ArtifactKind;
  assertNoSensitiveStrings(parsed);
  const expected = computeFigmaSnapshotArtifactDigest(
    parsed as ArtifactWithDigest,
  );
  if (parsed.contentDigest !== expected) {
    throw new Error(
      `${label} contentDigest mismatch: expected ${expected}, got ${parsed.contentDigest}`,
    );
  }
  return parsed as ArtifactKind;
};

const stripContentDigest = <T extends ArtifactWithDigest>(
  artifact: T,
): Omit<T, "contentDigest"> => {
  const { contentDigest: _contentDigest, ...rest } = artifact;
  return rest;
};

const stripLegacyImportStatusRateLimitFields = (input: unknown): unknown => {
  if (input === null || typeof input !== "object") return input;
  const record = input as Record<string, unknown>;
  const rateLimit = record.rateLimit;
  if (rateLimit === null || typeof rateLimit !== "object") return input;
  const rateLimitRecord = rateLimit as Record<string, unknown>;
  const {
    figmaPlanTier: _figmaPlanTier,
    figmaRateLimitType: _figmaRateLimitType,
    figmaUpgradeLinkDigest: _figmaUpgradeLinkDigest,
    ...safeRateLimit
  } = rateLimitRecord;
  if (
    _figmaPlanTier === undefined &&
    _figmaRateLimitType === undefined &&
    _figmaUpgradeLinkDigest === undefined
  ) {
    return input;
  }
  return {
    ...record,
    rateLimit: safeRateLimit,
  };
};

const assertSnapshotSegment = (
  label: string,
  value: string,
  pattern: RegExp,
): void => {
  if (!pattern.test(value)) {
    throw new Error(`${label} must match ${pattern.source}`);
  }
  if (value === "." || value === "..") {
    throw new Error(`${label} must not be '.' or '..'`);
  }
};

const assertNoSymlinkPathSegments = async (input: {
  readonly workspaceRoot: string;
  readonly targetPath: string;
  readonly label: string;
}): Promise<void> => {
  const workspaceRoot = resolve(input.workspaceRoot);
  const targetPath = resolve(input.targetPath);
  assertLexicallyContained({
    workspaceRoot,
    targetPath,
    label: input.label,
  });
  const relativePath = relative(workspaceRoot, targetPath);
  if (relativePath.length === 0) {
    await assertPathIsNotSymlink(workspaceRoot, input.label);
    return;
  }
  let current = workspaceRoot;
  await assertPathIsNotSymlink(current, input.label);
  for (const segment of relativePath.split(/[\\/]/u)) {
    current = join(current, segment);
    if (!(await pathExists(current))) continue;
    await assertPathIsNotSymlink(current, input.label);
  }
};

const assertRealPathContained = async (input: {
  readonly workspaceRoot: string;
  readonly targetPath: string;
  readonly label: string;
}): Promise<void> => {
  const workspaceRoot = await realpath(input.workspaceRoot);
  const targetPath = await realpath(input.targetPath);
  assertLexicallyContained({
    workspaceRoot,
    targetPath,
    label: input.label,
  });
};

const assertNoSymlinkDescendants = async (input: {
  readonly workspaceRoot: string;
  readonly rootPath: string;
  readonly label: string;
}): Promise<void> => {
  await assertFigmaSnapshotVaultPathContained({
    workspaceRoot: input.workspaceRoot,
    targetPath: input.rootPath,
    label: input.label,
  });
  await assertRealPathContained({
    workspaceRoot: input.workspaceRoot,
    targetPath: input.rootPath,
    label: input.label,
  });
  const pending = [input.rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new FigmaSnapshotVaultError({
        errorCode: "unsafe_path",
        message: `${input.label} contains a symlink`,
      });
    }
    if (!stat.isDirectory()) continue;
    for (const entry of await readdir(current)) {
      pending.push(join(current, entry));
    }
  }
};

const assertLexicallyContained = (input: {
  readonly workspaceRoot: string;
  readonly targetPath: string;
  readonly label: string;
}): void => {
  if (!isAbsolute(input.workspaceRoot) || !isAbsolute(input.targetPath)) {
    throw new FigmaSnapshotVaultError({
      errorCode: "unsafe_path",
      message: `${input.label} must resolve to absolute paths`,
    });
  }
  const relativePath = relative(input.workspaceRoot, input.targetPath);
  if (
    relativePath.startsWith("..") ||
    relativePath === ".." ||
    isAbsolute(relativePath)
  ) {
    throw new FigmaSnapshotVaultError({
      errorCode: "unsafe_path",
      message: `${input.label} must remain inside the configured workspace root`,
    });
  }
};

const assertPathIsNotSymlink = async (
  path: string,
  label: string,
): Promise<void> => {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      throw new FigmaSnapshotVaultError({
        errorCode: "unsafe_path",
        message: `${label} must not traverse symlinks`,
      });
    }
  } catch (err) {
    if (isFileNotFound(err)) return;
    throw err;
  }
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if (isFileNotFound(err)) return false;
    throw err;
  }
};

const isFileNotFound = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { readonly code?: unknown }).code === "ENOENT";

const assertNoSensitiveStrings = (value: unknown, path = "$"): void => {
  if (typeof value === "string") {
    const redacted = redactHighRiskSecrets(value, "[REDACTED]");
    if (redacted !== value || FIGMA_TOKEN_LIKE_RE.test(value)) {
      throw new Error(`${path} contains token-bearing content`);
    }
    if (URL_LIKE_RE.test(value)) {
      throw new Error(`${path} contains a raw URL`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSensitiveStrings(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertNoSensitiveStrings(entry, `${path}.${key}`);
    }
  }
};

const assertSafeRelativePath = (label: string, value: string): void => {
  if (value.includes("\0")) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
  if (value.includes("\\")) {
    throw new Error(`${label} must not contain backslashes`);
  }
  if (value.startsWith("/") || /^[A-Za-z]:\//u.test(value)) {
    throw new Error(`${label} must be a relative descendant path`);
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)) {
    throw new Error(`${label} must not be a URL`);
  }
  for (const segment of value.split("/")) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new Error(`${label} must not contain '.' or '..' segments`);
    }
    if (!SNAPSHOT_SEGMENT_RE.test(segment)) {
      throw new Error(
        `${label} segment "${segment}" must match ${SNAPSHOT_SEGMENT_RE.source}`,
      );
    }
  }
};
