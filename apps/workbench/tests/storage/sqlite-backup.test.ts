// @vitest-environment node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkbenchMigration } from "@/lib/server/storage";
import { createSqliteWorkbenchStorageAdapter } from "@/lib/server/storage/sqlite-adapter";

const noopMigration = (version: number): WorkbenchMigration => ({
  version,
  description: `noop v${version}`,
  up() {},
});

const seedMarkerRow = (databaseFile: string): string => {
  const raw = new BetterSqlite3(databaseFile);
  raw.exec(
    "CREATE TABLE IF NOT EXISTS seed_marker (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  raw
    .prepare("INSERT INTO seed_marker (id, value) VALUES (?, ?)")
    .run("row-1", "pre-migration-data");
  raw.close();
  return "pre-migration-data";
};

const readMarker = (databaseFile: string): string | undefined => {
  const raw = new BetterSqlite3(databaseFile, { readonly: true });
  const row = raw
    .prepare("SELECT value FROM seed_marker WHERE id = ?")
    .get("row-1") as { value: string } | undefined;
  raw.close();
  return row?.value;
};

const userVersionOf = (databaseFile: string): number => {
  const raw = new BetterSqlite3(databaseFile, { readonly: true });
  const version = Number(raw.pragma("user_version", { simple: true }));
  raw.close();
  return version;
};

const backupsDirOf = (databaseFile: string): string =>
  path.join(path.dirname(databaseFile), "backups");

const listBackups = (databaseFile: string): readonly string[] => {
  const dir = backupsDirOf(databaseFile);
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe("SqliteWorkbenchStorageAdapter pre-migration backup", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "ti-sqlite-backup-"));
  });

  afterEach(() => {
    // Restore writability so cleanup never fails on the un-writable-dir case.
    const backups = path.join(tempDir, "backups");
    if (existsSync(backups)) chmodSync(backups, 0o755);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("snapshots populated data to backups/ before applying a new migration", () => {
    const file = path.join(tempDir, "upgrade.db");
    const first = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [noopMigration(1)],
    });
    expect(first.migrateToLatest()).toBe(1);
    first.close();
    const seeded = seedMarkerRow(file);

    const second = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [noopMigration(1), noopMigration(2)],
    });
    expect(second.migrateToLatest()).toBe(2);
    second.close();

    const backups = listBackups(file);
    expect(backups).toHaveLength(1);
    const backupFile = path.join(backupsDirOf(file), backups[0] ?? "");
    // The backup names the version transition for operator triage.
    expect(backups[0]).toContain("v1-to-v2");
    // The backup holds the pre-migration data, proving it was taken first.
    expect(readMarker(backupFile)).toBe(seeded);
    // And the live DB advanced.
    expect(userVersionOf(file)).toBe(2);
  });

  it("takes NO backup on a fresh v0 -> v1 first-time migration", () => {
    const file = path.join(tempDir, "fresh.db");
    const adapter = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [noopMigration(1)],
    });
    expect(adapter.migrateToLatest()).toBe(1);
    adapter.close();
    expect(listBackups(file)).toHaveLength(0);
  });

  it("takes NO backup on a fresh v0 -> [v1, v2] first-time migration", () => {
    const file = path.join(tempDir, "fresh-multi.db");
    const adapter = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [noopMigration(1), noopMigration(2)],
    });
    expect(adapter.migrateToLatest()).toBe(2);
    adapter.close();
    expect(listBackups(file)).toHaveLength(0);
  });

  it("takes NO backup and does not throw for an in-memory database", () => {
    const adapter = createSqliteWorkbenchStorageAdapter({
      databaseFile: ":memory:",
      migrations: [noopMigration(1)],
    });
    expect(adapter.migrateToLatest()).toBe(1);
    expect(() => adapter.migrateToLatest()).not.toThrow();
    adapter.close();
  });

  it("takes NO backup when there is nothing pending (already current)", () => {
    const file = path.join(tempDir, "current.db");
    const first = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [noopMigration(1)],
    });
    first.migrateToLatest();
    first.close();
    seedMarkerRow(file);

    const second = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [noopMigration(1)],
    });
    // current === target === 1, pending is empty: no backup, no transition.
    expect(second.migrateToLatest()).toBe(1);
    second.close();
    expect(listBackups(file)).toHaveLength(0);
  });

  it("fails closed: a backup failure throws and leaves the source DB unchanged", () => {
    const file = path.join(tempDir, "failclosed.db");
    const first = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [noopMigration(1)],
    });
    first.migrateToLatest();
    first.close();
    const seeded = seedMarkerRow(file);

    // Pre-create backups/ and remove write permission so VACUUM INTO cannot
    // place its temp file: the backup step must fail before the migration runs.
    const backups = backupsDirOf(file);
    mkdirSync(backups, { recursive: true });
    chmodSync(backups, 0o500);

    // WHY v2 is a pure noop: it would succeed on its own, so the ONLY thing that
    // can keep user_version at 1 is the backup throwing first. If the backup were
    // (wrongly) swallowed, migrateToLatest would advance to 2 — caught below.
    const second = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [noopMigration(1), noopMigration(2)],
    });
    expect(() => second.migrateToLatest()).toThrow();
    second.close();

    chmodSync(backups, 0o755);
    // The source DB must be untouched: version still 1, original row intact.
    expect(userVersionOf(file)).toBe(1);
    expect(readMarker(file)).toBe(seeded);
    // No valid backup file was left behind that a restore could mistake for a
    // complete snapshot.
    expect(listBackups(file).filter((n) => n.endsWith(".db"))).toHaveLength(0);
  });

  it("writes the backup atomically (no leftover temp on success)", () => {
    const file = path.join(tempDir, "atomic.db");
    const first = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [noopMigration(1)],
    });
    first.migrateToLatest();
    first.close();
    seedMarkerRow(file);

    const second = createSqliteWorkbenchStorageAdapter({
      databaseFile: file,
      migrations: [noopMigration(1), noopMigration(2)],
    });
    second.migrateToLatest();
    second.close();

    const entries = listBackups(file);
    // Exactly one finished .db, no `.tmp` partials.
    expect(entries.every((n) => n.endsWith(".db"))).toBe(true);
    expect(entries.some((n) => n.includes(".tmp"))).toBe(false);
  });
});
