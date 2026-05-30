/**
 * Durable persistence bridge for the Figma Snapshot Vault.
 *
 * The security-hardened disk vault (`workbench-snapshot-vault.ts`) stays the
 * source of truth for snapshot detail/search and node-index bytes. This module
 * adds a parallel, restart-durable index: on import completion the validated
 * node-index is offloaded to the content store and a `SnapshotMetadataRecord`
 * is written to SQLite, and on catalog read the SQLite records are reconciled
 * against the disk rows so a snapshot imported before a restart is still listed
 * and its persisted payload integrity is reported.
 *
 * WHY a separate module: it keeps the persistence side-effect and reconciliation
 * out of the hardened disk read path, so tenant isolation, path-traversal
 * guards, and diagnostic sanitization in the vault are untouched.
 *
 * Engine-snapshotId reconciliation: `snapshots.create()` mints its own uuid
 * `id`, but the app keys snapshots by the engine `snapshotId` (disk paths + the
 * `[snapshotId]` route param). The schema has no spare id column and must not
 * change, so the engine `snapshotId` is carried in the record's `source` field:
 * it is `NOT NULL` (no read-back nullability ambiguity), has no other consumer,
 * round-trips byte-for-byte, and is unique per import — so list/detail reconcile
 * by `record.source === snapshotId` with no collisions and full restart survival.
 */

import {
  verifyArtifact,
  writeArtifact,
  type ContentRef,
  type SnapshotMetadataRecord,
  type WorkbenchStoragePaths,
} from "@/lib/server/storage";
// WHY a separate import path: `getWorkbenchStorage`/`getWorkbenchStoragePaths`
// are intentionally NOT re-exported from the storage barrel because they pull in
// the better-sqlite3 adapter, which must never reach a client bundle. Server-only
// callers import them directly (mirrors `instrumentation.ts`).
import {
  getWorkbenchStorage,
  getWorkbenchStoragePaths,
} from "@/lib/server/storage/bootstrap";
import type {
  FigmaSnapshotImportStatus,
  FigmaSnapshotManifest,
  FigmaSnapshotNodeIndex,
} from "@oscharko-dev/ti-contracts";
import type {
  WorkbenchSnapshotCatalogRow,
  WorkbenchSnapshotPersistedIndexSummary,
} from "@/lib/snapshot-vault";
import { formatWorkbenchTenantScope } from "./workbench-tenant-scope";

interface SnapshotCountSummary {
  readonly nodeCount: number;
  readonly pageCount: number;
  readonly frameCount: number;
}

/**
 * Path/secret-free descriptor for an operator log line. WHY only the error
 * NAME (and a `code` when present, e.g. ArtifactStoreError/WorkbenchStorage
 * error codes): a raw filesystem or SQLite `message` can embed an absolute
 * path, so the message is never logged from this best-effort boundary.
 */
const describeStorageError = (error: unknown): string => {
  if (!(error instanceof Error)) return "unknown persistence error";
  const code =
    "code" in error && typeof error.code === "string" ? `:${error.code}` : "";
  return `${error.name}${code}`;
};

const summarizeSnapshotCounts = (
  nodeIndex: FigmaSnapshotNodeIndex,
): SnapshotCountSummary => {
  const pages = new Set<string>();
  const frames = new Set<string>();
  for (const node of nodeIndex.nodes) {
    pages.add(node.pageId);
    if (node.frameId !== undefined) frames.add(node.frameId);
  }
  return {
    nodeCount: nodeIndex.nodes.length,
    pageCount: pages.size,
    frameCount: frames.size,
  };
};

/**
 * Best-effort persistence of a completed import into the durable index. Wraps
 * only this side-effect: a storage/content-store failure is logged with an
 * operator-safe, secret-free message and swallowed so the import success path
 * and the job's client output are never affected. (Error handling at this
 * filesystem/SQLite boundary is appropriate.)
 */
export const persistImportedSnapshot = (input: {
  readonly manifest: FigmaSnapshotManifest;
  readonly nodeIndex: FigmaSnapshotNodeIndex;
  readonly importStatus: FigmaSnapshotImportStatus;
  readonly env: NodeJS.ProcessEnv;
}): void => {
  try {
    // WHY the singleton's cached paths (not a per-call resolve): the adapter
    // binds its data root once at first bootstrap and ignores per-call env after
    // (the #52 contract). Using its cached paths guarantees these artifact bytes
    // and the metadata row written below land under the SAME root. Passing
    // `input.env` binds the intended root on the first bootstrap.
    const paths = getWorkbenchStoragePaths({ env: input.env });
    const payload = writeArtifact(
      paths,
      Buffer.from(JSON.stringify(input.nodeIndex), "utf8"),
    );
    const counts = summarizeSnapshotCounts(input.nodeIndex);
    getWorkbenchStorage({ env: input.env }).snapshots.create({
      tenantScope: formatWorkbenchTenantScope(input.manifest.tenantScope),
      // WHY `source` carries the engine snapshotId: see module docblock.
      source: input.manifest.snapshotId,
      nodeCount: counts.nodeCount,
      pageCount: counts.pageCount,
      frameCount: counts.frameCount,
      lifecycleState: input.importStatus.lifecycleState,
      payload,
    });
  } catch (error) {
    console.error(
      `[workbench] Snapshot persistence skipped for an import; durable index not updated: ${describeStorageError(error)}`,
    );
  }
};

/**
 * Verifies the persisted node-index payload for one durable record without
 * throwing, mapping the result to the operator-facing summary the catalog
 * carries. A record with no payload reference is reported `absent`.
 */
const verifyPersistedRecord = (
  paths: WorkbenchStoragePaths,
  payload: ContentRef | undefined,
): WorkbenchSnapshotPersistedIndexSummary => {
  if (payload === undefined) return { status: "absent" };
  const probe = verifyArtifact(paths, payload);
  return {
    status: probe.checksumValid ? "verified" : "unverified",
    ...(probe.actualByteSize !== undefined
      ? { byteSize: probe.actualByteSize }
      : {}),
  };
};

export interface PersistedSnapshotIndex {
  /** Persisted record keyed by engine snapshotId (its `source` field). */
  readonly bySnapshotId: ReadonlyMap<string, SnapshotMetadataRecord>;
  readonly paths: WorkbenchStoragePaths;
}

/**
 * Reads the durable SQLite snapshot records for the active tenant scope and
 * indexes them by engine snapshotId. WHY the explicit `tenantScope` filter:
 * `snapshots.list()` is unscoped and the disk catalog is strictly
 * tenant-isolated, so without this filter persisted-only rows from another
 * tenant would leak into this tenant's catalog. Best-effort: a storage failure
 * yields an empty index (and a logged operator note) so the disk catalog still
 * renders.
 */
export const readPersistedSnapshotIndex = (
  env: NodeJS.ProcessEnv,
  tenantScope: string,
): PersistedSnapshotIndex => {
  // WHY the singleton's cached paths: payload refs are verified (below, via
  // `index.paths`) against the content store, so they MUST resolve to the same
  // root the adapter bound at first bootstrap — not a divergent per-call resolve.
  const paths = getWorkbenchStoragePaths({ env });
  const bySnapshotId = new Map<string, SnapshotMetadataRecord>();
  try {
    const records = getWorkbenchStorage({ env }).snapshots.list({
      tenantScope,
    });
    for (const record of records) bySnapshotId.set(record.source, record);
  } catch (error) {
    console.error(
      `[workbench] Durable snapshot index unavailable; using disk catalog only: ${describeStorageError(error)}`,
    );
  }
  return { bySnapshotId, paths };
};

/**
 * Resolves the persisted-index summary for a disk catalog row by joining on the
 * engine snapshotId. Reports `absent` when no durable record exists yet.
 */
export const resolvePersistedSummaryForSnapshot = (
  index: PersistedSnapshotIndex,
  snapshotId: string,
): WorkbenchSnapshotPersistedIndexSummary =>
  verifyPersistedRecord(
    index.paths,
    index.bySnapshotId.get(snapshotId)?.payload,
  );

/**
 * Synthesizes a catalog row for a durable record that has no disk row (the disk
 * artifacts were evicted but the SQLite index survived a restart). The disk
 * vault stays authoritative when present; this only surfaces persisted-only
 * snapshots so AC#1 holds through the persistence layer. Detail/search remain
 * disk-backed, so a synthesized row is intentionally minimal.
 */
export const synthesizePersistedCatalogRow = (
  index: PersistedSnapshotIndex,
  record: SnapshotMetadataRecord,
): WorkbenchSnapshotCatalogRow => ({
  snapshotId: record.source,
  tenantScope: record.tenantScope,
  importedAt: record.createdAt,
  importStrategy: "persisted",
  lifecycleState: record.lifecycleState,
  previewStatus: "not_requested",
  boundedPreview: false,
  nodeCount: record.nodeCount,
  pageCount: record.pageCount,
  frameCount: record.frameCount,
  componentCount: 0,
  hiddenCount: 0,
  launchable: false,
  cacheState: record.lifecycleState === "completed" ? "complete" : "partial",
  rateLimit: {},
  persistedNodeIndex: verifyPersistedRecord(index.paths, record.payload),
});
