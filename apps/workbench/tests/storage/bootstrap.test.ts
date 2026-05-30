// @vitest-environment node
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkbenchStorageError } from "@/lib/server/storage";
import type { WorkbenchMigration } from "@/lib/server/storage";
import {
  bootstrapWorkbenchStorage,
  getWorkbenchStorage,
  resetWorkbenchStorageForTests,
} from "@/lib/server/storage/bootstrap";
import { WORKBENCH_SCHEMA_TABLES } from "@/lib/server/storage/sqlite-schema";

const readUserVersion = (file: string): number => {
  const db = new BetterSqlite3(file);
  const version = Number(db.pragma("user_version", { simple: true }));
  db.close();
  return version;
};

const failingSchemaSteps: readonly WorkbenchMigration[] = [
  {
    version: 1,
    description: "intentionally failing schema step",
    up() {
      throw new Error("forced migration failure");
    },
  },
];

// WHY a second fixture: the seeded-DB scenario starts at `user_version = 1`, so
// `migrateToLatest` would filter out a failing v1 step (1 > 1 is false) and
// never throw. A no-op v1 keeps `validateMigrationSequence`'s contiguous-from-1
// rule satisfied while the genuinely failing step lives at v2, which is the
// only version `pending` selects against the seeded DB.
const failingFollowupSchemaSteps: readonly WorkbenchMigration[] = [
  {
    version: 1,
    description: "no-op v1 (already applied on existing database)",
    up() {},
  },
  {
    version: 2,
    description: "intentionally failing follow-up step",
    up() {
      throw new Error("forced migration failure");
    },
  },
];

describe("bootstrapWorkbenchStorage", () => {
  let root: string;
  let databaseFile: string;
  let artifactRoot: string;

  beforeEach(() => {
    root = path.join(tmpdir(), `ti-bootstrap-${randomUUID()}`);
    databaseFile = path.join(root, "db", "workbench.db");
    artifactRoot = path.join(root, "storage-artifacts");
  });

  afterEach(() => {
    resetWorkbenchStorageForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("creates the database file and all tables when missing (AC#1)", () => {
    expect(existsSync(databaseFile)).toBe(false);
    const adapter = bootstrapWorkbenchStorage({ databaseFile, artifactRoot });
    expect(existsSync(databaseFile)).toBe(true);
    expect(existsSync(artifactRoot)).toBe(true);
    expect(adapter.getSchemaVersion()).toBe(1);
    adapter.close();

    const raw = new BetterSqlite3(databaseFile);
    const names = (
      raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    raw.close();
    for (const table of WORKBENCH_SCHEMA_TABLES) {
      expect(names).toContain(table);
    }
  });

  it("is idempotent and non-destructive on restart (AC#2)", () => {
    const first = bootstrapWorkbenchStorage({ databaseFile, artifactRoot });
    const created = first.runs.create({
      tenantScope: "tenant-a",
      status: "queued",
      label: "survivor",
    });
    first.close();

    const second = bootstrapWorkbenchStorage({ databaseFile, artifactRoot });
    expect(second.getSchemaVersion()).toBe(1);
    expect(second.runs.get(created.id)).toStrictEqual(created);
    expect(second.runs.list()).toHaveLength(1);
    second.close();
  });

  it("leaves artifact files intact and throws a clear error on migration failure (AC#3)", () => {
    mkdirSync(artifactRoot, { recursive: true });
    const stagedArtifact = path.join(artifactRoot, "pre-existing.bin");
    writeFileSync(stagedArtifact, "important-bytes", "utf8");

    let thrown: unknown;
    try {
      bootstrapWorkbenchStorage({
        databaseFile,
        artifactRoot,
        schemaSteps: failingSchemaSteps,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(WorkbenchStorageError);
    expect((thrown as WorkbenchStorageError).code).toBe("MIGRATION_FAILED");
    // No secret or filesystem path leaks into the operator message.
    expect((thrown as WorkbenchStorageError).message).not.toContain(root);

    // The pre-staged artifact file is untouched.
    expect(existsSync(stagedArtifact)).toBe(true);
    expect(readFileSync(stagedArtifact, "utf8")).toBe("important-bytes");

    // The database was not left half-migrated (stays at version 0).
    expect(readUserVersion(databaseFile)).toBe(0);
  });

  it("does not delete an existing database on migration failure (AC#3)", () => {
    const seeded = bootstrapWorkbenchStorage({ databaseFile, artifactRoot });
    const created = seeded.runs.create({ tenantScope: "t", status: "queued" });
    seeded.close();

    expect(() =>
      bootstrapWorkbenchStorage({
        databaseFile,
        artifactRoot,
        schemaSteps: failingFollowupSchemaSteps,
      }),
    ).toThrow(WorkbenchStorageError);

    const survivor = bootstrapWorkbenchStorage({ databaseFile, artifactRoot });
    expect(survivor.runs.get(created.id)).toStrictEqual(created);
    survivor.close();
  });
});

describe("getWorkbenchStorage singleton", () => {
  let root: string;

  beforeEach(() => {
    root = path.join(tmpdir(), `ti-bootstrap-singleton-${randomUUID()}`);
  });

  afterEach(() => {
    resetWorkbenchStorageForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the same cached adapter across calls", () => {
    const databaseFile = path.join(root, "db", "workbench.db");
    const artifactRoot = path.join(root, "storage-artifacts");
    const first = getWorkbenchStorage({ databaseFile, artifactRoot });
    const second = getWorkbenchStorage({ databaseFile, artifactRoot });
    expect(second).toBe(first);
  });
});
