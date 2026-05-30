/**
 * Durable persistence bridge for Workbench runs (Issue #53, Phase 3).
 *
 * The in-memory run registry (`workbench-run-registry.ts`) stays the source of
 * truth for an executing run. This module adds a parallel, restart-durable
 * index: on create and on every state transition it writes the full `RunState`
 * as a JSON run-state document next to the run's artifacts and upserts a `runs`
 * row; on seal it offloads each produced artifact to the content store and
 * records artifact / export / generated-seed metadata; and on restart it
 * rehydrates the registry map from those documents so a run created before a
 * restart still reports its status, progress, artifact metadata, and source
 * reference.
 *
 * WHY a separate module: it keeps the persistence side-effect and rehydration
 * out of the hardened run lifecycle, so the registry's path guards, tenant
 * isolation, and diagnostic sanitization are untouched, and the registry does
 * not grow past its size ceiling.
 *
 * jobId <-> rowId reconciliation: `runs.create()` mints its own uuid `id` (the
 * "rowId"); the registry keys runs by the engine `jobId`. The schema has no
 * spare column, so the `jobId` is carried inside the run-state document (its
 * `jobId` field) and the rowId is held only on the in-memory record. On restart
 * the document's `jobId` rebuilds the map key and the matched `runs` row id
 * restores the rowId, so updates after a restart still target the right row.
 *
 * All side-effects here are best-effort and failure-isolated: a storage or
 * content-store failure is logged with an operator-safe, secret-free message
 * and swallowed so the run lifecycle and the client response are never affected.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  resolveWorkbenchStoragePaths,
  verifyArtifact,
  writeArtifact,
  type ArtifactKind,
  type ExportFormat,
  type WorkbenchRunStatus,
  type WorkbenchStoragePaths,
} from "@/lib/server/storage";
// WHY a separate import path: `getWorkbenchStorage` is intentionally NOT
// re-exported from the storage barrel because it pulls in the better-sqlite3
// adapter, which must never reach a client bundle. Server-only callers import
// it directly (mirrors `workbench-snapshot-persistence.ts`).
import { getWorkbenchStorage } from "@/lib/server/storage/bootstrap";
import type { WorkbenchStorageAdapter } from "@/lib/server/storage/storage-adapter";
import type { RunState } from "@/lib/types";

const RUN_STATE_DOCUMENT = "workbench-run-state.json";
const GENERATED_SEEDS_FILE = "generated-testcases.json";

export interface RehydratedRun {
  readonly jobId: string;
  readonly state: RunState;
  readonly tenantScope: string;
  readonly rowId: string;
}

export interface RunArtifactVerification {
  readonly name: string;
  readonly present: boolean;
  readonly checksumValid: boolean;
}

/**
 * Path/secret-free descriptor for an operator log line. WHY only the error NAME
 * (and a `code` when present): a raw filesystem or SQLite `message` can embed an
 * absolute path, so the message is never logged from this best-effort boundary.
 */
const describeStorageError = (error: unknown): string => {
  if (!(error instanceof Error)) return "unknown persistence error";
  const code =
    "code" in error && typeof error.code === "string" ? `:${error.code}` : "";
  return `${error.name}${code}`;
};

/**
 * Pins `WORKBENCH_REPO_ROOT` so the SQLite adapter, the content store, and the
 * run-state-document path all resolve to the same data root in prod and tests.
 * Other env entries are preserved so tenant-scope resolution is unchanged.
 */
export const storageEnvForRepoRoot = (
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => ({ ...env, WORKBENCH_REPO_ROOT: repoRoot });

const runStateDocumentPath = (artifactDir: string): string =>
  path.join(artifactDir, RUN_STATE_DOCUMENT);

/**
 * Writes the full run-state document to `<artifactDir>/workbench-run-state.json`,
 * creating the directory if needed. The document carries `jobId` so rehydration
 * can rebuild the registry map key.
 */
const writeRunStateDocument = (artifactDir: string, state: RunState): void => {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    runStateDocumentPath(artifactDir),
    JSON.stringify(state),
    "utf8",
  );
};

/**
 * Persists a newly created run: writes its run-state document and inserts a
 * `runs` row, returning the row id to hold on the in-memory record. Best-effort:
 * on failure it logs an operator-safe note and returns `undefined`, so the run
 * proceeds without persistence rather than failing.
 */
export const persistRunCreated = (input: {
  readonly repoRoot: string;
  readonly tenantScope: string;
  readonly status: WorkbenchRunStatus;
  readonly snapshotId?: string;
  readonly artifactDir: string;
  readonly state: RunState;
}): string | undefined => {
  try {
    writeRunStateDocument(input.artifactDir, input.state);
    const row = getWorkbenchStorage({
      env: storageEnvForRepoRoot(input.repoRoot),
    }).runs.create({
      tenantScope: input.tenantScope,
      status: input.status,
      ...(input.snapshotId !== undefined
        ? { snapshotId: input.snapshotId }
        : {}),
      artifactDir: input.artifactDir,
    });
    return row.id;
  } catch (error) {
    console.error(
      `[workbench] Run persistence skipped on create; durable index not updated: ${describeStorageError(error)}`,
    );
    return undefined;
  }
};

/**
 * Persists a run state transition: rewrites the run-state document and updates
 * the `runs` row status. Best-effort and failure-isolated.
 */
export const persistRunTransition = (input: {
  readonly rowId: string;
  readonly repoRoot: string;
  readonly status: WorkbenchRunStatus;
  readonly artifactDir: string;
  readonly state: RunState;
}): void => {
  try {
    writeRunStateDocument(input.artifactDir, input.state);
    getWorkbenchStorage({
      env: storageEnvForRepoRoot(input.repoRoot),
    }).runs.updateStatus(input.rowId, input.status);
  } catch (error) {
    console.error(
      `[workbench] Run persistence skipped on transition; durable index may be stale: ${describeStorageError(error)}`,
    );
  }
};

const ARTIFACT_KIND_BY_EXTENSION: Readonly<Record<string, ArtifactKind>> = {
  ".md": "markdown",
  ".pdf": "pdf",
  ".zip": "zip",
  ".json": "json",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
};

const artifactKindForPath = (filePath: string): ArtifactKind =>
  ARTIFACT_KIND_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "other";

const EXPORT_FORMAT_BY_KIND: Readonly<
  Partial<Record<ArtifactKind, ExportFormat>>
> = {
  markdown: "markdown",
  pdf: "pdf",
  zip: "zip",
  json: "json",
};

/**
 * WHY a defensible count when the shape is unknown: the produced seed file is
 * the engine's `GeneratedTestCaseList` JSON whose top level is the test-case
 * array; a bare array length is the case count. If the JSON is not an array
 * (shape changed or file truncated) the count is reported as 0 rather than
 * throwing, so seal persistence is never blocked by an unexpected payload.
 */
const countGeneratedSeeds = (bytes: Uint8Array): number => {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  return Array.isArray(parsed) ? parsed.length : 0;
};

const recordSeedFile = (input: {
  readonly storage: WorkbenchStorageAdapter;
  readonly paths: WorkbenchStoragePaths;
  readonly rowId: string;
  readonly tenantScope: string;
  readonly status: WorkbenchRunStatus;
  readonly bytes: Uint8Array;
}): void => {
  const content = writeArtifact(input.paths, input.bytes);
  input.storage.generatedSeeds.create({
    runId: input.rowId,
    tenantScope: input.tenantScope,
    status: input.status,
    count: countGeneratedSeeds(input.bytes),
    content,
  });
};

const recordSingleArtifact = (input: {
  readonly storage: WorkbenchStorageAdapter;
  readonly paths: WorkbenchStoragePaths;
  readonly rowId: string;
  readonly tenantScope: string;
  readonly status: WorkbenchRunStatus;
  readonly filePath: string;
  readonly name: string;
  readonly customerFacing: boolean;
}): void => {
  // WHY read each file synchronously here: seal persistence runs after the
  // registry has already resolved the produced paths, and the content store is
  // synchronous; failure of any one file is isolated by the caller's try/catch.
  const bytes = Uint8Array.from(readFileSync(input.filePath));
  const content = writeArtifact(input.paths, bytes);
  const kind = artifactKindForPath(input.filePath);
  const storage = input.storage;
  storage.artifacts.create({
    runId: input.rowId,
    tenantScope: input.tenantScope,
    name: input.name,
    kind,
    content,
    customerFacing: input.customerFacing,
  });
  const format = EXPORT_FORMAT_BY_KIND[kind];
  // Customer markdown/pdf become exports; customer .txt maps to no export
  // format and is recorded only as an artifact (kind "other").
  if (input.customerFacing && format !== undefined) {
    storage.exports.create({
      runId: input.rowId,
      tenantScope: input.tenantScope,
      format,
      status: input.status,
      content,
    });
  }
};

/**
 * Records produced-artifact, export, and generated-seed metadata for a sealed
 * run. Each produced file is offloaded to the content store and recorded; the
 * generated-seed file is recorded when present. Best-effort and failure-isolated
 * as a whole, so a storage failure never affects the sealed run or its response.
 */
export const persistSealedRunArtifacts = (input: {
  readonly rowId: string;
  readonly repoRoot: string;
  readonly tenantScope: string;
  readonly artifactDir: string;
  readonly status: WorkbenchRunStatus;
  readonly artifactPaths: readonly string[];
  readonly customerFacingPaths: ReadonlySet<string>;
}): void => {
  try {
    const env = storageEnvForRepoRoot(input.repoRoot);
    const paths = resolveWorkbenchStoragePaths(env);
    const storage = getWorkbenchStorage({ env });
    const resolvedArtifactDir = path.resolve(input.artifactDir);
    for (const filePath of input.artifactPaths) {
      const absolute = path.resolve(filePath);
      recordSingleArtifact({
        storage,
        paths,
        rowId: input.rowId,
        tenantScope: input.tenantScope,
        status: input.status,
        filePath: absolute,
        name: path
          .relative(resolvedArtifactDir, absolute)
          .split(path.sep)
          .join("/"),
        customerFacing: input.customerFacingPaths.has(absolute),
      });
    }
    const seedPath = path.join(resolvedArtifactDir, GENERATED_SEEDS_FILE);
    if (input.artifactPaths.some((p) => path.resolve(p) === seedPath)) {
      recordSeedFile({
        storage,
        paths,
        rowId: input.rowId,
        tenantScope: input.tenantScope,
        status: input.status,
        bytes: Uint8Array.from(readFileSync(seedPath)),
      });
    }
  } catch (error) {
    console.error(
      `[workbench] Sealed-run artifact persistence skipped; metadata not fully recorded: ${describeStorageError(error)}`,
    );
  }
};

const isRunState = (value: unknown): value is RunState =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { jobId?: unknown }).jobId === "string" &&
  typeof (value as { status?: unknown }).status === "string" &&
  Array.isArray((value as { artifacts?: unknown }).artifacts) &&
  typeof (value as { stages?: unknown }).stages === "object";

const readRunStateDocument = (artifactDir: string): RunState | undefined => {
  let raw: string;
  try {
    raw = readFileSync(runStateDocumentPath(artifactDir), "utf8");
  } catch {
    return undefined;
  }
  const parsed: unknown = JSON.parse(raw);
  return isRunState(parsed) ? parsed : undefined;
};

/**
 * Rebuilds run records from persistence after a restart. Reads each `runs` row,
 * loads its run-state document, and yields a record keyed by the document's
 * `jobId` with the rowId and tenant scope restored. Rows with a missing or
 * unreadable/invalid state document are skipped (nothing is reported for them).
 * Synchronous: better-sqlite3 and `readFileSync` are synchronous, so the caller
 * can rehydrate inside the synchronous store getter.
 */
export const rehydrateRunsFromPersistence = (
  env: NodeJS.ProcessEnv = process.env,
): readonly RehydratedRun[] => {
  const out: RehydratedRun[] = [];
  try {
    for (const row of getWorkbenchStorage({ env }).runs.list()) {
      if (row.artifactDir === undefined) continue;
      let state: RunState | undefined;
      try {
        state = readRunStateDocument(row.artifactDir);
      } catch {
        state = undefined;
      }
      if (state === undefined || state.jobId === null) continue;
      out.push({
        jobId: state.jobId,
        state,
        tenantScope: row.tenantScope,
        rowId: row.id,
      });
    }
  } catch (error) {
    console.error(
      `[workbench] Run rehydration unavailable; starting with no restored runs: ${describeStorageError(error)}`,
    );
  }
  return out;
};

/**
 * Verifies every persisted artifact for a run without throwing, mapping each to
 * a structured presence/checksum report. A missing or corrupt content-store
 * file is reported `present:false` / `checksumValid:false` explicitly (AC#4).
 * A storage failure yields an empty report (and a logged operator note).
 */
export const verifyRunArtifacts = (
  env: NodeJS.ProcessEnv,
  rowId: string,
): readonly RunArtifactVerification[] => {
  try {
    const paths = resolveWorkbenchStoragePaths(env);
    const records = getWorkbenchStorage({ env }).artifacts.list({
      runId: rowId,
    });
    return records.map((record) => {
      const probe = verifyArtifact(paths, record.content);
      return {
        name: record.name,
        present: probe.present,
        checksumValid: probe.checksumValid,
      };
    });
  } catch (error) {
    console.error(
      `[workbench] Run artifact verification unavailable: ${describeStorageError(error)}`,
    );
    return [];
  }
};
