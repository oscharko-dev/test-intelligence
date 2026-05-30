// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getWorkbenchStorage,
  resetWorkbenchStorageForTests,
} from "@/lib/server/storage/bootstrap";
import {
  getScopeBasketForSnapshot,
  saveScopeBasketSelection,
} from "@/lib/server/workbench-scope-basket-store";
import {
  getWorkbenchRun,
  getWorkbenchRunCompletionForTests,
  resetWorkbenchRunStoreForTests,
  startWorkbenchRun,
} from "@/lib/server/workbench-run-registry";
import { prepareWorkbenchRun } from "@/lib/server/workbench-run-validation";
import type { ScopeSelection } from "@/lib/server/storage";

const SNAPSHOT_ID = "snapshot-basket-20260530";

const envFor = (
  repoRoot: string,
  tenantId = "tenant-alpha",
): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  WORKBENCH_REPO_ROOT: repoRoot,
  WORKBENCH_TENANT_ID: tenantId,
  WORKBENCH_RUNNER_MODE: "mock",
});

const selectionA: ScopeSelection = {
  nodeIds: ["mask-iban"],
  pageIds: ["page-accounts"],
  frameIds: [],
};

describe("Workbench scope-basket persistence (Issue #53, AC#3)", () => {
  let repoRoot: string;
  let previousRepoRoot: string | undefined;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), "ti-basket-persist-"));
    // The storage singleton bootstraps lazily from process.env, so pin the temp
    // root BEFORE any getWorkbenchStorage() so the adapter resolves this
    // throwaway data root and never the developer's real `.test-intelligence/`.
    previousRepoRoot = process.env.WORKBENCH_REPO_ROOT;
    process.env.WORKBENCH_REPO_ROOT = repoRoot;
    process.env.WORKBENCH_RUNNER_MODE = "mock";
    resetWorkbenchRunStoreForTests();
    resetWorkbenchStorageForTests();
  });

  afterEach(async () => {
    resetWorkbenchRunStoreForTests();
    resetWorkbenchStorageForTests();
    if (previousRepoRoot === undefined) {
      delete process.env.WORKBENCH_REPO_ROOT;
    } else {
      process.env.WORKBENCH_REPO_ROOT = previousRepoRoot;
    }
    delete process.env.WORKBENCH_RUNNER_MODE;
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("upserts a single basket per (tenant, snapshot) on repeated saves", () => {
    const env = envFor(repoRoot);
    const created = saveScopeBasketSelection(
      { snapshotId: SNAPSHOT_ID, label: "Initial", selection: selectionA },
      env,
    );
    expect(created.itemCount).toBe(2);

    const updatedSelection: ScopeSelection = {
      nodeIds: ["mask-iban", "mask-bic"],
      pageIds: ["page-accounts"],
      frameIds: ["frame-open-account"],
    };
    const updated = saveScopeBasketSelection(
      {
        snapshotId: SNAPSHOT_ID,
        label: "Updated",
        selection: updatedSelection,
      },
      env,
    );

    // Same row reused (no duplicate), and the new value/itemCount are reflected.
    expect(updated.id).toBe(created.id);
    expect(updated.itemCount).toBe(4);
    expect(updated.label).toBe("Updated");
    expect(updated.selection.frameIds).toEqual(["frame-open-account"]);
    const allForSnapshot = getWorkbenchStorage({ env }).scopeBaskets.list({
      snapshotId: SNAPSHOT_ID,
    });
    expect(allForSnapshot).toHaveLength(1);
  });

  it("returns the persisted selection after a storage restart (AC#3)", () => {
    const env = envFor(repoRoot);
    saveScopeBasketSelection(
      { snapshotId: SNAPSHOT_ID, label: "Scoped", selection: selectionA },
      env,
    );

    // Simulate a process restart: drop the in-memory singleton. The on-disk
    // SQLite file persists on the temp root and must be rebuilt from disk.
    resetWorkbenchStorageForTests();

    const restored = getScopeBasketForSnapshot(SNAPSHOT_ID, env);
    expect(restored).toBeDefined();
    expect(restored?.selection.nodeIds).toEqual(["mask-iban"]);
    expect(restored?.selection.pageIds).toEqual(["page-accounts"]);
    expect(restored?.selection.frameIds).toEqual([]);
    expect(restored?.itemCount).toBe(2);
  });

  it("drives a queued run from the restored selection (AC#3 can still generate)", async () => {
    const env = envFor(repoRoot);
    saveScopeBasketSelection(
      { snapshotId: SNAPSHOT_ID, label: "Scoped", selection: selectionA },
      env,
    );
    resetWorkbenchStorageForTests();

    const restored = getScopeBasketForSnapshot(SNAPSHOT_ID, env);
    if (restored === undefined) throw new Error("expected a restored basket");

    // The restored selection drives the real run-prepare input path and queues a
    // run, proving a basket that survived a restart can still start generation.
    const prepared = await prepareWorkbenchRun({
      body: {
        sourceMode: "snapshot",
        figmaUrl: "",
        snapshotId: SNAPSHOT_ID,
        snapshotSelection: {
          nodeIds: [...restored.selection.nodeIds],
          pageIds: [...restored.selection.pageIds],
          frameIds: [...restored.selection.frameIds],
        },
        customContext: "",
        autoJiraStory: false,
        outputDir: ".test-intelligence/basket-run",
        outputRunSubdir: "job-id",
        visualSidecar: false,
        allowPolicyBlocked: false,
        caCerts: "",
        jobIdOverride: "ti-basket-run-fixture",
      },
      env,
      now: new Date("2026-05-30T08:00:00.000Z"),
    });

    expect(prepared.config.sourceMode).toBe("snapshot");
    expect(prepared.config.snapshotSelection.nodeIds).toEqual(["mask-iban"]);

    const queued = startWorkbenchRun(prepared);
    expect(queued.status).toBe("queued");
    expect(getWorkbenchRun(prepared.jobId)?.config?.snapshotId).toBe(
      SNAPSHOT_ID,
    );
    // Let the mock run settle so no async work dangles past the test.
    await getWorkbenchRunCompletionForTests(prepared.jobId);
  });

  it("never returns a basket across tenants", () => {
    const tenantAEnv = envFor(repoRoot, "tenant-alpha");
    const tenantBEnv = envFor(repoRoot, "tenant-beta");
    saveScopeBasketSelection(
      { snapshotId: SNAPSHOT_ID, label: "Alpha only", selection: selectionA },
      tenantAEnv,
    );

    // Same shared SQLite store, different server-resolved tenant scope: tenant B
    // must not see tenant A's basket on read or on upsert reconciliation.
    expect(getScopeBasketForSnapshot(SNAPSHOT_ID, tenantBEnv)).toBeUndefined();
    expect(getScopeBasketForSnapshot(SNAPSHOT_ID, tenantAEnv)).toBeDefined();

    const tenantBBasket = saveScopeBasketSelection(
      {
        snapshotId: SNAPSHOT_ID,
        label: "Beta only",
        selection: { nodeIds: ["mask-beta"], pageIds: [], frameIds: [] },
      },
      tenantBEnv,
    );
    // Tenant B's save created a SECOND, separate row rather than overwriting A's.
    const all = getWorkbenchStorage().scopeBaskets.list({
      snapshotId: SNAPSHOT_ID,
    });
    expect(all).toHaveLength(2);
    expect(getScopeBasketForSnapshot(SNAPSHOT_ID, tenantAEnv)?.id).not.toBe(
      tenantBBasket.id,
    );
    expect(
      getScopeBasketForSnapshot(SNAPSHOT_ID, tenantAEnv)?.selection.nodeIds,
    ).toEqual(["mask-iban"]);
  });

  it("does not write to the real .test-intelligence root during tests", async () => {
    const env = envFor(repoRoot);
    saveScopeBasketSelection(
      { snapshotId: SNAPSHOT_ID, label: "Scoped", selection: selectionA },
      env,
    );
    const tempEntries = await readdir(
      path.join(repoRoot, ".test-intelligence"),
    );
    expect(tempEntries).toContain("workbench.db");
  });
});
