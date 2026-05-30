/**
 * Raw SQLite DDL for the Workbench storage schema, plus the closure factory that
 * turns it into the built-in migration list applied over a live better-sqlite3
 * connection.
 *
 * WHY this module exists separately from `migrations.ts`: the fixed migration
 * contract (`WorkbenchMigration.up(tx)`) only hands migrations a typed
 * repository handle, which cannot run DDL. Schema creation therefore bypasses
 * `tx` and executes raw SQL via `db.exec`. Keeping the SQL here leaves
 * `migrations.ts` SQL-free and free of any `better-sqlite3` import, as the ADR
 * requires.
 *
 * Column conventions mirror the DTOs in `types.ts`: TEXT for ids, timestamps,
 * and strings; INTEGER for counts, byte sizes, and booleans (0/1). Optional DTO
 * fields are nullable columns; a NULL maps back to an ABSENT key in the adapter.
 *
 * WHY no enforced FOREIGN KEY constraints: run-child referential integrity is
 * enforced in the repository layer so it stays identical to the in-memory
 * reference double and can include same-tenant checks. Schema version tracking
 * uses `PRAGMA user_version` (per the ADR); there is no separate version table.
 */

import type BetterSqlite3Database from "better-sqlite3";

import type { WorkbenchMigration } from "./migrations";

/**
 * DDL for schema version 1. Statements use `IF NOT EXISTS` defensively, but
 * migrations only run when `user_version` is below the target, so they never
 * re-execute against an already-migrated database.
 *
 * `render_metadata` and `audit_events` are forward-looking schema-readiness
 * tables (no repository in this issue): id, tenant scope, created-at, and a JSON
 * `payload` column, matching the issue scope.
 */
const SCHEMA_V1_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    tenant_scope TEXT NOT NULL,
    created_at TEXT NOT NULL,
    label TEXT,
    source TEXT NOT NULL,
    node_count INTEGER NOT NULL,
    page_count INTEGER NOT NULL,
    frame_count INTEGER NOT NULL,
    lifecycle_state TEXT NOT NULL,
    payload_sha256 TEXT,
    payload_byte_size INTEGER,
    payload_storage_ref TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    tenant_scope TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL,
    snapshot_id TEXT,
    label TEXT,
    artifact_dir TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    tenant_scope TEXT NOT NULL,
    created_at TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    content_byte_size INTEGER NOT NULL,
    content_storage_ref TEXT NOT NULL,
    customer_facing INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS scope_baskets (
    id TEXT PRIMARY KEY,
    tenant_scope TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    label TEXT NOT NULL,
    snapshot_id TEXT,
    selection TEXT NOT NULL,
    item_count INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS generated_seeds (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    tenant_scope TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    count INTEGER NOT NULL,
    content_sha256 TEXT NOT NULL,
    content_byte_size INTEGER NOT NULL,
    content_storage_ref TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    tenant_scope TEXT NOT NULL,
    created_at TEXT NOT NULL,
    format TEXT NOT NULL,
    status TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    content_byte_size INTEGER NOT NULL,
    content_storage_ref TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS render_metadata (
    id TEXT PRIMARY KEY,
    tenant_scope TEXT,
    created_at TEXT,
    payload TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    tenant_scope TEXT,
    created_at TEXT,
    payload TEXT
  )`,
];

const SCHEMA_V2_INDEX_STATEMENTS: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS idx_workbench_snapshots_tenant
     ON snapshots (tenant_scope)`,
  `CREATE INDEX IF NOT EXISTS idx_workbench_runs_tenant
     ON runs (tenant_scope)`,
  `CREATE INDEX IF NOT EXISTS idx_workbench_artifacts_run_tenant
     ON artifacts (run_id, tenant_scope)`,
  `CREATE INDEX IF NOT EXISTS idx_workbench_scope_baskets_tenant_snapshot
     ON scope_baskets (tenant_scope, snapshot_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workbench_scope_baskets_snapshot
     ON scope_baskets (snapshot_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workbench_generated_seeds_run_tenant
     ON generated_seeds (run_id, tenant_scope)`,
  `CREATE INDEX IF NOT EXISTS idx_workbench_exports_run_tenant
     ON exports (run_id, tenant_scope)`,
];

/**
 * Names of every table the built-in schema creates. Used by tests to assert the
 * full set exists and by future readiness checks.
 */
export const WORKBENCH_SCHEMA_TABLES: readonly string[] = [
  "snapshots",
  "runs",
  "artifacts",
  "scope_baskets",
  "generated_seeds",
  "exports",
  "render_metadata",
  "audit_events",
];

export const WORKBENCH_SCHEMA_VERSION = 2;

export const WORKBENCH_SCHEMA_INDEXES: readonly string[] = [
  "idx_workbench_snapshots_tenant",
  "idx_workbench_runs_tenant",
  "idx_workbench_artifacts_run_tenant",
  "idx_workbench_scope_baskets_tenant_snapshot",
  "idx_workbench_scope_baskets_snapshot",
  "idx_workbench_generated_seeds_run_tenant",
  "idx_workbench_exports_run_tenant",
];

/**
 * Builds the built-in schema migrations bound to a live connection. Schema
 * migrations run DDL via `db.exec`, bypassing the typed `tx` handle. `up`
 * ignores its `tx` argument by design (DDL is not expressible through
 * repositories); the closure over `db` performs the work.
 */
export const buildBuiltinSchemaMigrations = (
  db: BetterSqlite3Database.Database,
): readonly WorkbenchMigration[] => [
  {
    version: 1,
    description: "Create Workbench metadata and readiness tables.",
    up(): void {
      for (const statement of SCHEMA_V1_STATEMENTS) {
        db.exec(statement);
      }
    },
  },
  {
    version: 2,
    description: "Add Workbench metadata lookup indexes.",
    up(): void {
      for (const statement of SCHEMA_V2_INDEX_STATEMENTS) {
        db.exec(statement);
      }
    },
  },
];
