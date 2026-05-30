/**
 * Repository implementations for the SQLite-backed Workbench storage adapter.
 *
 * Each repository is a thin function over prepared statements on a shared
 * `better-sqlite3` connection. To match the in-memory reference double exactly:
 * ids come from `randomUUID()` and timestamps from `new Date().toISOString()` in
 * JS (not SQL), every read constructs a fresh object (so returned records are
 * inherently immutable), `list` orders by `rowid` (insertion order, mirroring
 * `Map` iteration), and SQL NULL maps to an ABSENT optional key — never
 * `undefined` — so `toStrictEqual` holds under `exactOptionalPropertyTypes`.
 *
 * `customer_facing` round-trips INTEGER 0/1 ↔ boolean. better-sqlite3 rows are
 * typed with explicit `*Row` interfaces and narrowed from `unknown`; no `any`.
 */

import { randomUUID } from "node:crypto";

import type BetterSqlite3Database from "better-sqlite3";

import {
  assertCanonicalContentRef,
  assertSameTenantRun,
} from "./contract-validation";
import type {
  ArtifactMetadataRecord,
  ArtifactRepository,
  ContentRef,
  CreateArtifactInput,
  CreateExportInput,
  CreateGeneratedSeedInput,
  CreateRunInput,
  CreateScopeBasketInput,
  CreateSnapshotInput,
  ExportMetadataRecord,
  ExportRepository,
  GeneratedSeedMetadataRecord,
  GeneratedSeedRepository,
  RunMetadataRecord,
  RunRepository,
  RunTenantFilter,
  ScopeBasketChanges,
  ScopeBasketFilter,
  ScopeBasketRecord,
  ScopeBasketRepository,
  ScopeSelection,
  SnapshotMetadataRecord,
  SnapshotRepository,
  TenantScopeFilter,
  WorkbenchRunStatus,
} from "./types";

type Db = BetterSqlite3Database.Database;

type Stmt = BetterSqlite3Database.Statement<unknown[], unknown>;

/**
 * Named-parameter bind object for a prepared statement. WHY the explicit type:
 * `@types/better-sqlite3`'s variadic `run(...params)` resolves an all-non-null
 * object literal to `Record<string, null>`, which `exactOptionalPropertyTypes`
 * rejects. Annotating the bind object to the SQLite column value union keeps the
 * call type-safe without `any`.
 */
type BindRow = Record<string, string | number | null>;

/**
 * WHY prepare is lazy in every factory: the adapter constructs repositories
 * BEFORE migrations create the tables (in auto mode, migration runs later in
 * the same constructor; in explicit/builtin-deferred modes the caller drives
 * it). `db.prepare()` compiles against the live schema, so eager preparation
 * would throw `no such table`. Statements are memoized on first method call so
 * each is still compiled exactly once per repository instance.
 */

const nowIso = (): string => new Date().toISOString();

const toBool = (value: number): boolean => value !== 0;

const fromBool = (value: boolean): number => (value ? 1 : 0);

const contentRefFrom = (
  sha256: string,
  byteSize: number,
  storageRef: string,
): ContentRef => ({ sha256, byteSize, storageRef });

interface SnapshotRow {
  readonly id: string;
  readonly tenant_scope: string;
  readonly created_at: string;
  readonly label: string | null;
  readonly source: string;
  readonly node_count: number;
  readonly page_count: number;
  readonly frame_count: number;
  readonly lifecycle_state: string;
  readonly payload_sha256: string | null;
  readonly payload_byte_size: number | null;
  readonly payload_storage_ref: string | null;
}

const mapSnapshot = (row: SnapshotRow): SnapshotMetadataRecord => ({
  id: row.id,
  tenantScope: row.tenant_scope,
  createdAt: row.created_at,
  ...(row.label !== null ? { label: row.label } : {}),
  source: row.source,
  nodeCount: row.node_count,
  pageCount: row.page_count,
  frameCount: row.frame_count,
  lifecycleState: row.lifecycle_state,
  ...(row.payload_sha256 !== null &&
  row.payload_byte_size !== null &&
  row.payload_storage_ref !== null
    ? {
        payload: contentRefFrom(
          row.payload_sha256,
          row.payload_byte_size,
          row.payload_storage_ref,
        ),
      }
    : {}),
});

interface SnapshotStmts {
  insert: Stmt;
  selectById: Stmt;
  selectByIdAndTenant: Stmt;
  selectAll: Stmt;
  updateLifecycle: Stmt;
}

export const createSnapshotRepository = (db: Db): SnapshotRepository => {
  let stmts: SnapshotStmts | undefined;
  const s = (): SnapshotStmts =>
    (stmts ??= {
      insert: db.prepare(
        `INSERT INTO snapshots (id, tenant_scope, created_at, label, source,
           node_count, page_count, frame_count, lifecycle_state,
           payload_sha256, payload_byte_size, payload_storage_ref)
         VALUES (@id, @tenantScope, @createdAt, @label, @source,
           @nodeCount, @pageCount, @frameCount, @lifecycleState,
           @payloadSha256, @payloadByteSize, @payloadStorageRef)`,
      ),
      selectById: db.prepare(`SELECT * FROM snapshots WHERE id = ?`),
      selectByIdAndTenant: db.prepare(
        `SELECT * FROM snapshots WHERE id = ? AND tenant_scope = ?`,
      ),
      selectAll: db.prepare(
        `SELECT * FROM snapshots
           WHERE (@tenantScope IS NULL OR tenant_scope = @tenantScope)
           ORDER BY rowid`,
      ),
      updateLifecycle: db.prepare(
        `UPDATE snapshots
           SET lifecycle_state = ?
           WHERE id = ? AND tenant_scope = ?`,
      ),
    });
  return {
    create(input: CreateSnapshotInput): SnapshotMetadataRecord {
      if (input.payload !== undefined) {
        assertCanonicalContentRef(input.payload, "snapshot payload");
      }
      const id = randomUUID();
      const params: BindRow = {
        id,
        tenantScope: input.tenantScope,
        createdAt: nowIso(),
        label: input.label ?? null,
        source: input.source,
        nodeCount: input.nodeCount,
        pageCount: input.pageCount,
        frameCount: input.frameCount,
        lifecycleState: input.lifecycleState,
        payloadSha256: input.payload?.sha256 ?? null,
        payloadByteSize: input.payload?.byteSize ?? null,
        payloadStorageRef: input.payload?.storageRef ?? null,
      };
      const handles = s();
      handles.insert.run(params);
      return mapSnapshot(handles.selectById.get(id) as SnapshotRow);
    },
    get(id: string, tenantScope: string): SnapshotMetadataRecord | undefined {
      const row = s().selectByIdAndTenant.get(id, tenantScope) as
        | SnapshotRow
        | undefined;
      return row ? mapSnapshot(row) : undefined;
    },
    list(filter?: TenantScopeFilter): readonly SnapshotMetadataRecord[] {
      const params: BindRow = { tenantScope: filter?.tenantScope ?? null };
      const rows = s().selectAll.all(params) as SnapshotRow[];
      return rows.map(mapSnapshot);
    },
    updateLifecycleState(
      id: string,
      tenantScope: string,
      lifecycleState: string,
    ): SnapshotMetadataRecord | undefined {
      const handles = s();
      const result = handles.updateLifecycle.run(lifecycleState, id, tenantScope);
      if (result.changes === 0) return undefined;
      return mapSnapshot(
        handles.selectByIdAndTenant.get(id, tenantScope) as SnapshotRow,
      );
    },
  };
};

interface RunRow {
  readonly id: string;
  readonly tenant_scope: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly status: string;
  readonly snapshot_id: string | null;
  readonly label: string | null;
  readonly artifact_dir: string | null;
}

const mapRun = (row: RunRow): RunMetadataRecord => ({
  id: row.id,
  tenantScope: row.tenant_scope,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  status: row.status as WorkbenchRunStatus,
  ...(row.snapshot_id !== null ? { snapshotId: row.snapshot_id } : {}),
  ...(row.label !== null ? { label: row.label } : {}),
  ...(row.artifact_dir !== null ? { artifactDir: row.artifact_dir } : {}),
});

interface RunStmts {
  readonly insert: Stmt;
  readonly selectById: Stmt;
  readonly selectByIdAndTenant: Stmt;
  readonly selectAll: Stmt;
  readonly updateStatus: Stmt;
}

export const createRunRepository = (db: Db): RunRepository => {
  let stmts: RunStmts | undefined;
  const s = (): RunStmts =>
    (stmts ??= {
      insert: db.prepare(
        `INSERT INTO runs (id, tenant_scope, created_at, updated_at, status,
           snapshot_id, label, artifact_dir)
         VALUES (@id, @tenantScope, @createdAt, @updatedAt, @status,
           @snapshotId, @label, @artifactDir)`,
      ),
      selectById: db.prepare(`SELECT * FROM runs WHERE id = ?`),
      selectByIdAndTenant: db.prepare(
        `SELECT * FROM runs WHERE id = ? AND tenant_scope = ?`,
      ),
      selectAll: db.prepare(
        `SELECT * FROM runs
           WHERE (@tenantScope IS NULL OR tenant_scope = @tenantScope)
           ORDER BY rowid`,
      ),
      updateStatus: db.prepare(
        `UPDATE runs
           SET status = ?, updated_at = ?
           WHERE id = ? AND tenant_scope = ?`,
      ),
    });
  return {
    create(input: CreateRunInput): RunMetadataRecord {
      const handles = s();
      const id = randomUUID();
      const timestamp = nowIso();
      const params: BindRow = {
        id,
        tenantScope: input.tenantScope,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: input.status,
        snapshotId: input.snapshotId ?? null,
        label: input.label ?? null,
        artifactDir: input.artifactDir ?? null,
      };
      handles.insert.run(params);
      return mapRun(handles.selectById.get(id) as RunRow);
    },
    get(id: string, tenantScope: string): RunMetadataRecord | undefined {
      const row = s().selectByIdAndTenant.get(id, tenantScope) as
        | RunRow
        | undefined;
      return row ? mapRun(row) : undefined;
    },
    list(filter?: TenantScopeFilter): readonly RunMetadataRecord[] {
      const params: BindRow = { tenantScope: filter?.tenantScope ?? null };
      const rows = s().selectAll.all(params) as RunRow[];
      return rows.map(mapRun);
    },
    updateStatus(
      id: string,
      tenantScope: string,
      status: WorkbenchRunStatus,
    ): RunMetadataRecord | undefined {
      const handles = s();
      const result = handles.updateStatus.run(status, nowIso(), id, tenantScope);
      if (result.changes === 0) return undefined;
      return mapRun(handles.selectByIdAndTenant.get(id, tenantScope) as RunRow);
    },
  };
};

interface ArtifactRow {
  readonly id: string;
  readonly run_id: string;
  readonly tenant_scope: string;
  readonly created_at: string;
  readonly name: string;
  readonly kind: string;
  readonly content_sha256: string;
  readonly content_byte_size: number;
  readonly content_storage_ref: string;
  readonly customer_facing: number;
}

const mapArtifact = (row: ArtifactRow): ArtifactMetadataRecord => ({
  id: row.id,
  runId: row.run_id,
  tenantScope: row.tenant_scope,
  createdAt: row.created_at,
  name: row.name,
  kind: row.kind as ArtifactMetadataRecord["kind"],
  content: contentRefFrom(
    row.content_sha256,
    row.content_byte_size,
    row.content_storage_ref,
  ),
  customerFacing: toBool(row.customer_facing),
});

interface ArtifactStmts {
  readonly insert: Stmt;
  readonly selectById: Stmt;
  readonly selectByIdAndTenant: Stmt;
  readonly selectByRun: Stmt;
  readonly selectRunById: Stmt;
}

export const createArtifactRepository = (db: Db): ArtifactRepository => {
  let stmts: ArtifactStmts | undefined;
  const s = (): ArtifactStmts =>
    (stmts ??= {
      insert: db.prepare(
        `INSERT INTO artifacts (id, run_id, tenant_scope, created_at, name, kind,
           content_sha256, content_byte_size, content_storage_ref, customer_facing)
         VALUES (@id, @runId, @tenantScope, @createdAt, @name, @kind,
           @contentSha256, @contentByteSize, @contentStorageRef, @customerFacing)`,
      ),
      selectById: db.prepare(`SELECT * FROM artifacts WHERE id = ?`),
      selectByIdAndTenant: db.prepare(
        `SELECT * FROM artifacts WHERE id = ? AND tenant_scope = ?`,
      ),
      selectByRun: db.prepare(
        `SELECT * FROM artifacts
           WHERE run_id = ? AND tenant_scope = ?
           ORDER BY rowid`,
      ),
      selectRunById: db.prepare(`SELECT * FROM runs WHERE id = ?`),
    });
  return {
    create(input: CreateArtifactInput): ArtifactMetadataRecord {
      const handles = s();
      const runRow = handles.selectRunById.get(input.runId) as
        | RunRow
        | undefined;
      assertSameTenantRun(
        runRow ? mapRun(runRow) : undefined,
        input.tenantScope,
        "artifact runId",
      );
      assertCanonicalContentRef(input.content, "artifact content");
      const id = randomUUID();
      const params: BindRow = {
        id,
        runId: input.runId,
        tenantScope: input.tenantScope,
        createdAt: nowIso(),
        name: input.name,
        kind: input.kind,
        contentSha256: input.content.sha256,
        contentByteSize: input.content.byteSize,
        contentStorageRef: input.content.storageRef,
        customerFacing: fromBool(input.customerFacing),
      };
      handles.insert.run(params);
      return mapArtifact(handles.selectById.get(id) as ArtifactRow);
    },
    get(id: string, tenantScope: string): ArtifactMetadataRecord | undefined {
      const row = s().selectByIdAndTenant.get(id, tenantScope) as
        | ArtifactRow
        | undefined;
      return row ? mapArtifact(row) : undefined;
    },
    list(filter: RunTenantFilter): readonly ArtifactMetadataRecord[] {
      const rows = s().selectByRun.all(
        filter.runId,
        filter.tenantScope,
      ) as ArtifactRow[];
      return rows.map(mapArtifact);
    },
  };
};

interface ScopeBasketRow {
  readonly id: string;
  readonly tenant_scope: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly label: string;
  readonly snapshot_id: string | null;
  readonly selection: string;
  readonly item_count: number;
}

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

const parseSelection = (json: string): ScopeSelection => {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) {
    return { nodeIds: [], pageIds: [], frameIds: [] };
  }
  const record = parsed as Record<string, unknown>;
  return {
    nodeIds: asStringArray(record.nodeIds),
    pageIds: asStringArray(record.pageIds),
    frameIds: asStringArray(record.frameIds),
  };
};

const mapScopeBasket = (row: ScopeBasketRow): ScopeBasketRecord => ({
  id: row.id,
  tenantScope: row.tenant_scope,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  label: row.label,
  ...(row.snapshot_id !== null ? { snapshotId: row.snapshot_id } : {}),
  selection: parseSelection(row.selection),
  itemCount: row.item_count,
});

const countSelection = (selection: ScopeSelection): number =>
  selection.nodeIds.length +
  selection.pageIds.length +
  selection.frameIds.length;

interface ScopeBasketStmts {
  readonly insert: Stmt;
  readonly selectById: Stmt;
  readonly selectByIdAndTenant: Stmt;
  readonly selectAll: Stmt;
  readonly update: Stmt;
}

export const createScopeBasketRepository = (db: Db): ScopeBasketRepository => {
  let stmts: ScopeBasketStmts | undefined;
  const s = (): ScopeBasketStmts =>
    (stmts ??= {
      insert: db.prepare(
        `INSERT INTO scope_baskets (id, tenant_scope, created_at, updated_at, label,
           snapshot_id, selection, item_count)
         VALUES (@id, @tenantScope, @createdAt, @updatedAt, @label,
           @snapshotId, @selection, @itemCount)`,
      ),
      selectById: db.prepare(`SELECT * FROM scope_baskets WHERE id = ?`),
      selectByIdAndTenant: db.prepare(
        `SELECT * FROM scope_baskets WHERE id = ? AND tenant_scope = ?`,
      ),
      selectAll: db.prepare(
        `SELECT * FROM scope_baskets
           WHERE (@tenantScope IS NULL OR tenant_scope = @tenantScope)
             AND (@snapshotId IS NULL OR snapshot_id = @snapshotId)
           ORDER BY rowid`,
      ),
      update: db.prepare(
        `UPDATE scope_baskets
           SET label = ?, selection = ?, item_count = ?, updated_at = ?
           WHERE id = ? AND tenant_scope = ?`,
      ),
    });
  return {
    create(input: CreateScopeBasketInput): ScopeBasketRecord {
      const handles = s();
      const id = randomUUID();
      const timestamp = nowIso();
      const params: BindRow = {
        id,
        tenantScope: input.tenantScope,
        createdAt: timestamp,
        updatedAt: timestamp,
        label: input.label,
        snapshotId: input.snapshotId ?? null,
        selection: JSON.stringify(input.selection),
        itemCount: input.itemCount,
      };
      handles.insert.run(params);
      return mapScopeBasket(handles.selectById.get(id) as ScopeBasketRow);
    },
    get(id: string, tenantScope: string): ScopeBasketRecord | undefined {
      const row = s().selectByIdAndTenant.get(id, tenantScope) as
        | ScopeBasketRow
        | undefined;
      return row ? mapScopeBasket(row) : undefined;
    },
    list(filter?: ScopeBasketFilter): readonly ScopeBasketRecord[] {
      const params: BindRow = {
        tenantScope: filter?.tenantScope ?? null,
        snapshotId: filter?.snapshotId ?? null,
      };
      const rows = s().selectAll.all(params) as ScopeBasketRow[];
      return rows.map(mapScopeBasket);
    },
    update(
      id: string,
      tenantScope: string,
      changes: ScopeBasketChanges,
    ): ScopeBasketRecord | undefined {
      const handles = s();
      const existingRow = handles.selectByIdAndTenant.get(id, tenantScope) as
        | ScopeBasketRow
        | undefined;
      if (!existingRow) return undefined;
      const existing = mapScopeBasket(existingRow);
      const selection = changes.selection ?? existing.selection;
      handles.update.run(
        changes.label ?? existing.label,
        JSON.stringify(selection),
        countSelection(selection),
        nowIso(),
        id,
        tenantScope,
      );
      return mapScopeBasket(
        handles.selectByIdAndTenant.get(id, tenantScope) as ScopeBasketRow,
      );
    },
  };
};

interface GeneratedSeedRow {
  readonly id: string;
  readonly run_id: string;
  readonly tenant_scope: string;
  readonly created_at: string;
  readonly status: string;
  readonly count: number;
  readonly content_sha256: string;
  readonly content_byte_size: number;
  readonly content_storage_ref: string;
}

const mapGeneratedSeed = (
  row: GeneratedSeedRow,
): GeneratedSeedMetadataRecord => ({
  id: row.id,
  runId: row.run_id,
  tenantScope: row.tenant_scope,
  createdAt: row.created_at,
  status: row.status,
  count: row.count,
  content: contentRefFrom(
    row.content_sha256,
    row.content_byte_size,
    row.content_storage_ref,
  ),
});

interface GeneratedSeedStmts {
  readonly insert: Stmt;
  readonly selectById: Stmt;
  readonly selectByIdAndTenant: Stmt;
  readonly selectByRun: Stmt;
  readonly selectRunById: Stmt;
}

export const createGeneratedSeedRepository = (
  db: Db,
): GeneratedSeedRepository => {
  let stmts: GeneratedSeedStmts | undefined;
  const s = (): GeneratedSeedStmts =>
    (stmts ??= {
      insert: db.prepare(
        `INSERT INTO generated_seeds (id, run_id, tenant_scope, created_at, status,
           count, content_sha256, content_byte_size, content_storage_ref)
         VALUES (@id, @runId, @tenantScope, @createdAt, @status,
           @count, @contentSha256, @contentByteSize, @contentStorageRef)`,
      ),
      selectById: db.prepare(`SELECT * FROM generated_seeds WHERE id = ?`),
      selectByIdAndTenant: db.prepare(
        `SELECT * FROM generated_seeds WHERE id = ? AND tenant_scope = ?`,
      ),
      selectByRun: db.prepare(
        `SELECT * FROM generated_seeds
           WHERE run_id = ? AND tenant_scope = ?
           ORDER BY rowid`,
      ),
      selectRunById: db.prepare(`SELECT * FROM runs WHERE id = ?`),
    });
  return {
    create(input: CreateGeneratedSeedInput): GeneratedSeedMetadataRecord {
      const handles = s();
      const runRow = handles.selectRunById.get(input.runId) as
        | RunRow
        | undefined;
      assertSameTenantRun(
        runRow ? mapRun(runRow) : undefined,
        input.tenantScope,
        "generated seed runId",
      );
      assertCanonicalContentRef(input.content, "generated seed content");
      const id = randomUUID();
      const params: BindRow = {
        id,
        runId: input.runId,
        tenantScope: input.tenantScope,
        createdAt: nowIso(),
        status: input.status,
        count: input.count,
        contentSha256: input.content.sha256,
        contentByteSize: input.content.byteSize,
        contentStorageRef: input.content.storageRef,
      };
      handles.insert.run(params);
      return mapGeneratedSeed(handles.selectById.get(id) as GeneratedSeedRow);
    },
    get(
      id: string,
      tenantScope: string,
    ): GeneratedSeedMetadataRecord | undefined {
      const row = s().selectByIdAndTenant.get(id, tenantScope) as
        | GeneratedSeedRow
        | undefined;
      return row ? mapGeneratedSeed(row) : undefined;
    },
    list(filter: RunTenantFilter): readonly GeneratedSeedMetadataRecord[] {
      const rows = s().selectByRun.all(
        filter.runId,
        filter.tenantScope,
      ) as GeneratedSeedRow[];
      return rows.map(mapGeneratedSeed);
    },
  };
};

interface ExportRow {
  readonly id: string;
  readonly run_id: string;
  readonly tenant_scope: string;
  readonly created_at: string;
  readonly format: string;
  readonly status: string;
  readonly content_sha256: string;
  readonly content_byte_size: number;
  readonly content_storage_ref: string;
}

const mapExport = (row: ExportRow): ExportMetadataRecord => ({
  id: row.id,
  runId: row.run_id,
  tenantScope: row.tenant_scope,
  createdAt: row.created_at,
  format: row.format as ExportMetadataRecord["format"],
  status: row.status,
  content: contentRefFrom(
    row.content_sha256,
    row.content_byte_size,
    row.content_storage_ref,
  ),
});

interface ExportStmts {
  readonly insert: Stmt;
  readonly selectById: Stmt;
  readonly selectByIdAndTenant: Stmt;
  readonly selectByRun: Stmt;
  readonly selectRunById: Stmt;
}

export const createExportRepository = (db: Db): ExportRepository => {
  let stmts: ExportStmts | undefined;
  const s = (): ExportStmts =>
    (stmts ??= {
      insert: db.prepare(
        `INSERT INTO exports (id, run_id, tenant_scope, created_at, format, status,
           content_sha256, content_byte_size, content_storage_ref)
         VALUES (@id, @runId, @tenantScope, @createdAt, @format, @status,
           @contentSha256, @contentByteSize, @contentStorageRef)`,
      ),
      selectById: db.prepare(`SELECT * FROM exports WHERE id = ?`),
      selectByIdAndTenant: db.prepare(
        `SELECT * FROM exports WHERE id = ? AND tenant_scope = ?`,
      ),
      selectByRun: db.prepare(
        `SELECT * FROM exports
           WHERE run_id = ? AND tenant_scope = ?
           ORDER BY rowid`,
      ),
      selectRunById: db.prepare(`SELECT * FROM runs WHERE id = ?`),
    });
  return {
    create(input: CreateExportInput): ExportMetadataRecord {
      const handles = s();
      const runRow = handles.selectRunById.get(input.runId) as
        | RunRow
        | undefined;
      assertSameTenantRun(
        runRow ? mapRun(runRow) : undefined,
        input.tenantScope,
        "export runId",
      );
      assertCanonicalContentRef(input.content, "export content");
      const id = randomUUID();
      const params: BindRow = {
        id,
        runId: input.runId,
        tenantScope: input.tenantScope,
        createdAt: nowIso(),
        format: input.format,
        status: input.status,
        contentSha256: input.content.sha256,
        contentByteSize: input.content.byteSize,
        contentStorageRef: input.content.storageRef,
      };
      handles.insert.run(params);
      return mapExport(handles.selectById.get(id) as ExportRow);
    },
    get(id: string, tenantScope: string): ExportMetadataRecord | undefined {
      const row = s().selectByIdAndTenant.get(id, tenantScope) as
        | ExportRow
        | undefined;
      return row ? mapExport(row) : undefined;
    },
    list(filter: RunTenantFilter): readonly ExportMetadataRecord[] {
      const rows = s().selectByRun.all(
        filter.runId,
        filter.tenantScope,
      ) as ExportRow[];
      return rows.map(mapExport);
    },
  };
};
