/**
 * Concrete `better-sqlite3`-backed {@link WorkbenchStorageAdapter}.
 *
 * WHY `better-sqlite3` is imported only here (plus the schema/repository sibling
 * modules under `lib/server/storage/`): the native module must never reach a
 * client bundle. The barrel `index.ts` does not re-export this module; server
 * callers and tests import it directly. An eslint `no-restricted-imports` rule
 * enforces the boundary outside `lib/server/storage/**`.
 *
 * Two construction modes reconcile the fixed contract suite with real DDL:
 *
 *  - `migrations` OMITTED → AUTO mode: the built-in schema migrations run during
 *    construction so tables exist immediately. The contract suite's repository
 *    and transaction tests call the factory with no migration override and use
 *    repositories WITHOUT calling `migrateToLatest`, so the schema must already
 *    be present.
 *  - `migrations` PROVIDED (even `[]`) → EXPLICIT mode: no auto-migration; the
 *    database starts at `user_version` 0 and applies exactly the supplied
 *    migrations when `migrateToLatest()` is called. The suite's migration tests
 *    assert `getSchemaVersion() === 0` before migrating.
 *
 * Under `exactOptionalPropertyTypes`, the option is never passed as
 * `migrations: undefined`; presence is branched on instead.
 */

import BetterSqlite3 from "better-sqlite3";

import { assertSchemaVersionSupported } from "./migrations";
import type { WorkbenchMigration } from "./migrations";
import { createAuditEventRepository } from "./sqlite-audit-repository";
import {
  createArtifactRepository,
  createExportRepository,
  createGeneratedSeedRepository,
  createRunRepository,
  createScopeBasketRepository,
  createSnapshotRepository,
  createTestCaseRepository,
} from "./sqlite-repositories";
import { writePreMigrationBackup } from "./sqlite-backup";
import { buildBuiltinSchemaMigrations } from "./sqlite-schema";
import { WorkbenchStorageError } from "./storage-adapter";
import type { WorkbenchStorageAdapter } from "./storage-adapter";
import type {
  ArtifactRepository,
  AuditEventRepository,
  ExportRepository,
  GeneratedSeedRepository,
  RunRepository,
  ScopeBasketRepository,
  SnapshotRepository,
  TestCaseRepository,
} from "./types";

export interface SqliteAdapterOptions {
  readonly databaseFile?: string;
  readonly migrations?: readonly WorkbenchMigration[];
}

/**
 * Internal construction policy. `auto` runs the built-in schema during
 * construction; `explicit` installs a fixed list and defers migration to a
 * later `migrateToLatest()` call; `builtin-deferred` selects the built-in schema
 * but defers application so the bootstrap caller can drive migration inside its
 * own error handling and still hold the handle to `close()` on failure.
 */
type SchemaInit =
  | { readonly mode: "auto" }
  | {
      readonly mode: "explicit";
      readonly migrations: readonly WorkbenchMigration[];
    }
  | { readonly mode: "builtin-deferred" };

const DEFAULT_DATABASE_FILE = ":memory:";

const readUserVersion = (db: BetterSqlite3.Database): number =>
  Number(db.pragma("user_version", { simple: true }));

/**
 * Sets `user_version`. SQLite forbids binding `user_version` as a parameter, so
 * the already-validated integer is interpolated. Callers only pass a value that
 * has passed `validateMigrationSequence` (a contiguous-from-1 integer), so there
 * is no injection surface.
 */
const writeUserVersion = (
  db: BetterSqlite3.Database,
  version: number,
): void => {
  db.pragma(`user_version = ${version}`);
};

class SqliteWorkbenchStorageAdapter implements WorkbenchStorageAdapter {
  readonly snapshots: SnapshotRepository;
  readonly runs: RunRepository;
  readonly artifacts: ArtifactRepository;
  readonly scopeBaskets: ScopeBasketRepository;
  readonly generatedSeeds: GeneratedSeedRepository;
  readonly exports: ExportRepository;
  readonly testCases: TestCaseRepository;
  readonly auditEvents: AuditEventRepository;

  private readonly db: BetterSqlite3.Database;
  private readonly databaseFile: string;
  private readonly migrations: readonly WorkbenchMigration[];
  private readonly txHandle: WorkbenchStorageAdapter;
  private inTransaction = false;

  constructor(databaseFile: string, schemaInit: SchemaInit) {
    this.databaseFile = databaseFile;
    this.db = new BetterSqlite3(databaseFile);
    // WAL improves concurrent read/write durability; it must be set before any
    // transaction. `:memory:` databases ignore WAL gracefully. FK enforcement is
    // OFF because repositories enforce same-tenant parent checks at the contract
    // layer for parity with the in-memory adapter.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = OFF");

    this.snapshots = createSnapshotRepository(this.db);
    this.runs = createRunRepository(this.db);
    this.artifacts = createArtifactRepository(this.db);
    this.scopeBaskets = createScopeBasketRepository(this.db);
    this.generatedSeeds = createGeneratedSeedRepository(this.db);
    this.exports = createExportRepository(this.db);
    this.auditEvents = createAuditEventRepository(this.db);
    this.testCases = createTestCaseRepository(this.db, this.auditEvents);

    this.txHandle = this.buildTxHandle();
    this.migrations =
      schemaInit.mode === "explicit"
        ? schemaInit.migrations
        : buildBuiltinSchemaMigrations(this.db);
    if (schemaInit.mode === "auto") this.migrateToLatest();
  }

  /**
   * The transaction handle shares this adapter's repositories (one connection ⇒
   * read-your-writes) and forbids nesting. A nested `transaction` throws OUR
   * typed `WorkbenchStorageError` before better-sqlite3 is involved.
   */
  private buildTxHandle(): WorkbenchStorageAdapter {
    return {
      snapshots: this.snapshots,
      runs: this.runs,
      artifacts: this.artifacts,
      scopeBaskets: this.scopeBaskets,
      generatedSeeds: this.generatedSeeds,
      exports: this.exports,
      testCases: this.testCases,
      auditEvents: this.auditEvents,
      migrateToLatest: () => {
        throw new WorkbenchStorageError(
          "NESTED_TRANSACTION",
          "migrateToLatest() is not available inside a transaction.",
        );
      },
      getSchemaVersion: () => this.getSchemaVersion(),
      transaction: () => {
        throw new WorkbenchStorageError(
          "NESTED_TRANSACTION",
          "Nested transactions are not supported.",
        );
      },
      close: () => {
        throw new WorkbenchStorageError(
          "NESTED_TRANSACTION",
          "close() is not available inside a transaction.",
        );
      },
    };
  }

  getSchemaVersion(): number {
    return readUserVersion(this.db);
  }

  migrateToLatest(): number {
    const current = readUserVersion(this.db);
    assertSchemaVersionSupported(current, this.migrations);
    const pending = this.migrations.filter(
      (migration) => migration.version > current,
    );
    if (pending.length === 0) return current;
    const target = pending[pending.length - 1]?.version ?? current;
    // WHY before the transaction: VACUUM INTO cannot run inside an open
    // transaction, and the snapshot must capture the PRE-migration state. A
    // backup failure throws here, so the migration never runs (fail-closed).
    this.backupBeforeMigration(current, target);
    // WHY one `user_version` write at the very end (not per step): table DDL
    // rolls back with the better-sqlite3 transaction, but a `PRAGMA
    // user_version` write does not roll back here. Writing the version only
    // after every step succeeds means a thrown step never reaches the pragma, so
    // the version stays at the start value while all DDL is rolled back —
    // leaving the schema atomically unchanged on failure, then rethrowing.
    const run = this.db.transaction((steps: readonly WorkbenchMigration[]) => {
      for (const migration of steps) {
        migration.up(this.txHandle);
      }
      writeUserVersion(this.db, target);
    });
    run(pending);
    return readUserVersion(this.db);
  }

  /**
   * Takes a pre-migration backup only when there is populated data to lose: a
   * file-backed database already at version ≥ 1. WHY version 0 is skipped: a
   * fresh first-time bootstrap has no prior data, so a backup would be an empty
   * snapshot of nothing. `:memory:` databases have no file to copy.
   */
  private backupBeforeMigration(current: number, target: number): void {
    if (this.databaseFile === DEFAULT_DATABASE_FILE || current < 1) return;
    writePreMigrationBackup({
      db: this.db,
      databaseFile: this.databaseFile,
      fromVersion: current,
      toVersion: target,
    });
  }

  transaction<T>(work: (tx: WorkbenchStorageAdapter) => T): T {
    if (this.inTransaction) {
      throw new WorkbenchStorageError(
        "NESTED_TRANSACTION",
        "Nested transactions are not supported.",
      );
    }
    this.inTransaction = true;
    try {
      // BEGIN IMMEDIATE takes the SQLite write reservation before any
      // read-then-write repository logic runs, so independent connections cannot
      // observe the same "absent" row and both persist it.
      return this.db.transaction(() => work(this.txHandle)).immediate();
    } finally {
      this.inTransaction = false;
    }
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Creates a SQLite-backed adapter. See the module docblock for AUTO vs EXPLICIT
 * migration modes. WHY the branch instead of a default value: under
 * `exactOptionalPropertyTypes`, passing `migrations: undefined` is not the same
 * as omitting it; explicit mode is entered only when the caller actually
 * supplies a `migrations` array (including `[]`).
 */
export const createSqliteWorkbenchStorageAdapter = (
  options?: SqliteAdapterOptions,
): WorkbenchStorageAdapter => {
  const databaseFile = options?.databaseFile ?? DEFAULT_DATABASE_FILE;
  if (options?.migrations !== undefined) {
    return new SqliteWorkbenchStorageAdapter(databaseFile, {
      mode: "explicit",
      migrations: options.migrations,
    });
  }
  return new SqliteWorkbenchStorageAdapter(databaseFile, { mode: "auto" });
};

/**
 * Bootstrap-only factory: opens the database and installs schema migrations but
 * DEFERS applying them, so the caller can run `migrateToLatest()` inside its own
 * try/catch and retain the handle to `close()` on failure (the auto path throws
 * inside the constructor before the caller could hold a reference).
 *
 * `schemaSteps` overrides the built-in schema and exists for deterministic
 * failure injection in tests; the steps are plain `WorkbenchMigration`s (no
 * `better-sqlite3` import needed by the caller), preserving the AC#4 boundary.
 */
export const createDeferredSqliteWorkbenchStorageAdapter = (options: {
  readonly databaseFile: string;
  readonly schemaSteps?: readonly WorkbenchMigration[];
}): WorkbenchStorageAdapter =>
  new SqliteWorkbenchStorageAdapter(
    options.databaseFile,
    options.schemaSteps !== undefined
      ? { mode: "explicit", migrations: options.schemaSteps }
      : { mode: "builtin-deferred" },
  );
