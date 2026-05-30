/**
 * Durable persistence bridge for Workbench runs (Issue #53, Phase 3).
 *
 * The in-memory run registry (`workbench-run-registry.ts`) stays the source of
 * truth for an executing run. This module adds a parallel, restart-durable
 * index: on create and on every state transition it writes the full `RunState`
 * to a server-controlled run-state document (keyed by the durable `runs` row id)
 * and upserts a `runs` row; on seal it offloads each produced artifact to the
 * content store and
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
  verifyArtifact,
  writeArtifact,
  type ArtifactKind,
  type ExportFormat,
  type WorkbenchRunStatus,
  type WorkbenchStorageAdapter,
  type WorkbenchStoragePaths,
} from "@/lib/server/storage";
// WHY a separate import path: `getWorkbenchStorage`/`getWorkbenchStoragePaths`
// are intentionally NOT re-exported from the storage barrel because they pull in
// the better-sqlite3 adapter, which must never reach a client bundle. Server-only
// callers import them directly (mirrors `workbench-snapshot-persistence.ts`).
import {
  getWorkbenchStorage,
  getWorkbenchStoragePaths,
} from "@/lib/server/storage/bootstrap";
import type { RunState } from "@/lib/types";

const RUN_STATE_DIRECTORY = "run-state";
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

/**
 * Server-controlled run-state-document directory
 * (`<repoRoot>/.test-intelligence/run-state`). WHY the singleton's cached
 * `databaseFile` (via `getWorkbenchStoragePaths`, which reads
 * `process.env`/`WORKBENCH_REPO_ROOT`, never the run request body): documents
 * written here carry NO user-tainted path component, so the writes cannot be a
 * path-injection sink; and keying off the adapter's bound DB path keeps the
 * rehydration metadata beside the SAME SQLite DB the `runs` rows live in (not the
 * operator's output dir, so it is not exposed by the artifact `/files` route).
 */
const runStateRoot = (env: NodeJS.ProcessEnv): string =>
  path.join(
    path.dirname(getWorkbenchStoragePaths({ env }).databaseFile),
    RUN_STATE_DIRECTORY,
  );

// Keyed by the SQLite `runs` row id (`rowId`, an adapter-minted `randomUUID()` —
// server-controlled), so the full path takes no value from the run config.
const runStateDocumentPath = (env: NodeJS.ProcessEnv, rowId: string): string =>
  path.join(runStateRoot(env), `${rowId}.json`);

// Writes the full run-state document to `<runStateRoot>/<rowId>.json` (creating
// the dir); the document carries `jobId` so rehydration rebuilds the map key.
const writeRunStateDocument = (
  env: NodeJS.ProcessEnv,
  rowId: string,
  state: RunState,
): void => {
  mkdirSync(runStateRoot(env), { recursive: true });
  writeFileSync(
    runStateDocumentPath(env, rowId),
    JSON.stringify(state),
    "utf8",
  );
};

/**
 * Persists a newly created run: inserts the `runs` row FIRST to obtain the
 * server-minted `rowId`, then writes the run-state document keyed by it. Returns
 * the row id to hold on the in-memory record. Best-effort: a failure before the
 * row exists returns `undefined` so the run proceeds without persistence; a
 * doc-write failure after the row exists is tolerated (rehydration skips rows
 * whose document is missing) and the row id is still returned so later
 * transitions can rewrite the document.
 */
export const persistRunCreated = (input: {
  readonly repoRoot: string;
  readonly tenantScope: string;
  readonly status: WorkbenchRunStatus;
  readonly snapshotId?: string;
  readonly artifactDir: string;
  readonly state: RunState;
}): string | undefined => {
  const env = storageEnvForRepoRoot(input.repoRoot);
  let rowId: string;
  try {
    rowId = getWorkbenchStorage({ env }).runs.create({
      tenantScope: input.tenantScope,
      status: input.status,
      ...(input.snapshotId !== undefined
        ? { snapshotId: input.snapshotId }
        : {}),
      artifactDir: input.artifactDir,
    }).id;
  } catch (error) {
    console.error(
      `[workbench] Run persistence skipped on create; durable index not updated: ${describeStorageError(error)}`,
    );
    return undefined;
  }
  try {
    writeRunStateDocument(env, rowId, input.state);
  } catch (error) {
    console.error(
      `[workbench] Run-state document not written on create; rehydration will skip this run: ${describeStorageError(error)}`,
    );
  }
  return rowId;
};

/**
 * Persists a run state transition: rewrites the run-state document (keyed by the
 * server-minted `rowId`, under the server-controlled run-state root) and updates
 * the `runs` row status. Best-effort and failure-isolated.
 */
export const persistRunTransition = (input: {
  readonly rowId: string;
  readonly repoRoot: string;
  readonly tenantScope: string;
  readonly status: WorkbenchRunStatus;
  readonly state: RunState;
}): void => {
  try {
    const env = storageEnvForRepoRoot(input.repoRoot);
    writeRunStateDocument(env, input.rowId, input.state);
    getWorkbenchStorage({ env }).runs.updateStatus(
      input.rowId,
      input.tenantScope,
      input.status,
    );
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
    // WHY the singleton's cached paths: each artifact's bytes are written to the
    // content store under these paths while its metadata row is written through
    // the adapter below; both MUST share the adapter's bound root, not a
    // divergent per-call resolve (the #52 single-bind contract).
    const paths = getWorkbenchStoragePaths({ env });
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
    // WHY read the seed from a validated `artifactPaths` element, not a path
    // reconstructed from `artifactDir`: `artifactPaths` is the registry's
    // already-resolved produced-file list (same safe source as
    // `recordSingleArtifact` above), so the read carries no user-tainted path
    // component. The `path.join` below is only a comparison string, not an fs sink.
    const seedTarget = path.join(resolvedArtifactDir, GENERATED_SEEDS_FILE);
    const seedEntry = input.artifactPaths.find(
      (p) => path.resolve(p) === seedTarget,
    );
    if (seedEntry !== undefined) {
      recordSeedFile({
        storage,
        paths,
        rowId: input.rowId,
        tenantScope: input.tenantScope,
        status: input.status,
        bytes: Uint8Array.from(readFileSync(seedEntry)),
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

// Reads `<runStateRoot>/<rowId>.json` (server-controlled path); a
// missing/unreadable/invalid document yields `undefined`.
const readRunStateDocument = (
  env: NodeJS.ProcessEnv,
  rowId: string,
): RunState | undefined => {
  let raw: string;
  try {
    raw = readFileSync(runStateDocumentPath(env, rowId), "utf8");
  } catch {
    return undefined;
  }
  const parsed: unknown = JSON.parse(raw);
  return isRunState(parsed) ? parsed : undefined;
};

/**
 * Rebuilds run records from persistence after a restart. For each `runs` row it
 * loads `<runStateRoot>/<row.id>.json` (keyed by the server-controlled row id)
 * and yields a record keyed by the document's `jobId`, with the rowId and tenant
 * scope restored. Rows whose document is missing/unreadable/invalid are skipped.
 * Synchronous (better-sqlite3 + `readFileSync`), so the caller can rehydrate
 * inside the synchronous store getter.
 */
export const rehydrateRunsFromPersistence = (
  env: NodeJS.ProcessEnv = process.env,
): readonly RehydratedRun[] => {
  const out: RehydratedRun[] = [];
  try {
    for (const row of getWorkbenchStorage({ env }).runs.list()) {
      let state: RunState | undefined;
      try {
        state = readRunStateDocument(env, row.id);
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
  tenantScope: string,
): readonly RunArtifactVerification[] => {
  try {
    // WHY the singleton's cached paths: artifact refs are verified against the
    // content store, so they MUST resolve to the same root the adapter (which
    // produced these `artifacts` rows) bound at first bootstrap.
    const paths = getWorkbenchStoragePaths({ env });
    const records = getWorkbenchStorage({ env }).artifacts.list({
      runId: rowId,
      tenantScope,
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
