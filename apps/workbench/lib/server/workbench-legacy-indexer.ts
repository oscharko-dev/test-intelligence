/**
 * Conservative indexer for pre-persistence legacy artifacts (Issue #54,
 * Epic #48). At startup and on explicit reindex it discovers on-disk Snapshot
 * Vault folders and run output folders, classifies each one, idempotently
 * promotes the unambiguous snapshots into durable rows through the storage
 * adapter, and surfaces ambiguous / corrupt / unknown ones in an operator
 * summary cached on a `globalThis` singleton.
 *
 * MIGRATION-FREE: no DDL change, no new schema version, no new adapter
 * repository. Re-classification is recomputed deterministically on every call,
 * so the singleton is purely a cache for the API + UI.
 *
 * Boundaries:
 *  - Legacy folders are opened READ-ONLY (`readFile`, `readdir`, `stat`); writes
 *    are confined to the storage adapter (snapshot metadata rows) and never
 *    touch a legacy artifact byte.
 *  - The `better-sqlite3` import boundary is respected: this module talks to the
 *    adapter contract only.
 *  - Warnings are redacted (no absolute paths, home dirs, secrets, or URLs).
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

import type { FigmaSnapshotManifest } from "@oscharko-dev/ti-contracts";

import {
  getWorkbenchStorage,
  getWorkbenchStoragePaths,
} from "@/lib/server/storage/bootstrap";
import {
  classifySnapshotError,
  looksLikeRunOutput,
  redactLegacyId,
  redactLegacyWarning,
  type LegacyClassification,
} from "./workbench-legacy-indexer-classify";
import {
  discoverLegacyRunFolders,
  discoverLegacySnapshotFolders,
  type DiscoveredSnapshotFolder,
} from "./workbench-legacy-indexer-discover";
import { formatWorkbenchTenantScope } from "./workbench-tenant-scope";
import { readArtifactsAtVaultPath } from "./workbench-snapshot-vault";

export type LegacyArtifactKind = "snapshot" | "run";

export interface LegacyIndexedSnapshot {
  readonly id: string;
  readonly classification: LegacyClassification;
}

export interface LegacyIndexedRun {
  readonly id: string;
  readonly classification: "legacy-read-only";
}

export interface LegacyIndexSummary {
  readonly indexed: number;
  readonly alreadyIndexed: number;
  readonly legacyReadOnly: number;
  readonly skipped: number;
  readonly warnings: readonly string[];
  readonly snapshots: readonly LegacyIndexedSnapshot[];
  readonly runs: readonly LegacyIndexedRun[];
}

export interface LegacyIndexerOptions {
  readonly env?: NodeJS.ProcessEnv;
}

const EMPTY_SUMMARY: LegacyIndexSummary = {
  indexed: 0,
  alreadyIndexed: 0,
  legacyReadOnly: 0,
  skipped: 0,
  warnings: [],
  snapshots: [],
  runs: [],
};

interface LegacyIndexCache {
  summary: LegacyIndexSummary;
  classifications: Map<string, LegacyClassification>;
}

const globalForLegacy = globalThis as typeof globalThis & {
  __TI_WORKBENCH_LEGACY_INDEX__?: LegacyIndexCache;
};

const ensureCache = (): LegacyIndexCache => {
  if (globalForLegacy.__TI_WORKBENCH_LEGACY_INDEX__ === undefined) {
    globalForLegacy.__TI_WORKBENCH_LEGACY_INDEX__ = {
      summary: EMPTY_SUMMARY,
      classifications: new Map(),
    };
  }
  return globalForLegacy.__TI_WORKBENCH_LEGACY_INDEX__;
};

const classificationKey = (kind: LegacyArtifactKind, id: string): string =>
  `${kind}:${id}`;

/**
 * Synchronous read of the most recent summary. Safe to call before the indexer
 * has run (returns the empty summary). The UI / API never block on a re-index;
 * they read this cached value.
 */
export const getLegacyIndexSummary = (): LegacyIndexSummary =>
  ensureCache().summary;

/**
 * Synchronous lookup for a single artifact's classification. WHY a Map keyed by
 * `kind:id`: snapshot and run ids share neither a namespace nor a uniqueness
 * guarantee globally; the kind prefix prevents collisions and lets the UI ask a
 * single question per row without scanning the warning list.
 */
export const getLegacyClassification = (
  kind: LegacyArtifactKind,
  id: string,
): LegacyClassification | undefined =>
  ensureCache().classifications.get(classificationKey(kind, id));

/**
 * Clears the cached singleton. WHY `delete` rather than `= undefined`: the
 * cache field is optional and `exactOptionalPropertyTypes` forbids writing
 * `undefined` to a non-undefined-typed slot. Deleting restores the absent state
 * the getter checks for.
 */
export const resetLegacyIndexForTests = (): void => {
  delete globalForLegacy.__TI_WORKBENCH_LEGACY_INDEX__;
};

interface SnapshotIndexTally {
  indexed: number;
  alreadyIndexed: number;
  legacyReadOnly: number;
  skipped: number;
  warnings: string[];
  snapshots: LegacyIndexedSnapshot[];
}

/**
 * Returns `true` only when the insert actually ran (the row was created by THIS
 * call). WHY a transaction-scoped re-read: an outer-call `persistedSources`
 * snapshot is racy under concurrent `indexLegacyArtifacts()` invocations — both
 * passes would see the row absent and both would insert. Re-reading inside the
 * adapter's transaction (better-sqlite3 serializes writers) guarantees exactly
 * one insert per `source` even with overlapping callers.
 */
const persistLegacySnapshot = (
  options: LegacyIndexerOptions,
  manifest: FigmaSnapshotManifest,
  nodeCount: number,
  pageCount: number,
  frameCount: number,
): boolean => {
  const tenantScope = formatWorkbenchTenantScope(manifest.tenantScope);
  const source = manifest.snapshotId;
  return getWorkbenchStorage(options).transaction((tx) => {
    const existing = tx.snapshots
      .list({ tenantScope })
      .some((row) => row.source === source);
    if (existing) return false;
    tx.snapshots.create({
      tenantScope,
      source,
      nodeCount,
      pageCount,
      frameCount,
      lifecycleState: "completed",
    });
    return true;
  });
};

const recordSnapshotOutcome = (
  tally: SnapshotIndexTally,
  classifications: Map<string, LegacyClassification>,
  id: string,
  classification: LegacyClassification,
  warning?: string,
): void => {
  classifications.set(classificationKey("snapshot", id), classification);
  tally.snapshots.push({ id, classification });
  if (classification === "indexed") tally.indexed += 1;
  else if (classification === "already-indexed") tally.alreadyIndexed += 1;
  else if (classification === "legacy-read-only") tally.legacyReadOnly += 1;
  else tally.skipped += 1;
  if (warning !== undefined) tally.warnings.push(warning);
};

const skipWarning = (id: string, error: unknown): string =>
  `Legacy snapshot ${redactLegacyId(id)} skipped: ${redactLegacyWarning(
    error instanceof Error ? error.message : "unreadable",
  )}`;

const persistedSourceKey = (tenantScope: string, source: string): string =>
  `${tenantScope}\0${source}`;

const classifyAndPersistOneSnapshot = async (
  folder: DiscoveredSnapshotFolder,
  persistedSources: ReadonlySet<string>,
  options: LegacyIndexerOptions,
  tally: SnapshotIndexTally,
  classifications: Map<string, LegacyClassification>,
): Promise<void> => {
  let artifacts;
  try {
    artifacts = await readArtifactsAtVaultPath(folder.vaultPath);
  } catch (error) {
    const classification = classifySnapshotError(error);
    recordSnapshotOutcome(
      tally,
      classifications,
      folder.basename,
      classification,
      classification === "skipped"
        ? skipWarning(folder.basename, error)
        : undefined,
    );
    return;
  }
  const snapshotId = artifacts.manifest.snapshotId;
  const tenantScope = formatWorkbenchTenantScope(artifacts.manifest.tenantScope);
  if (persistedSources.has(persistedSourceKey(tenantScope, snapshotId))) {
    recordSnapshotOutcome(
      tally,
      classifications,
      snapshotId,
      "already-indexed",
    );
    return;
  }
  try {
    const { nodes } = artifacts.nodeIndex;
    const pages = new Set(nodes.map((n) => n.pageId));
    const frames = new Set(
      nodes
        .map((n) => n.frameId)
        .filter((id): id is string => id !== undefined),
    );
    const inserted = persistLegacySnapshot(
      options,
      artifacts.manifest,
      nodes.length,
      pages.size,
      frames.size,
    );
    recordSnapshotOutcome(
      tally,
      classifications,
      snapshotId,
      inserted ? "indexed" : "already-indexed",
    );
  } catch (error) {
    // Treat any adapter-side failure as a best-effort skip: a malformed
    // backfill must never crash boot or block other folders' indexing.
    recordSnapshotOutcome(
      tally,
      classifications,
      snapshotId,
      "skipped",
      skipWarning(snapshotId, error),
    );
  }
};

const indexSnapshots = async (
  options: LegacyIndexerOptions,
  classifications: Map<string, LegacyClassification>,
): Promise<SnapshotIndexTally> => {
  const env = options.env ?? process.env;
  const folders = await discoverLegacySnapshotFolders(env);
  const tally: SnapshotIndexTally = {
    indexed: 0,
    alreadyIndexed: 0,
    legacyReadOnly: 0,
    skipped: 0,
    warnings: [],
    snapshots: [],
  };
  if (folders.length === 0) return tally;
  // WHY snapshot the persisted sources once per index pass: it provides the
  // pre-check optimization without serializing each create through a fresh DB
  // read, and a concurrent double-index resolves to a single row because the
  // authoritative check happens INSIDE `persistLegacySnapshot`'s transaction.
  const persistedSources = new Set<string>(
    getWorkbenchStorage(options)
      .snapshots.list()
      .map((row) => persistedSourceKey(row.tenantScope, row.source)),
  );
  for (const folder of folders) {
    await classifyAndPersistOneSnapshot(
      folder,
      persistedSources,
      options,
      tally,
      classifications,
    );
  }
  return tally;
};

interface RunIndexTally {
  legacyReadOnly: number;
  runs: LegacyIndexedRun[];
}

const indexRuns = async (
  options: LegacyIndexerOptions,
  classifications: Map<string, LegacyClassification>,
): Promise<RunIndexTally> => {
  const env = options.env ?? process.env;
  const folders = await discoverLegacyRunFolders(env);
  const tally: RunIndexTally = { legacyReadOnly: 0, runs: [] };
  if (folders.length === 0) return tally;
  // Touch the storage paths so the singleton binds the SAME root the adapter
  // sees, mirroring the snapshot/run persistence modules. WHY touch (rather
  // than read): no path is constructed from these values; the call is purely
  // a single-root-bind guarantee.
  getWorkbenchStoragePaths(options);
  const persistedDirs = new Set<string>(
    getWorkbenchStorage(options)
      .runs.list()
      .map((row) => row.artifactDir)
      .filter((dir): dir is string => dir !== undefined)
      .map((dir) => path.resolve(dir)),
  );
  for (const folder of folders) {
    if (persistedDirs.has(path.resolve(folder.artifactDir))) continue;
    const filenames = await readdir(folder.artifactDir).catch(
      () => [] as string[],
    );
    if (!looksLikeRunOutput(filenames)) continue;
    classifications.set(
      classificationKey("run", folder.basename),
      "legacy-read-only",
    );
    tally.runs.push({
      id: folder.basename,
      classification: "legacy-read-only",
    });
    tally.legacyReadOnly += 1;
  }
  return tally;
};

/**
 * Runs the legacy-artifact index. Always returns a summary; never rethrows on
 * a per-folder failure. WHY a LOCAL classifications map per call (atomically
 * swapped onto the cache at the end): two concurrent `indexLegacyArtifacts()`
 * invocations would otherwise clobber each other's in-flight writes and a
 * reader between them could observe a half-built map. The local map plus a
 * single end-of-call cache assignment guarantees readers always see either the
 * previous pass or the new one — never a partial blend.
 */
export const indexLegacyArtifacts = async (
  options: LegacyIndexerOptions = {},
): Promise<LegacyIndexSummary> => {
  const classifications = new Map<string, LegacyClassification>();
  const snapshotTally = await indexSnapshots(options, classifications);
  const runTally = await indexRuns(options, classifications);
  const summary: LegacyIndexSummary = {
    indexed: snapshotTally.indexed,
    alreadyIndexed: snapshotTally.alreadyIndexed,
    legacyReadOnly: snapshotTally.legacyReadOnly + runTally.legacyReadOnly,
    skipped: snapshotTally.skipped,
    warnings: snapshotTally.warnings,
    snapshots: snapshotTally.snapshots,
    runs: runTally.runs,
  };
  // Single-statement publish: replace BOTH cache fields together so any reader
  // sees a consistent snapshot. The `ensureCache()` call is cheap (just defaults
  // the missing singleton, no IO).
  const cache = ensureCache();
  cache.summary = summary;
  cache.classifications = classifications;
  return summary;
};

/**
 * Cache-priming variant for the startup hook. Mirrors the `getWorkbenchStorage`
 * pattern: this getter, not the constructor, populates the `globalThis`
 * singleton, so calling it once during `register()` guarantees the API + UI see
 * a current summary on first read. Best-effort: returns the cached (possibly
 * empty) summary on any indexing failure and never rethrows.
 */
export const ensureLegacyIndexAtStartup = async (
  options: LegacyIndexerOptions = {},
): Promise<LegacyIndexSummary> => {
  try {
    return await indexLegacyArtifacts(options);
  } catch {
    return ensureCache().summary;
  }
};
