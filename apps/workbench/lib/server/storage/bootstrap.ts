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
};

/**
 * Returns the process-wide Workbench storage adapter, bootstrapping it on first
 * use and caching it on `globalThis` (mirrors `workbench-run-registry.ts`). The
 * cached instance ignores per-call options after the first call.
 */
export const getWorkbenchStorage = (
  options: BootstrapWorkbenchStorageOptions = {},
): WorkbenchStorageAdapter => {
  if (globalForStorage.__TI_WORKBENCH_STORAGE__ === undefined) {
    globalForStorage.__TI_WORKBENCH_STORAGE__ =
      bootstrapWorkbenchStorage(options);
  }
  return globalForStorage.__TI_WORKBENCH_STORAGE__;
};

/**
 * Closes and clears the cached adapter. Intended for tests that bootstrap into
 * temporary directories and need a clean singleton between cases.
 */
export const resetWorkbenchStorageForTests = (): void => {
  globalForStorage.__TI_WORKBENCH_STORAGE__?.close();
  // WHY `delete` rather than assigning `undefined`: the singleton field is an
  // OPTIONAL property, and `exactOptionalPropertyTypes` forbids writing
  // `undefined` to a non-`undefined`-typed slot. Deleting the key restores the
  // absent state the lazy getter checks for.
  delete globalForStorage.__TI_WORKBENCH_STORAGE__;
};
