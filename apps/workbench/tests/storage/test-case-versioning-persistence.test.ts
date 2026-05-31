// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { artifactStorageRef } from "@/lib/server/storage";
import { createSqliteWorkbenchStorageAdapter } from "@/lib/server/storage/sqlite-adapter";
import {
  WORKBENCH_SCHEMA_INDEXES,
  WORKBENCH_SCHEMA_VERSION,
} from "@/lib/server/storage/sqlite-schema";
import type { WorkbenchStorageAdapter } from "@/lib/server/storage";

const SHA = "1".repeat(64);
const CONTENT_REF = {
  sha256: SHA,
  byteSize: 32,
  storageRef: artifactStorageRef(SHA),
};

const seedV1 = (
  adapter: WorkbenchStorageAdapter,
): {
  readonly testCaseId: string;
  readonly v1Id: string;
  readonly runId: string;
} => {
  const run = adapter.runs.create({
    tenantScope: "tenant-a",
    status: "sealed",
  });
  const seed = adapter.generatedSeeds.create({
    runId: run.id,
    tenantScope: "tenant-a",
    status: "ready",
    count: 1,
    content: CONTENT_REF,
  });
  const detail = adapter.testCases.create({
    tenantScope: "tenant-a",
    sourceRunId: run.id,
    sourceGeneratedSeedId: seed.id,
    sourceTestCaseId: "src-tc",
    status: "draft",
    initialVersion: {
      source: "generated",
      title: "V1 title",
      objective: "v1",
      preconditions: ["pre"],
      steps: [{ action: "do", expected: "done" }],
      testData: ["data"],
      priority: "P1",
      risk: "regulatory",
      tags: ["L1"],
      status: "generated",
      content: CONTENT_REF,
      traceTargets: [{ targetKind: "run", targetId: run.id }],
    },
  });
  return {
    testCaseId: detail.testCase.id,
    v1Id: detail.currentVersion.id,
    runId: run.id,
  };
};

interface VersionRow {
  readonly id: string;
  readonly source: string;
  readonly title: string;
  readonly previous_version_id: string | null;
  readonly change_reason: string | null;
  readonly version_index: number;
  readonly content_sha256: string;
}

describe("test case versioning persistence (Issue #58)", () => {
  let tempDir: string;
  let databaseFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "ti-tc-ver-persist-"));
    databaseFile = path.join(tempDir, "wb.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("schema v4 migration runs on a fresh database and exposes lineage columns + audit index", () => {
    const adapter = createSqliteWorkbenchStorageAdapter({ databaseFile });
    expect(adapter.getSchemaVersion()).toBe(WORKBENCH_SCHEMA_VERSION);
    adapter.close();

    const raw = new BetterSqlite3(databaseFile);
    const cols = raw.prepare(`PRAGMA table_info(test_case_versions)`).all() as {
      name: string;
    }[];
    const names = cols.map((row) => row.name);
    expect(names).toContain("previous_version_id");
    expect(names).toContain("change_reason");

    const indexRows = raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
      .all() as { name: string }[];
    raw.close();
    expect(indexRows.map((r) => r.name)).toContain(
      "idx_workbench_audit_events_tenant",
    );
    expect(WORKBENCH_SCHEMA_INDEXES).toContain(
      "idx_workbench_audit_events_tenant",
    );
  });

  it("appendVersion preserves the v1 row unchanged (source stays generated)", () => {
    const adapter = createSqliteWorkbenchStorageAdapter({ databaseFile });
    const seeded = seedV1(adapter);

    const raw = new BetterSqlite3(databaseFile);
    const v1Before = raw
      .prepare(`SELECT * FROM test_case_versions WHERE id = ?`)
      .get(seeded.v1Id) as VersionRow;
    raw.close();

    adapter.testCases.appendVersion({
      testCaseId: seeded.testCaseId,
      tenantScope: "tenant-a",
      changeReason: "Operator edit",
      version: {
        title: "V2 title",
        objective: "v2",
        preconditions: [],
        steps: [{ action: "edit", expected: "edited" }],
        testData: [],
        priority: "P2",
        risk: "low",
        tags: [],
        status: "draft",
        content: CONTENT_REF,
        traceTargets: [{ targetKind: "run", targetId: seeded.runId }],
      },
    });
    adapter.close();

    const raw2 = new BetterSqlite3(databaseFile);
    const v1After = raw2
      .prepare(`SELECT * FROM test_case_versions WHERE id = ?`)
      .get(seeded.v1Id) as VersionRow;
    const v2 = raw2
      .prepare(
        `SELECT * FROM test_case_versions WHERE test_case_id = ? AND version_index = 2`,
      )
      .get(seeded.testCaseId) as VersionRow;
    raw2.close();

    expect(v1After).toStrictEqual(v1Before);
    expect(v1After.source).toBe("generated");
    expect(v1After.previous_version_id).toBeNull();
    expect(v1After.change_reason).toBeNull();
    expect(v2.source).toBe("manual");
    expect(v2.previous_version_id).toBe(seeded.v1Id);
    expect(v2.change_reason).toBe("Operator edit");
  });

  it("appendVersion bumps test_cases.currentVersionId and updated_at", async () => {
    const adapter = createSqliteWorkbenchStorageAdapter({ databaseFile });
    const seeded = seedV1(adapter);

    const raw = new BetterSqlite3(databaseFile);
    const before = raw
      .prepare(
        `SELECT current_version_id, updated_at FROM test_cases WHERE id = ?`,
      )
      .get(seeded.testCaseId) as {
      current_version_id: string;
      updated_at: string;
    };
    raw.close();

    // Ensure a measurable timestamp gap on fast machines.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const detail = adapter.testCases.appendVersion({
      testCaseId: seeded.testCaseId,
      tenantScope: "tenant-a",
      version: {
        title: "V2 title",
        objective: "v2",
        preconditions: [],
        steps: [{ action: "edit", expected: "edited" }],
        testData: [],
        priority: "P2",
        risk: "low",
        tags: [],
        status: "draft",
        content: CONTENT_REF,
        traceTargets: [{ targetKind: "run", targetId: seeded.runId }],
      },
    });
    adapter.close();

    expect(detail.testCase.currentVersionId).not.toBe(
      before.current_version_id,
    );
    expect(Date.parse(detail.testCase.updatedAt)).toBeGreaterThan(
      Date.parse(before.updated_at),
    );
  });

  it("schema v4 migration runs on an existing v3 database without losing data", () => {
    // Seed a v3 database manually, then re-open with the v4 build.
    const raw = new BetterSqlite3(databaseFile);
    raw.exec(
      `CREATE TABLE snapshots (
         id TEXT PRIMARY KEY, tenant_scope TEXT, created_at TEXT, label TEXT,
         source TEXT, node_count INTEGER, page_count INTEGER, frame_count INTEGER,
         lifecycle_state TEXT, payload_sha256 TEXT, payload_byte_size INTEGER,
         payload_storage_ref TEXT
       );
       CREATE TABLE runs (
         id TEXT PRIMARY KEY, tenant_scope TEXT, created_at TEXT,
         updated_at TEXT, status TEXT, snapshot_id TEXT, label TEXT,
         artifact_dir TEXT
       );
       CREATE TABLE artifacts (
         id TEXT PRIMARY KEY, run_id TEXT, tenant_scope TEXT, created_at TEXT,
         name TEXT, kind TEXT, content_sha256 TEXT, content_byte_size INTEGER,
         content_storage_ref TEXT, customer_facing INTEGER
       );
       CREATE TABLE scope_baskets (
         id TEXT PRIMARY KEY, tenant_scope TEXT, created_at TEXT, updated_at TEXT,
         label TEXT, snapshot_id TEXT, selection TEXT, item_count INTEGER
       );
       CREATE TABLE generated_seeds (
         id TEXT PRIMARY KEY, run_id TEXT, tenant_scope TEXT, created_at TEXT,
         status TEXT, count INTEGER, content_sha256 TEXT, content_byte_size INTEGER,
         content_storage_ref TEXT
       );
       CREATE TABLE exports (
         id TEXT PRIMARY KEY, run_id TEXT, tenant_scope TEXT, created_at TEXT,
         format TEXT, status TEXT, content_sha256 TEXT, content_byte_size INTEGER,
         content_storage_ref TEXT
       );
       CREATE TABLE render_metadata (
         id TEXT PRIMARY KEY, tenant_scope TEXT, created_at TEXT, payload TEXT
       );
       CREATE TABLE test_cases (
         id TEXT PRIMARY KEY,
         tenant_scope TEXT NOT NULL,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         source_run_id TEXT NOT NULL,
         source_generated_seed_id TEXT NOT NULL,
         source_test_case_id TEXT NOT NULL,
         current_version_id TEXT NOT NULL,
         status TEXT NOT NULL
       );
       CREATE TABLE test_case_versions (
         id TEXT PRIMARY KEY,
         test_case_id TEXT NOT NULL,
         tenant_scope TEXT NOT NULL,
         created_at TEXT NOT NULL,
         version_index INTEGER NOT NULL,
         source TEXT NOT NULL,
         title TEXT NOT NULL,
         objective TEXT NOT NULL,
         preconditions TEXT NOT NULL,
         steps TEXT NOT NULL,
         test_data TEXT NOT NULL,
         priority TEXT NOT NULL,
         risk TEXT NOT NULL,
         tags TEXT NOT NULL,
         status TEXT NOT NULL,
         description TEXT,
         content_sha256 TEXT NOT NULL,
         content_byte_size INTEGER NOT NULL,
         content_storage_ref TEXT NOT NULL
       );
       CREATE TABLE test_case_trace_links (
         id TEXT PRIMARY KEY,
         test_case_version_id TEXT NOT NULL,
         tenant_scope TEXT NOT NULL,
         created_at TEXT NOT NULL,
         target_kind TEXT NOT NULL,
         target_id TEXT NOT NULL
       );
       CREATE TABLE audit_events (
         id TEXT PRIMARY KEY,
         tenant_scope TEXT,
         created_at TEXT,
         payload TEXT
       );`,
    );
    raw.exec(
      `INSERT INTO test_cases (id, tenant_scope, created_at, updated_at,
         source_run_id, source_generated_seed_id, source_test_case_id,
         current_version_id, status)
       VALUES ('tc-old', 't', '2026-01-01', '2026-01-01', 'r', 's', 'src', 'v-old', 'draft');
       INSERT INTO test_case_versions (id, test_case_id, tenant_scope, created_at,
         version_index, source, title, objective, preconditions, steps, test_data,
         priority, risk, tags, status, content_sha256, content_byte_size, content_storage_ref)
       VALUES ('v-old', 'tc-old', 't', '2026-01-01', 1, 'generated', 'Pre-v4',
         '', '[]', '[]', '[]', 'P1', 'low', '[]', 'generated',
         '${SHA}', 32, '${artifactStorageRef(SHA)}');`,
    );
    raw.pragma(`user_version = 3`);
    raw.close();

    const reopened = createSqliteWorkbenchStorageAdapter({ databaseFile });
    expect(reopened.getSchemaVersion()).toBe(WORKBENCH_SCHEMA_VERSION);
    const fetched = reopened.testCases.get("tc-old", "t");
    expect(fetched?.testCase.id).toBe("tc-old");
    expect(fetched?.currentVersion.previousVersionId).toBeUndefined();
    expect(fetched?.currentVersion.changeReason).toBeUndefined();
    reopened.close();
  });

  it("audit_events payload column carries no storageRef or raw step content", () => {
    const adapter = createSqliteWorkbenchStorageAdapter({ databaseFile });
    const seeded = seedV1(adapter);
    adapter.testCases.appendVersion({
      testCaseId: seeded.testCaseId,
      tenantScope: "tenant-a",
      changeReason: "secret-looking but plain operator note",
      version: {
        title: "V2 title",
        objective: "v2",
        preconditions: [],
        steps: [
          { action: "SENSITIVE_STEP_ACTION", expected: "SENSITIVE_OUTCOME" },
        ],
        testData: [],
        priority: "P2",
        risk: "low",
        tags: [],
        status: "draft",
        content: CONTENT_REF,
        traceTargets: [{ targetKind: "run", targetId: seeded.runId }],
      },
    });
    adapter.close();

    const raw = new BetterSqlite3(databaseFile);
    const events = raw.prepare(`SELECT payload FROM audit_events`).all() as {
      payload: string;
    }[];
    raw.close();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.payload).not.toContain("storageRef");
      expect(event.payload).not.toContain(CONTENT_REF.sha256);
      expect(event.payload).not.toContain("SENSITIVE_STEP_ACTION");
      expect(event.payload).not.toContain("SENSITIVE_OUTCOME");
    }
  });

  it("truncates change_reason to 500 chars when persisted", () => {
    const adapter = createSqliteWorkbenchStorageAdapter({ databaseFile });
    const seeded = seedV1(adapter);
    const longReason = "x".repeat(2000);
    adapter.testCases.appendVersion({
      testCaseId: seeded.testCaseId,
      tenantScope: "tenant-a",
      changeReason: longReason,
      version: {
        title: "V2 title",
        objective: "v2",
        preconditions: [],
        steps: [{ action: "edit", expected: "edited" }],
        testData: [],
        priority: "P2",
        risk: "low",
        tags: [],
        status: "draft",
        content: CONTENT_REF,
        traceTargets: [{ targetKind: "run", targetId: seeded.runId }],
      },
    });
    adapter.close();

    const raw = new BetterSqlite3(databaseFile);
    const row = raw
      .prepare(
        `SELECT change_reason FROM test_case_versions
           WHERE test_case_id = ? AND version_index = 2`,
      )
      .get(seeded.testCaseId) as { change_reason: string };
    raw.close();
    expect(row.change_reason.length).toBe(500);
  });
});
