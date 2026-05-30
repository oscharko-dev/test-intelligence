/**
 * Reusable contract suite for any {@link WorkbenchStorageAdapter}
 * implementation. This file is not collected by Vitest directly (its name lacks
 * the `.test.` segment); a concrete `*.test.ts` imports
 * {@link runWorkbenchStorageAdapterContract} and binds it to a factory so every
 * implementation (the in-memory double now, the SQLite store later) is held to
 * the same behavioural contract.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { WorkbenchStorageError } from "@/lib/server/storage";
import type {
  ContentRef,
  CreateArtifactInput,
  CreateExportInput,
  CreateGeneratedSeedInput,
  CreateRunInput,
  CreateScopeBasketInput,
  CreateSnapshotInput,
  WorkbenchMigration,
  WorkbenchStorageAdapter,
} from "@/lib/server/storage";

type AdapterFactory = (options?: {
  migrations?: readonly WorkbenchMigration[];
}) => WorkbenchStorageAdapter;

const contentRef = (suffix: string): ContentRef => ({
  sha256: `${suffix.padStart(64, "0")}`.slice(0, 64),
  byteSize: 128,
  storageRef: `${suffix}/ab/${suffix}.bin`,
});

const snapshotInput = (
  overrides: Partial<CreateSnapshotInput> = {},
): CreateSnapshotInput => ({
  tenantScope: "tenant-a",
  source: "figma:file-key-1",
  nodeCount: 10,
  pageCount: 2,
  frameCount: 4,
  lifecycleState: "imported",
  ...overrides,
});

const runInput = (overrides: Partial<CreateRunInput> = {}): CreateRunInput => ({
  tenantScope: "tenant-a",
  status: "queued",
  ...overrides,
});

const artifactInput = (
  runId: string,
  overrides: Partial<CreateArtifactInput> = {},
): CreateArtifactInput => ({
  runId,
  tenantScope: "tenant-a",
  name: "report.md",
  kind: "markdown",
  content: contentRef("a1"),
  customerFacing: true,
  ...overrides,
});

const scopeBasketInput = (
  overrides: Partial<CreateScopeBasketInput> = {},
): CreateScopeBasketInput => ({
  tenantScope: "tenant-a",
  label: "Checkout flow",
  selection: { nodeIds: ["n1", "n2"], pageIds: ["p1"], frameIds: [] },
  itemCount: 3,
  ...overrides,
});

const generatedSeedInput = (
  runId: string,
  overrides: Partial<CreateGeneratedSeedInput> = {},
): CreateGeneratedSeedInput => ({
  runId,
  tenantScope: "tenant-a",
  status: "ready",
  count: 5,
  content: contentRef("b2"),
  ...overrides,
});

const exportInput = (
  runId: string,
  overrides: Partial<CreateExportInput> = {},
): CreateExportInput => ({
  runId,
  tenantScope: "tenant-a",
  format: "pdf",
  status: "ready",
  content: contentRef("c3"),
  ...overrides,
});

const migration = (
  version: number,
  up: WorkbenchMigration["up"] = () => {},
): WorkbenchMigration => ({
  version,
  description: `migration ${version}`,
  up,
});

export const runWorkbenchStorageAdapterContract = (
  label: string,
  makeAdapter: AdapterFactory,
): void => {
  describe(label, () => {
    let adapter: WorkbenchStorageAdapter;

    beforeEach(() => {
      adapter = makeAdapter();
    });

    describe("snapshots", () => {
      it("creates, reads, and lists records", () => {
        const created = adapter.snapshots.create(snapshotInput());
        expect(created.id).not.toHaveLength(0);
        expect(created.createdAt).not.toHaveLength(0);
        expect(created.nodeCount).toBe(10);
        expect(adapter.snapshots.get(created.id)).toStrictEqual(created);
        expect(adapter.snapshots.list()).toStrictEqual([created]);
      });

      it("returns undefined for a missing id and [] when empty", () => {
        expect(adapter.snapshots.get("absent")).toBeUndefined();
        expect(adapter.snapshots.list()).toStrictEqual([]);
      });

      it("updates lifecycle state and reports undefined for a missing id", () => {
        const created = adapter.snapshots.create(snapshotInput());
        const updated = adapter.snapshots.updateLifecycleState(
          created.id,
          "archived",
        );
        expect(updated?.lifecycleState).toBe("archived");
        expect(adapter.snapshots.get(created.id)?.lifecycleState).toBe(
          "archived",
        );
        expect(
          adapter.snapshots.updateLifecycleState("absent", "archived"),
        ).toBeUndefined();
      });

      it("filters by tenant scope", () => {
        adapter.snapshots.create(snapshotInput({ tenantScope: "tenant-a" }));
        adapter.snapshots.create(snapshotInput({ tenantScope: "tenant-b" }));
        const scoped = adapter.snapshots.list({ tenantScope: "tenant-b" });
        expect(scoped).toHaveLength(1);
        expect(scoped[0]?.tenantScope).toBe("tenant-b");
      });
    });

    describe("runs", () => {
      it("creates, reads, and lists records", () => {
        const created = adapter.runs.create(runInput({ label: "first" }));
        expect(created.status).toBe("queued");
        expect(created.createdAt).toBe(created.updatedAt);
        expect(adapter.runs.get(created.id)).toStrictEqual(created);
        expect(adapter.runs.list()).toStrictEqual([created]);
      });

      it("returns undefined for a missing id and [] when empty", () => {
        expect(adapter.runs.get("absent")).toBeUndefined();
        expect(adapter.runs.list()).toStrictEqual([]);
      });

      it("updates status and advances updatedAt", () => {
        const created = adapter.runs.create(runInput());
        const updated = adapter.runs.updateStatus(created.id, "sealed");
        expect(updated?.status).toBe("sealed");
        expect(updated?.createdAt).toBe(created.createdAt);
        expect(Date.parse(updated?.updatedAt ?? "")).toBeGreaterThanOrEqual(
          Date.parse(created.updatedAt),
        );
        expect(adapter.runs.updateStatus("absent", "failed")).toBeUndefined();
      });

      it("filters by tenant scope", () => {
        adapter.runs.create(runInput({ tenantScope: "tenant-a" }));
        adapter.runs.create(runInput({ tenantScope: "tenant-b" }));
        const scoped = adapter.runs.list({ tenantScope: "tenant-a" });
        expect(scoped).toHaveLength(1);
        expect(scoped[0]?.tenantScope).toBe("tenant-a");
      });
    });

    describe("artifacts", () => {
      it("creates, reads, and lists by run id", () => {
        const run = adapter.runs.create(runInput());
        const created = adapter.artifacts.create(artifactInput(run.id));
        expect(created.kind).toBe("markdown");
        expect(created.content.sha256).toHaveLength(64);
        expect(adapter.artifacts.get(created.id)).toStrictEqual(created);
        expect(adapter.artifacts.list({ runId: run.id })).toStrictEqual([
          created,
        ]);
      });

      it("returns undefined for a missing id and [] for an unknown run", () => {
        expect(adapter.artifacts.get("absent")).toBeUndefined();
        expect(adapter.artifacts.list({ runId: "absent" })).toStrictEqual([]);
      });

      it("scopes list results to the requested run id", () => {
        const runA = adapter.runs.create(runInput());
        const runB = adapter.runs.create(runInput());
        adapter.artifacts.create(artifactInput(runA.id, { name: "a.md" }));
        adapter.artifacts.create(artifactInput(runB.id, { name: "b.md" }));
        const listed = adapter.artifacts.list({ runId: runA.id });
        expect(listed).toHaveLength(1);
        expect(listed[0]?.name).toBe("a.md");
      });
    });

    describe("scope baskets", () => {
      it("creates, reads, and lists records", () => {
        const created = adapter.scopeBaskets.create(scopeBasketInput());
        expect(created.itemCount).toBe(3);
        expect(created.createdAt).toBe(created.updatedAt);
        expect(adapter.scopeBaskets.get(created.id)).toStrictEqual(created);
        expect(adapter.scopeBaskets.list()).toStrictEqual([created]);
      });

      it("returns undefined for a missing id and [] when empty", () => {
        expect(adapter.scopeBaskets.get("absent")).toBeUndefined();
        expect(adapter.scopeBaskets.list()).toStrictEqual([]);
      });

      it("updates label and selection and recomputes item count", () => {
        const created = adapter.scopeBaskets.create(scopeBasketInput());
        const updated = adapter.scopeBaskets.update(created.id, {
          label: "Renamed",
          selection: { nodeIds: ["n9"], pageIds: [], frameIds: ["f1"] },
        });
        expect(updated?.label).toBe("Renamed");
        expect(updated?.selection.nodeIds).toStrictEqual(["n9"]);
        expect(updated?.itemCount).toBe(2);
        expect(adapter.scopeBaskets.update("absent", {})).toBeUndefined();
      });

      it("filters by tenant scope and snapshot id", () => {
        const snap = adapter.snapshots.create(snapshotInput());
        adapter.scopeBaskets.create(
          scopeBasketInput({ tenantScope: "tenant-a", snapshotId: snap.id }),
        );
        adapter.scopeBaskets.create(
          scopeBasketInput({ tenantScope: "tenant-b" }),
        );
        expect(adapter.scopeBaskets.list({ snapshotId: snap.id })).toHaveLength(
          1,
        );
        expect(
          adapter.scopeBaskets.list({ tenantScope: "tenant-b" }),
        ).toHaveLength(1);
      });
    });

    describe("generated seeds", () => {
      it("creates, reads, and lists by run id", () => {
        const run = adapter.runs.create(runInput());
        const created = adapter.generatedSeeds.create(
          generatedSeedInput(run.id),
        );
        expect(created.count).toBe(5);
        expect(adapter.generatedSeeds.get(created.id)).toStrictEqual(created);
        expect(adapter.generatedSeeds.list({ runId: run.id })).toStrictEqual([
          created,
        ]);
      });

      it("returns undefined for a missing id and [] for an unknown run", () => {
        expect(adapter.generatedSeeds.get("absent")).toBeUndefined();
        expect(adapter.generatedSeeds.list({ runId: "absent" })).toStrictEqual(
          [],
        );
      });
    });

    describe("exports", () => {
      it("creates, reads, and lists by run id", () => {
        const run = adapter.runs.create(runInput());
        const created = adapter.exports.create(exportInput(run.id));
        expect(created.format).toBe("pdf");
        expect(adapter.exports.get(created.id)).toStrictEqual(created);
        expect(adapter.exports.list({ runId: run.id })).toStrictEqual([
          created,
        ]);
      });

      it("returns undefined for a missing id and [] for an unknown run", () => {
        expect(adapter.exports.get("absent")).toBeUndefined();
        expect(adapter.exports.list({ runId: "absent" })).toStrictEqual([]);
      });
    });

    describe("returned records are immutable snapshots", () => {
      it("does not let a mutated returned snapshot affect storage", () => {
        const created = adapter.snapshots.create(snapshotInput());
        (created as { lifecycleState: string }).lifecycleState = "tampered";
        expect(adapter.snapshots.get(created.id)?.lifecycleState).toBe(
          "imported",
        );
      });

      it("does not let a mutated nested selection affect storage", () => {
        const created = adapter.scopeBaskets.create(scopeBasketInput());
        (created.selection.nodeIds as string[]).push("injected");
        expect(
          adapter.scopeBaskets.get(created.id)?.selection.nodeIds,
        ).toStrictEqual(["n1", "n2"]);
      });

      it("does not let a mutated listed record affect storage", () => {
        const created = adapter.runs.create(runInput());
        const [listed] = adapter.runs.list();
        (listed as { status: string }).status = "tampered";
        expect(adapter.runs.get(created.id)?.status).toBe("queued");
      });
    });

    describe("transactions", () => {
      it("commits writes performed inside the transaction", () => {
        const created = adapter.transaction((tx) =>
          tx.runs.create(runInput({ label: "tx" })),
        );
        expect(adapter.runs.get(created.id)?.label).toBe("tx");
      });

      it("supports read-your-writes inside a transaction", () => {
        adapter.transaction((tx) => {
          const run = tx.runs.create(runInput());
          expect(tx.runs.get(run.id)?.id).toBe(run.id);
          expect(tx.runs.list()).toHaveLength(1);
        });
      });

      it("rolls back every change when the work throws", () => {
        const seed = adapter.runs.create(runInput({ label: "kept" }));
        expect(() =>
          adapter.transaction((tx) => {
            tx.runs.create(runInput({ label: "discarded" }));
            tx.snapshots.create(snapshotInput());
            throw new Error("boom");
          }),
        ).toThrow("boom");
        expect(adapter.runs.list()).toHaveLength(1);
        expect(adapter.runs.get(seed.id)?.label).toBe("kept");
        expect(adapter.snapshots.list()).toStrictEqual([]);
      });

      it("rolls back updates to pre-existing records", () => {
        const run = adapter.runs.create(runInput());
        expect(() =>
          adapter.transaction((tx) => {
            tx.runs.updateStatus(run.id, "sealed");
            throw new Error("rollback");
          }),
        ).toThrow("rollback");
        expect(adapter.runs.get(run.id)?.status).toBe("queued");
      });

      it("throws a NESTED_TRANSACTION error when nested", () => {
        expect(() =>
          adapter.transaction((tx) => {
            tx.transaction(() => undefined);
          }),
        ).toThrow(WorkbenchStorageError);
        try {
          adapter.transaction((tx) => {
            tx.transaction(() => undefined);
          });
        } catch (error) {
          expect(error).toBeInstanceOf(WorkbenchStorageError);
          expect((error as WorkbenchStorageError).code).toBe(
            "NESTED_TRANSACTION",
          );
        }
      });

      it("allows a new transaction after a prior one rolled back", () => {
        expect(() =>
          adapter.transaction(() => {
            throw new Error("first");
          }),
        ).toThrow("first");
        const created = adapter.transaction((tx) => tx.runs.create(runInput()));
        expect(adapter.runs.get(created.id)).toBeDefined();
      });
    });

    describe("migrations", () => {
      it("applies pending migrations and reports the latest version", () => {
        const migrated = makeAdapter({
          migrations: [migration(1), migration(2)],
        });
        expect(migrated.getSchemaVersion()).toBe(0);
        expect(migrated.migrateToLatest()).toBe(2);
        expect(migrated.getSchemaVersion()).toBe(2);
      });

      it("is idempotent on re-run", () => {
        const migrated = makeAdapter({
          migrations: [migration(1), migration(2)],
        });
        expect(migrated.migrateToLatest()).toBe(2);
        expect(migrated.migrateToLatest()).toBe(2);
        expect(migrated.getSchemaVersion()).toBe(2);
      });

      it("stays at version 0 with no migrations", () => {
        const migrated = makeAdapter({ migrations: [] });
        expect(migrated.migrateToLatest()).toBe(0);
      });

      it("rejects a gap in the sequence", () => {
        const migrated = makeAdapter({
          migrations: [migration(1), migration(3)],
        });
        expect(() => migrated.migrateToLatest()).toThrow(WorkbenchStorageError);
      });

      it("rejects duplicate versions", () => {
        const migrated = makeAdapter({
          migrations: [migration(1), migration(1)],
        });
        expect(() => migrated.migrateToLatest()).toThrow(/contiguous from 1/u);
      });

      it("rejects a version below 1", () => {
        const migrated = makeAdapter({ migrations: [migration(0)] });
        expect(() => migrated.migrateToLatest()).toThrow(WorkbenchStorageError);
      });

      it("rejects descending versions", () => {
        const migrated = makeAdapter({
          migrations: [migration(2), migration(1)],
        });
        expect(() => migrated.migrateToLatest()).toThrow(WorkbenchStorageError);
      });

      it("runs each migration step against the adapter", () => {
        const seen: number[] = [];
        const migrated = makeAdapter({
          migrations: [
            migration(1, () => seen.push(1)),
            migration(2, () => seen.push(2)),
          ],
        });
        migrated.migrateToLatest();
        expect(seen).toStrictEqual([1, 2]);
      });

      it("rolls the schema version back when a migration step throws", () => {
        const migrated = makeAdapter({
          migrations: [
            migration(1),
            migration(2, () => {
              throw new Error("migration boom");
            }),
          ],
        });
        expect(() => migrated.migrateToLatest()).toThrow("migration boom");
        expect(migrated.getSchemaVersion()).toBe(0);
      });
    });
  });
};
