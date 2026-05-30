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
  getWorkbenchStoragePaths,
  resetWorkbenchStorageForTests,
} from "@/lib/server/storage/bootstrap";
import { resolveWorkbenchStoragePaths } from "@/lib/server/storage/db-path";
import {
  WORKBENCH_SCHEMA_TABLES,
  WORKBENCH_SCHEMA_VERSION,
} from "@/lib/server/storage/sqlite-schema";

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

// WHY a second fixture: the seeded-DB scenario starts at the built-in latest
// version, so `migrateToLatest` filters out already-applied steps and only
// throws when a later step is pending. No-op prior steps keep
// `validateMigrationSequence`'s contiguous-from-1 rule satisfied.
const failingFollowupSchemaSteps: readonly WorkbenchMigration[] = [
  {
    version: 1,
    description: "no-op v1 (already applied on existing database)",
    up() {},
  },
  {
    version: 2,
    description: "no-op v2 (already applied on existing database)",
    up() {},
  },
  {
    version: 3,
    description: "intentionally failing follow-up step",
    up() {
      throw new Error("forced migration failure");
    },
  },
];

const okSchemaStep = (version: number): WorkbenchMigration => ({
  version,
  description: `ok schema step ${version}`,
  up() {},
});

describe("bootstrapWorkbenchStorage", () => {
  let root: string;
  let databaseFile: string;
  let artifactRoot: string;

  beforeEach(() => {
    root = path.join(tmpdir(), `ti-bootstrap-${randomUUID()}`);
    databaseFile = path.join(root, ".test-intelligence", "workbench.db");
    artifactRoot = path.join(
      root,
      ".test-intelligence",
      "storage-artifacts",
    );
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
    expect(adapter.getSchemaVersion()).toBe(WORKBENCH_SCHEMA_VERSION);
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
    expect(second.getSchemaVersion()).toBe(WORKBENCH_SCHEMA_VERSION);
    expect(second.runs.get(created.id, "tenant-a")).toStrictEqual(created);
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
    expect(survivor.runs.get(created.id, "t")).toStrictEqual(created);
    survivor.close();
  });

  it("surfaces an unsupported newer schema version without masking it", () => {
    const writer = bootstrapWorkbenchStorage({
      databaseFile,
      artifactRoot,
      schemaSteps: [okSchemaStep(1), okSchemaStep(2)],
    });
    expect(writer.getSchemaVersion()).toBe(2);
    writer.close();

    let thrown: unknown;
    try {
      bootstrapWorkbenchStorage({
        databaseFile,
        artifactRoot,
        schemaSteps: [okSchemaStep(1)],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(WorkbenchStorageError);
    expect((thrown as WorkbenchStorageError).code).toBe(
      "SCHEMA_VERSION_UNSUPPORTED",
    );
  });

  it("rejects one-sided manual path overrides", () => {
    expect(() => bootstrapWorkbenchStorage({ databaseFile })).toThrow(
      WorkbenchStorageError,
    );
    expect(() => bootstrapWorkbenchStorage({ artifactRoot })).toThrow(
      WorkbenchStorageError,
    );
    expect(() => bootstrapWorkbenchStorage({ artifactRoot })).toThrow(
      /databaseFile and artifactRoot/,
    );
  });

  it("rejects manual path overrides that split the Workbench data root", () => {
    expect(() =>
      bootstrapWorkbenchStorage({
        databaseFile: path.join(root, "db", "workbench.db"),
        artifactRoot: path.join(root, "storage-artifacts"),
      }),
    ).toThrow(WorkbenchStorageError);
  });

  it("normalizes manual path overrides before checking the shared data root", () => {
    const adapter = bootstrapWorkbenchStorage({
      databaseFile: path.join(root, ".test-intelligence", ".", "workbench.db"),
      artifactRoot: path.join(
        root,
        ".test-intelligence",
        "storage-artifacts",
        "..",
        "storage-artifacts",
      ),
    });
    adapter.close();
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
    const databaseFile = path.join(root, ".test-intelligence", "workbench.db");
    const artifactRoot = path.join(
      root,
      ".test-intelligence",
      "storage-artifacts",
    );
    const first = getWorkbenchStorage({ databaseFile, artifactRoot });
    const second = getWorkbenchStorage({ databaseFile, artifactRoot });
    expect(second).toBe(first);
  });

  it("exposes the resolved paths the singleton was bootstrapped with", () => {
    const databaseFile = path.join(root, ".test-intelligence", "workbench.db");
    const artifactRoot = path.join(
      root,
      ".test-intelligence",
      "storage-artifacts",
    );
    getWorkbenchStorage({ databaseFile, artifactRoot });
    expect(getWorkbenchStoragePaths({ databaseFile, artifactRoot })).toEqual({
      databaseFile,
      artifactRoot,
    });
  });
});

describe("getWorkbenchStoragePaths binds one root for content store + adapter", () => {
  const envFor = (repoRoot: string): NodeJS.ProcessEnv => ({
    NODE_ENV: "test",
    WORKBENCH_REPO_ROOT: repoRoot,
  });

  let firstRoot: string;
  let secondRoot: string;
  let previousRepoRoot: string | undefined;

  beforeEach(() => {
    firstRoot = path.join(tmpdir(), `ti-paths-first-${randomUUID()}`);
    secondRoot = path.join(tmpdir(), `ti-paths-second-${randomUUID()}`);
    previousRepoRoot = process.env.WORKBENCH_REPO_ROOT;
    resetWorkbenchStorageForTests();
  });

  afterEach(() => {
    resetWorkbenchStorageForTests();
    if (previousRepoRoot === undefined) {
      delete process.env.WORKBENCH_REPO_ROOT;
    } else {
      process.env.WORKBENCH_REPO_ROOT = previousRepoRoot;
    }
    rmSync(firstRoot, { recursive: true, force: true });
    rmSync(secondRoot, { recursive: true, force: true });
  });

  it("bootstraps on first call and returns the env-resolved paths", () => {
    const env = envFor(firstRoot);
    // Paths getter alone must bootstrap the singleton (no prior getWorkbenchStorage).
    const paths = getWorkbenchStoragePaths({ env });
    expect(paths).toEqual(resolveWorkbenchStoragePaths(env));
    expect(existsSync(paths.databaseFile)).toBe(true);
  });

  it("ignores a divergent env on a later call, matching the adapter's single bind", () => {
    const firstEnv = envFor(firstRoot);
    const firstAdapter = getWorkbenchStorage({ env: firstEnv });
    const boundPaths = getWorkbenchStoragePaths({ env: firstEnv });

    // A later call with a DIFFERENT root must return the SAME (first-bound) paths
    // and the SAME adapter, so artifact bytes and metadata rows never diverge.
    const secondEnv = envFor(secondRoot);
    expect(getWorkbenchStoragePaths({ env: secondEnv })).toEqual(boundPaths);
    expect(getWorkbenchStorage({ env: secondEnv })).toBe(firstAdapter);
    expect(boundPaths).toEqual(resolveWorkbenchStoragePaths(firstEnv));
    // The divergent second root was never even created.
    expect(existsSync(path.join(secondRoot, ".test-intelligence"))).toBe(false);
  });

  it("clears the cached paths on reset so a new root can bind", () => {
    const firstEnv = envFor(firstRoot);
    expect(getWorkbenchStoragePaths({ env: firstEnv })).toEqual(
      resolveWorkbenchStoragePaths(firstEnv),
    );

    resetWorkbenchStorageForTests();

    const secondEnv = envFor(secondRoot);
    expect(getWorkbenchStoragePaths({ env: secondEnv })).toEqual(
      resolveWorkbenchStoragePaths(secondEnv),
    );
  });
});
