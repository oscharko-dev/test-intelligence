// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  artifactAbsolutePath,
  resolveWorkbenchStoragePaths,
} from "@/lib/server/storage";
import {
  getWorkbenchStorage,
  resetWorkbenchStorageForTests,
} from "@/lib/server/storage/bootstrap";
import {
  getWorkbenchRunCompletionForTests,
  getWorkbenchRunForClient,
  resetWorkbenchRunStoreForTests,
  startWorkbenchRun,
} from "@/lib/server/workbench-run-registry";
import {
  persistSealedRunArtifacts,
  verifyRunArtifacts,
} from "@/lib/server/workbench-run-persistence";
import { prepareWorkbenchRun } from "@/lib/server/workbench-run-validation";

const SNAPSHOT_ID = "snapshot-persist-20260530";

const snapshotRunBody = {
  sourceMode: "snapshot" as const,
  figmaUrl: "",
  snapshotId: SNAPSHOT_ID,
  snapshotSelection: { nodeIds: ["mask-iban"], pageIds: [], frameIds: [] },
  customContext: "",
  autoJiraStory: false,
  outputDir: ".test-intelligence/run-persist",
  outputRunSubdir: "job-id" as const,
  visualSidecar: false,
  allowPolicyBlocked: false,
  caCerts: "",
  jobIdOverride: "ti-run-persist-fixture",
};

const envFor = (repoRoot: string): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  WORKBENCH_REPO_ROOT: repoRoot,
  WORKBENCH_RUNNER_MODE: "mock",
});

const startSealedRun = async (
  env: NodeJS.ProcessEnv,
): Promise<{ jobId: string }> => {
  const prepared = await prepareWorkbenchRun({
    body: snapshotRunBody,
    env,
    now: new Date("2026-05-30T08:00:00.000Z"),
  });
  startWorkbenchRun(prepared);
  await getWorkbenchRunCompletionForTests(prepared.jobId);
  const run = getWorkbenchRunForClient(prepared.jobId, env);
  expect(run?.status, run?.errorMessage).toBe("sealed");
  return { jobId: prepared.jobId };
};

describe("Workbench run persistence (Issue #53)", () => {
  let repoRoot: string;
  let previousRepoRoot: string | undefined;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), "ti-run-persist-"));
    // The storage singleton bootstraps lazily from process.env, so pin the
    // temp root BEFORE any getWorkbenchStorage() so the adapter, content store,
    // and state-doc paths all agree on this throwaway data root.
    previousRepoRoot = process.env.WORKBENCH_REPO_ROOT;
    process.env.WORKBENCH_REPO_ROOT = repoRoot;
    // executeRun reads WORKBENCH_RUNNER_MODE from process.env directly, so the
    // mock runner must be selected there (not only in the passed env object).
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

  it("records a runs row, artifact metadata, and customer exports on seal", async () => {
    const env = envFor(repoRoot);
    const { jobId } = await startSealedRun(env);

    const runs = getWorkbenchStorage().runs.list();
    expect(runs).toHaveLength(1);
    const row = runs[0];
    expect(row?.status).toBe("sealed");
    expect(row?.snapshotId).toBe(SNAPSHOT_ID);
    if (row === undefined) throw new Error("expected a persisted runs row");

    const artifacts = getWorkbenchStorage().artifacts.list({ runId: row.id });
    // Mock seal produces the 10 default JSON artifacts plus customer md/pdf/txt.
    expect(artifacts.length).toBeGreaterThan(10);
    const byName = new Map(artifacts.map((a) => [a.name, a]));
    const combinedMd = byName.get("customer-markdown/testfaelle.md");
    expect(combinedMd?.kind).toBe("markdown");
    expect(combinedMd?.customerFacing).toBe(true);
    expect(byName.get("coverage-plan.json")?.kind).toBe("json");
    expect(byName.get("coverage-plan.json")?.customerFacing).toBe(false);

    const exports = getWorkbenchStorage().exports.list({ runId: row.id });
    const formats = exports.map((e) => e.format).sort();
    // Customer markdown (combined + 2 per-case) and pdf become exports; the
    // customer .txt files map to no export format and stay artifacts only.
    expect(formats).toEqual([
      "markdown",
      "markdown",
      "markdown",
      "pdf",
      "pdf",
      "pdf",
    ]);

    // Every recorded artifact reference verifies against the content store.
    const report = verifyRunArtifacts(env, row.id);
    expect(report.length).toBe(artifacts.length);
    expect(report.every((entry) => entry.present && entry.checksumValid)).toBe(
      true,
    );
    expect(jobId).toBe("ti-run-persist-fixture");
  });

  it("rehydrates status, progress, artifact metadata, and snapshotId after a restart (AC#2)", async () => {
    const env = envFor(repoRoot);
    const { jobId } = await startSealedRun(env);
    const before = getWorkbenchRunForClient(jobId, env);
    expect(before?.stages.generator.outcome).toBe("clean");

    // Restart: drop both in-memory singletons. The SQLite DB, content store,
    // and run-state document persist on the temp root and must be rebuilt.
    resetWorkbenchRunStoreForTests();
    resetWorkbenchStorageForTests();

    const restored = getWorkbenchRunForClient(jobId, env);
    expect(restored).toBeDefined();
    expect(restored?.status).toBe("sealed");
    // Progress summary / stages survive the rebuild from disk.
    expect(restored?.stages).toEqual(before?.stages);
    expect(restored?.config?.snapshotId).toBe(SNAPSHOT_ID);
    // Artifact metadata is preserved in the run-state document.
    expect(
      restored?.artifacts.some(
        (a) => a.name === "customer-markdown/testfaelle.md",
      ),
    ).toBe(true);
    // Source reference (snapshotId) survives on the durable runs row too.
    const rehydratedRow = getWorkbenchStorage().runs.list()[0];
    expect(rehydratedRow?.snapshotId).toBe(SNAPSHOT_ID);
    expect(rehydratedRow?.status).toBe("sealed");
    // Server-only paths never leak to the client projection after rehydration.
    expect(restored?.artifactDir).toBeUndefined();
    expect(restored?.outputRoot).toBeUndefined();
  });

  it("rebuilds the SQLite artifacts-table rows from disk after a restart (AC#4)", async () => {
    const env = envFor(repoRoot);
    await startSealedRun(env);

    const rowBefore = getWorkbenchStorage().runs.list()[0];
    if (rowBefore === undefined) throw new Error("expected a persisted row");
    const artifactsBefore = getWorkbenchStorage()
      .artifacts.list({ runId: rowBefore.id })
      .map((a) => ({
        name: a.name,
        kind: a.kind,
        sha256: a.content.sha256,
        customerFacing: a.customerFacing,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(artifactsBefore.length).toBeGreaterThan(10);

    // Restart: drop the storage singleton so the next read rebuilds the
    // adapter from the on-disk SQLite file, not from memory.
    resetWorkbenchStorageForTests();

    const rowAfter = getWorkbenchStorage({ env }).runs.list()[0];
    if (rowAfter === undefined)
      throw new Error("expected the runs row to survive the restart");
    const artifactsAfter = getWorkbenchStorage()
      .artifacts.list({ runId: rowAfter.id })
      .map((a) => ({
        name: a.name,
        kind: a.kind,
        sha256: a.content.sha256,
        customerFacing: a.customerFacing,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // The artifacts-table rows are durable: same id keys the same set, and the
    // full metadata (name, kind, content hash, customer-facing flag) round-trips.
    expect(rowAfter.id).toBe(rowBefore.id);
    expect(artifactsAfter).toEqual(artifactsBefore);
  });

  it("reports a deleted artifact as missing without throwing (AC#4)", async () => {
    const env = envFor(repoRoot);
    await startSealedRun(env);
    const row = getWorkbenchStorage().runs.list()[0];
    if (row === undefined) throw new Error("expected a persisted runs row");

    const artifacts = getWorkbenchStorage().artifacts.list({ runId: row.id });
    const target = artifacts.find(
      (a) => a.name === "customer-markdown/testfaelle.md",
    );
    if (target === undefined) throw new Error("expected the markdown artifact");

    const paths = resolveWorkbenchStoragePaths(env);
    await rm(artifactAbsolutePath(paths, target.content.sha256), {
      force: true,
    });

    // verifyRunArtifacts must report the gap explicitly and never throw.
    const report = verifyRunArtifacts(env, row.id);
    const reported = report.find((entry) => entry.name === target.name);
    expect(reported).toBeDefined();
    expect(reported?.present).toBe(false);
    expect(reported?.checksumValid).toBe(false);
    // The other artifacts remain present and valid.
    expect(
      report.filter((entry) => entry.name !== target.name).length,
    ).toBeGreaterThan(0);
    expect(
      report
        .filter((entry) => entry.name !== target.name)
        .every((entry) => entry.present && entry.checksumValid),
    ).toBe(true);
  });

  it("records generated-seed metadata with the parsed test-case count", () => {
    const env = envFor(repoRoot);
    const row = getWorkbenchStorage({ env }).runs.create({
      tenantScope: "default/default/default",
      status: "sealed",
      artifactDir: repoRoot,
    });
    const seedDir = path.join(repoRoot, "seed-fixture");
    const seedPath = path.join(seedDir, "generated-testcases.json");
    // Three generated test cases: the array length is the recorded count.
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(
      seedPath,
      JSON.stringify([{ id: "tc-1" }, { id: "tc-2" }, { id: "tc-3" }]),
      "utf8",
    );

    persistSealedRunArtifacts({
      rowId: row.id,
      repoRoot,
      tenantScope: "default/default/default",
      artifactDir: seedDir,
      status: "sealed",
      artifactPaths: [seedPath],
      customerFacingPaths: new Set<string>(),
    });

    const seeds = getWorkbenchStorage({ env }).generatedSeeds.list({
      runId: row.id,
    });
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.count).toBe(3);
    expect(seeds[0]?.status).toBe("sealed");
    // The seed file is also recorded as a json artifact.
    const artifacts = getWorkbenchStorage({ env }).artifacts.list({
      runId: row.id,
    });
    expect(artifacts.some((a) => a.name === "generated-testcases.json")).toBe(
      true,
    );
  });

  it("serves a completed run normally even when persistence cannot write (isolation)", async () => {
    // Break ONLY the storage layer, not the run's output dir: pre-create the
    // SQLite database path as a directory so every bootstrap/open fails. The
    // run still writes its artifacts under the (writable) output dir, so a
    // storage failure must be swallowed and leave the run + response intact.
    const paths = resolveWorkbenchStoragePaths(envFor(repoRoot));
    mkdirSync(paths.databaseFile, { recursive: true });
    const env = envFor(repoRoot);

    const prepared = await prepareWorkbenchRun({
      body: snapshotRunBody,
      env,
      now: new Date("2026-05-30T08:00:00.000Z"),
    });
    startWorkbenchRun(prepared);
    await getWorkbenchRunCompletionForTests(prepared.jobId);

    const run = getWorkbenchRunForClient(prepared.jobId, env);
    expect(run?.status, run?.errorMessage).toBe("sealed");
    expect(
      run?.customerMarkdown?.some(
        (file) => file.path === "customer-markdown/testfaelle.md",
      ),
    ).toBe(true);

    // Recover by removing the blocker and reopening: no runs row was written,
    // proving the failed storage writes were swallowed, not silently redirected.
    resetWorkbenchStorageForTests();
    await rm(paths.databaseFile, { recursive: true, force: true });
    expect(getWorkbenchStorage({ env }).runs.list()).toEqual([]);
  });

  it("does not write to the real .test-intelligence root during tests", async () => {
    const env = envFor(repoRoot);
    await startSealedRun(env);
    // Everything persisted under the temp root, not the developer's repo root.
    const tempEntries = await readdir(
      path.join(repoRoot, ".test-intelligence"),
    );
    expect(tempEntries).toContain("workbench.db");
    expect(tempEntries).toContain("storage-artifacts");
    // The run-state documents live beside the DB under the data root, never in
    // the operator's output directory.
    expect(tempEntries).toContain("run-state");
  });

  it("writes the run-state document under the server-controlled run-state root, not inside artifactDir", async () => {
    const env = envFor(repoRoot);
    await startSealedRun(env);

    const row = getWorkbenchStorage().runs.list()[0];
    if (row === undefined) throw new Error("expected a persisted runs row");
    if (row.artifactDir === undefined) {
      throw new Error("expected the persisted row to carry an artifactDir");
    }

    // The document is keyed by the server-minted rowId under the data root.
    const runStateRoot = path.join(repoRoot, ".test-intelligence", "run-state");
    const runStateEntries = await readdir(runStateRoot);
    expect(runStateEntries).toContain(`${row.id}.json`);

    // Nothing was written into the (possibly hostile) artifactDir: neither the
    // rowId-keyed document nor the legacy `<artifactDir>/workbench-run-state.json`.
    const artifactEntries = await readdir(row.artifactDir);
    expect(artifactEntries).not.toContain(`${row.id}.json`);
    expect(artifactEntries).not.toContain("workbench-run-state.json");
    await expect(
      stat(path.join(row.artifactDir, "workbench-run-state.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
