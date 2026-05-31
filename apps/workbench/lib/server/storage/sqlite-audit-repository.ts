/**
 * SQLite-backed audit event repository (Issue #58).
 * Rows live in the v1 `audit_events` table; payloads are canonical JSON.
 */

import { randomUUID } from "node:crypto";

import type BetterSqlite3Database from "better-sqlite3";

import { WorkbenchStorageError } from "./storage-adapter";
import type {
  AuditEventPayload,
  AuditEventRecord,
  AuditEventRepository,
} from "./types";

type Db = BetterSqlite3Database.Database;
type Stmt = BetterSqlite3Database.Statement<unknown[], unknown>;

interface AuditEventRow {
  readonly id: string;
  readonly tenant_scope: string;
  readonly created_at: string;
  readonly payload: string;
}

const nowIso = (): string => new Date().toISOString();

const parsePayload = (json: string): AuditEventPayload => {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { kind?: unknown }).kind !== "string"
  ) {
    throw new WorkbenchStorageError(
      "REFERENTIAL_INTEGRITY",
      "audit event payload is malformed.",
    );
  }
  return parsed as AuditEventPayload;
};

const mapAuditEvent = (row: AuditEventRow): AuditEventRecord => ({
  id: row.id,
  tenantScope: row.tenant_scope,
  createdAt: row.created_at,
  payload: parsePayload(row.payload),
});

interface AuditStmts {
  readonly insert: Stmt;
  readonly selectById: Stmt;
  readonly selectForCase: Stmt;
}

export const createAuditEventRepository = (db: Db): AuditEventRepository => {
  let stmts: AuditStmts | undefined;
  const s = (): AuditStmts =>
    (stmts ??= {
      insert: db.prepare(
        `INSERT INTO audit_events (id, tenant_scope, created_at, payload)
         VALUES (@id, @tenantScope, @createdAt, @payload)`,
      ),
      selectById: db.prepare(`SELECT * FROM audit_events WHERE id = ?`),
      selectForCase: db.prepare(
        `SELECT * FROM audit_events
           WHERE tenant_scope = ?
             AND JSON_EXTRACT(payload, '$.testCaseId') = ?
           ORDER BY created_at ASC, rowid ASC`,
      ),
    });
  return {
    record(input): AuditEventRecord {
      const handles = s();
      const id = randomUUID();
      handles.insert.run({
        id,
        tenantScope: input.tenantScope,
        createdAt: nowIso(),
        payload: JSON.stringify(input.payload),
      });
      return mapAuditEvent(handles.selectById.get(id) as AuditEventRow);
    },
    listForTestCase(
      testCaseId: string,
      tenantScope: string,
    ): readonly AuditEventRecord[] {
      const rows = s().selectForCase.all(
        tenantScope,
        testCaseId,
      ) as AuditEventRow[];
      return rows.map(mapAuditEvent);
    },
  };
};
