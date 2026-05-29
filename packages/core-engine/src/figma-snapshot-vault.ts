import { join } from "node:path";

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
  relativePath: z.string().min(1).superRefine((value, ctx) => {
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

const importChunkSchema = z.strictObject({
  chunkId: stableSegmentSchema("chunks.chunkId"),
  state: z.enum(ChunkStates),
  nodeCount: z.number().int().nonnegative(),
  contentDigest: sha256HexSchema.optional(),
});

const importCheckpointSchema = z.strictObject({
  lastSuccessfulPhase: z.enum(LifecycleStates).optional(),
  resumeFromChunkId: stableSegmentSchema("checkpoint.resumeFromChunkId").optional(),
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

type ArtifactWithDigest = { readonly contentDigest: string };

type ArtifactKind =
  | FigmaSnapshotManifest
  | FigmaSnapshotNodeIndex
  | FigmaSnapshotPreviewManifest
  | FigmaSnapshotImportStatus;

export const serializeFigmaSnapshotArtifact = (artifact: ArtifactKind): string =>
  canonicalJson(artifact);

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
): FigmaSnapshotImportStatus =>
  validateArtifact(
    "figma snapshot import status",
    input,
    importStatusSchema,
  ) as FigmaSnapshotImportStatus;

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

const assertNoSensitiveStrings = (value: unknown, path = "$"): void => {
  if (typeof value === "string") {
    const redacted = redactHighRiskSecrets(value, "[REDACTED]");
    if (redacted !== value) {
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
