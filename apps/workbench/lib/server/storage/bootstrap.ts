/**
 * Startup bootstrap for the local Workbench SQLite database.
 *
 * Responsibilities (Issue #52):
 *  - Create the database (and artifact-store) directories when missing, creating
 *    DIRECTORIES ONLY — existing files are never touched or deleted.
 *  - Open the SQLite database (better-sqlite3 creates the file when absent) and
 *    apply the built-in schema migrations.
 *  - On migration failure: leave artifact files intact, close the handle, and
 *    throw a clear, secret-free operator error (`MIGRATION_FAILED`).
 *  - Cache the adapter in a `globalThis` singleton (mirroring
 *    `workbench-run-registry.ts`) so repeated calls reuse one connection.
 *
 * WHY this module is not re-exported from the storage barrel: it imports the
 * `better-sqlite3`-backed adapter, which must never reach a client bundle.
 * Server-only callers import it directly from `@/lib/server/storage/bootstrap`.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { resolveWorkbenchStoragePaths } from "./db-path";
import type { WorkbenchStoragePaths } from "./db-path";
import type { WorkbenchMigration } from "./migrations";
import { createDeferredSqliteWorkbenchStorageAdapter } from "./sqlite-adapter";
import { WorkbenchStorageError } from "./storage-adapter";
import type { WorkbenchStorageAdapter } from "./storage-adapter";

export interface BootstrapWorkbenchStorageOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly databaseFile?: string;
  readonly artifactRoot?: string;
  /**
   * Test-only override of the schema migrations, used to force a deterministic
   * migration failure for the artifact-preservation acceptance test. Steps are
   * plain `WorkbenchMigration`s, so test files need no `better-sqlite3` import.
   */
  readonly schemaSteps?: readonly WorkbenchMigration[];
}

interface ResolvedBootstrapPaths {
  readonly databaseFile: string;
  readonly artifactRoot: string;
}

const resolvePaths = (
  options: BootstrapWorkbenchStorageOptions,
): ResolvedBootstrapPaths => {
  const defaults = resolveWorkbenchStoragePaths(options.env ?? process.env);
  return {
    databaseFile: options.databaseFile ?? defaults.databaseFile,
    artifactRoot: options.artifactRoot ?? defaults.artifactRoot,
  };
};

/**
 * Bootstraps the local SQLite store. Creates required directories, opens the
 * database, and migrates to the latest schema. On migration failure the handle
 * is closed and a `MIGRATION_FAILED` error is thrown; no files are deleted.
 */
export const bootstrapWorkbenchStorage = (
  options: BootstrapWorkbenchStorageOptions = {},
): WorkbenchStorageAdapter => {
  const paths = resolvePaths(options);
  // Create directories only; existing database and artifact files are preserved.
  mkdirSync(path.dirname(paths.databaseFile), { recursive: true });
  mkdirSync(paths.artifactRoot, { recursive: true });

  const adapter = createDeferredSqliteWorkbenchStorageAdapter({
    databaseFile: paths.databaseFile,
    ...(options.schemaSteps !== undefined
      ? { schemaSteps: options.schemaSteps }
      : {}),
  });

  try {
    adapter.migrateToLatest();
  } catch (cause) {
    adapter.close();
    if (
      cause instanceof WorkbenchStorageError &&
      cause.code === "SCHEMA_VERSION_UNSUPPORTED"
    ) {
      throw cause;
    }
    // Operator-facing message carries no paths or secrets; the SQLite DDL
    // transaction already rolled back and artifact files were never touched.
    throw new WorkbenchStorageError(
      "MIGRATION_FAILED",
      "Failed to initialize the local Workbench database. Existing data was left unchanged.",
      { cause },
    );
  }

  return adapter;
};

const globalForStorage = globalThis as typeof globalThis & {
  __TI_WORKBENCH_STORAGE__?: WorkbenchStorageAdapter;
  __TI_WORKBENCH_STORAGE_PATHS__?: WorkbenchStoragePaths;
};

/**
 * Returns the process-wide Workbench storage adapter, bootstrapping it on first
 * use and caching it on `globalThis` (mirrors `workbench-run-registry.ts`). The
 * cached instance ignores per-call options after the first call. The resolved
 * `WorkbenchStoragePaths` the singleton was bootstrapped with are cached
 * alongside it so content-store I/O can resolve to the SAME data root (see
 * `getWorkbenchStoragePaths`).
 */
export const getWorkbenchStorage = (
  options: BootstrapWorkbenchStorageOptions = {},
): WorkbenchStorageAdapter => {
  if (globalForStorage.__TI_WORKBENCH_STORAGE__ === undefined) {
    const resolved = resolvePaths(options);
    globalForStorage.__TI_WORKBENCH_STORAGE__ =
      bootstrapWorkbenchStorage(options);
    // Cache only after a successful bootstrap so a migration failure leaves both
    // the adapter and the paths absent (the getters re-attempt on the next call).
    globalForStorage.__TI_WORKBENCH_STORAGE_PATHS__ = {
      databaseFile: resolved.databaseFile,
      artifactRoot: resolved.artifactRoot,
    };
  }
  return globalForStorage.__TI_WORKBENCH_STORAGE__;
};

/**
 * Returns the `WorkbenchStoragePaths` the singleton adapter is actually bound
 * to, bootstrapping it on first use. WHY this exists: the adapter binds its data
 * root ONCE at first bootstrap and ignores per-call `env` afterward (the #52
 * contract), so callers that drive content-store I/O must use these cached paths
 * rather than a fresh per-call `resolveWorkbenchStoragePaths(env)` — otherwise a
 * later call with a different `WORKBENCH_REPO_ROOT` would scatter artifact bytes
 * and the metadata rows that reference them across different roots. Pass the same
 * `options.env` you pass to `getWorkbenchStorage` so the FIRST call binds the
 * intended root; the return is resolved-then-cached above, so it is provably
 * defined (no non-null assertion).
 */
export const getWorkbenchStoragePaths = (
  options: BootstrapWorkbenchStorageOptions = {},
): WorkbenchStoragePaths => {
  getWorkbenchStorage(options);
  const paths = globalForStorage.__TI_WORKBENCH_STORAGE_PATHS__;
  if (paths === undefined) {
    // Unreachable: a successful getWorkbenchStorage caches the paths in the same
    // branch. Narrowed explicitly so the return type carries no `undefined`.
    throw new WorkbenchStorageError(
      "MIGRATION_FAILED",
      "Failed to initialize the local Workbench database. Existing data was left unchanged.",
    );
  }
  return paths;
};

/**
 * Closes and clears the cached adapter and its cached paths. Intended for tests
 * that bootstrap into temporary directories and need a clean singleton between
 * cases.
 */
export const resetWorkbenchStorageForTests = (): void => {
  globalForStorage.__TI_WORKBENCH_STORAGE__?.close();
  // WHY `delete` rather than assigning `undefined`: the singleton fields are
  // OPTIONAL properties, and `exactOptionalPropertyTypes` forbids writing
  // `undefined` to a non-`undefined`-typed slot. Deleting the keys restores the
  // absent state the lazy getters check for.
  delete globalForStorage.__TI_WORKBENCH_STORAGE__;
  delete globalForStorage.__TI_WORKBENCH_STORAGE_PATHS__;
};
