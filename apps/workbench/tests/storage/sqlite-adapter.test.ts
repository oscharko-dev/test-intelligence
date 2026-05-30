// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  WorkbenchMigration,
  WorkbenchStorageAdapter,
} from "@/lib/server/storage";
import { createSqliteWorkbenchStorageAdapter } from "@/lib/server/storage/sqlite-adapter";
import { WORKBENCH_SCHEMA_TABLES } from "@/lib/server/storage/sqlite-schema";

import { runWorkbenchStorageAdapterContract } from "./adapter-contract";

runWorkbenchStorageAdapterContract(
  "SqliteWorkbenchStorageAdapter",
  (options) =>
    options?.migrations
      ? createSqliteWorkbenchStorageAdapter({
          databaseFile: ":memory:",
          migrations: options.migrations,
        })
      : createSqliteWorkbenchStorageAdapter({ databaseFile: ":memory:" }),
);

describe("SqliteWorkbenchStorageAdapter specifics", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "ti-sqlite-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates all eight schema tables on auto-migrate", () => {
    const file = path.join(tempDir, "tables.db");
    const persisted = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
    });
    expect(persisted.getSchemaVersion()).toBe(1);
    persisted.close();
    const raw = new BetterSqlite3(file);
    const rows = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as { name: string }[];
    raw.close();
    const names = rows.map((row) => row.name);
    for (const table of WORKBENCH_SCHEMA_TABLES) {
      expect(names).toContain(table);
    }
    expect(WORKBENCH_SCHEMA_TABLES).toHaveLength(8);
  });

  it("persists data to a file and re-opens idempotently without data loss", () => {
    const file = path.join(tempDir, "persist.db");
    const first = createSqliteWorkbenchStorageAdapter({ databaseFile: file });
    const created = first.runs.create({
      tenantScope: "tenant-a",
      status: "queued",
      label: "kept",
    });
    first.close();

    const reopened = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
    });
    expect(reopened.getSchemaVersion()).toBe(1);
    expect(reopened.runs.get(created.id)).toStrictEqual(created);
    expect(reopened.runs.list()).toHaveLength(1);
    reopened.close();
  });

  it("maps a SQL NULL optional to an absent key (no label)", () => {
    const adapter = createSqliteWorkbenchStorageAdapter({
      databaseFile: ":memory:",
    });
    const created = adapter.runs.create({
      tenantScope: "tenant-a",
      status: "queued",
    });
    expect(created).not.toHaveProperty("label");
    expect(created).not.toHaveProperty("snapshotId");
    expect(created).not.toHaveProperty("artifactDir");
    const fetched = adapter.runs.get(created.id);
    expect(fetched).toStrictEqual(created);
    expect(fetched).not.toHaveProperty("label");
    adapter.close();
  });

  it("round-trips customerFacing as a boolean for both values", () => {
    const adapter = createSqliteWorkbenchStorageAdapter({
      databaseFile: ":memory:",
    });
    const run = adapter.runs.create({ tenantScope: "t", status: "queued" });
    const content = {
      sha256: "a".repeat(64),
      byteSize: 1,
      storageRef: "aa/bb/x.bin",
    };
    const facing = adapter.artifacts.create({
      runId: run.id,
      tenantScope: "t",
      name: "f.md",
      kind: "markdown",
      content,
      customerFacing: true,
    });
    const internal = adapter.artifacts.create({
      runId: run.id,
      tenantScope: "t",
      name: "i.md",
      kind: "markdown",
      content,
      customerFacing: false,
    });
    expect(facing.customerFacing).toBe(true);
    expect(internal.customerFacing).toBe(false);
    expect(adapter.artifacts.get(facing.id)?.customerFacing).toBe(true);
    expect(adapter.artifacts.get(internal.id)?.customerFacing).toBe(false);
    adapter.close();
  });

  it("preserves an optional ContentRef payload round-trip", () => {
    const adapter = createSqliteWorkbenchStorageAdapter({
      databaseFile: ":memory:",
    });
    const withPayload = adapter.snapshots.create({
      tenantScope: "t",
      source: "figma:k",
      nodeCount: 1,
      pageCount: 1,
      frameCount: 1,
      lifecycleState: "imported",
      payload: {
        sha256: "b".repeat(64),
        byteSize: 9,
        storageRef: "bb/cc/y.bin",
      },
    });
    const withoutPayload = adapter.snapshots.create({
      tenantScope: "t",
      source: "figma:k",
      nodeCount: 1,
      pageCount: 1,
      frameCount: 1,
      lifecycleState: "imported",
    });
    expect(withPayload.payload?.byteSize).toBe(9);
    expect(adapter.snapshots.get(withPayload.id)).toStrictEqual(withPayload);
    expect(withoutPayload).not.toHaveProperty("payload");
    expect(adapter.snapshots.get(withoutPayload.id)).toStrictEqual(
      withoutPayload,
    );
    adapter.close();
  });
});

describe("createSqliteWorkbenchStorageAdapter modes", () => {
  it("auto-migrates the built-in schema when migrations are omitted", () => {
    const adapter: WorkbenchStorageAdapter =
      createSqliteWorkbenchStorageAdapter({ databaseFile: ":memory:" });
    expect(adapter.getSchemaVersion()).toBe(1);
    adapter.close();
  });

  it("stays at version 0 in explicit mode until migrateToLatest is called", () => {
    const adapter = createSqliteWorkbenchStorageAdapter({
      databaseFile: ":memory:",
      migrations: [],
    });
    expect(adapter.getSchemaVersion()).toBe(0);
    adapter.close();
  });

  it("rolls back to a NON-ZERO start version when a later migration throws", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "ti-sqlite-rb-"));
    const file = path.join(tempDir, "rollback.db");
    const ok = (version: number): WorkbenchMigration => ({
      version,
      description: `ok ${version}`,
      up() {},
    });

    const first = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [ok(1)],
    });
    expect(first.migrateToLatest()).toBe(1);
    first.close();

    // Reopen at version 1 with a second, failing migration. The start version is
    // 1 (non-zero); a throw must roll back to 1 — not 0, not 2.
    const second = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [
        ok(1),
        {
          version: 2,
          description: "boom",
          up() {
            throw new Error("migration boom");
          },
        },
      ],
    });
    expect(second.getSchemaVersion()).toBe(1);
    expect(() => second.migrateToLatest()).toThrow("migration boom");
    expect(second.getSchemaVersion()).toBe(1);
    second.close();

    rmSync(tempDir, { recursive: true, force: true });
  });
});
