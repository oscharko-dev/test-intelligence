// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GeneratedTestCase } from "@oscharko-dev/ti-contracts";

import {
  getWorkbenchStorage,
  resetWorkbenchStorageForTests,
} from "@/lib/server/storage/bootstrap";
import { persistSealedRunArtifacts } from "@/lib/server/workbench-run-persistence";

const generatedFixture = (id: string): GeneratedTestCase => {
  // WHY a structural cast: the persisted projection only reads a focused subset
  // of fields; the rest of the contract surface is irrelevant to this test.
  return {
    id,
    sourceJobId: "job-x",
    title: `Case ${id}`,
    objective: "Persist canonical record",
    level: "L1",
    type: "functional",
    priority: "P1",
    riskCategory: "regulatory",
    technique: "boundary-value",
    preconditions: ["precondition-a"],
    testData: ["sample"],
    steps: [{ index: 1, action: "step", expected: "expected" }],
    expectedResults: ["expected"],
    figmaTraceRefs: [{ screenId: "s1", nodeId: `node-${id}` }],
    assumptions: [],
    openQuestions: [],
  } as unknown as GeneratedTestCase;
};

describe("Workbench test case ingestion at seal (Issue #56)", () => {
  let repoRoot: string;
  let previousRepoRoot: string | undefined;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), "ti-tc-seal-"));
    previousRepoRoot = process.env.WORKBENCH_REPO_ROOT;
    process.env.WORKBENCH_REPO_ROOT = repoRoot;
    resetWorkbenchStorageForTests();
  });

  afterEach(async () => {
    resetWorkbenchStorageForTests();
    if (previousRepoRoot === undefined) {
      delete process.env.WORKBENCH_REPO_ROOT;
    } else {
      process.env.WORKBENCH_REPO_ROOT = previousRepoRoot;
    }
    await rm(repoRoot, { recursive: true, force: true });
  });

  const env = (): NodeJS.ProcessEnv => ({
    NODE_ENV: "test",
    WORKBENCH_REPO_ROOT: repoRoot,
  });

  const sealRunWithFixtureSeed = (): {
    rowId: string;
    tenantScope: string;
    seedDir: string;
  } => {
    const storage = getWorkbenchStorage({ env: env() });
    const run = storage.runs.create({
      tenantScope: "default/default/default",
      status: "sealed",
    });
    const seedDir = path.join(repoRoot, "seal-fixture");
    const seedPath = path.join(seedDir, "generated-testcases.json");
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(
      seedPath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        jobId: "job-x",
        testCases: [generatedFixture("tc-1"), generatedFixture("tc-2")],
      }),
      "utf8",
    );
    persistSealedRunArtifacts({
      rowId: run.id,
      repoRoot,
      tenantScope: run.tenantScope,
      artifactDir: seedDir,
      status: "sealed",
      artifactPaths: [seedPath],
      customerFacingPaths: new Set<string>(),
    });
    return { rowId: run.id, tenantScope: run.tenantScope, seedDir };
  };

  it("persists canonical test cases when the seal hook ingests the generated seed", () => {
    const ctx = sealRunWithFixtureSeed();
    const cases = getWorkbenchStorage({ env: env() }).testCases.list({
      runId: ctx.rowId,
    });
    expect(cases).toHaveLength(2);
    expect(cases.every((c) => c.sourceRunId === ctx.rowId)).toBe(true);

    const detail = getWorkbenchStorage({ env: env() }).testCases.get(
      cases[0]!.id,
      ctx.tenantScope,
    );
    expect(detail).toBeDefined();
    expect(detail?.currentVersion.traceLinks.length).toBeGreaterThanOrEqual(1);
    // AC#2: at least one trace link must reference durable run evidence.
    expect(
      detail?.currentVersion.traceLinks.some((l) => l.targetKind === "run"),
    ).toBe(true);
  });

  it("preserves persisted cases and their current version pointers after restart (AC#4)", () => {
    const ctx = sealRunWithFixtureSeed();
    const before = getWorkbenchStorage({ env: env() })
      .testCases.list({ runId: ctx.rowId })
      .map((c) => ({
        id: c.id,
        currentVersionId: c.currentVersionId,
        sourceTestCaseId: c.sourceTestCaseId,
      }))
      .sort((a, b) => a.sourceTestCaseId.localeCompare(b.sourceTestCaseId));
    expect(before.length).toBe(2);

    // Close the storage singleton — simulate a process restart. The SQLite
    // database and the content store remain on disk under the temp root.
    resetWorkbenchStorageForTests();

    const after = getWorkbenchStorage({ env: env() })
      .testCases.list({ runId: ctx.rowId })
      .map((c) => ({
        id: c.id,
        currentVersionId: c.currentVersionId,
        sourceTestCaseId: c.sourceTestCaseId,
      }))
      .sort((a, b) => a.sourceTestCaseId.localeCompare(b.sourceTestCaseId));
    expect(after).toStrictEqual(before);

    // Each persisted case still loads its current version detail end-to-end.
    for (const summary of after) {
      const detail = getWorkbenchStorage({ env: env() }).testCases.get(
        summary.id,
        ctx.tenantScope,
      );
      expect(detail?.currentVersion.id).toBe(summary.currentVersionId);
      expect(detail?.currentVersion.versionIndex).toBe(1);
    }
  });

  it("re-running the seal hook is idempotent (no duplicate persisted cases)", () => {
    const ctx = sealRunWithFixtureSeed();
    // The seed file was deleted from disk only conceptually; in practice the
    // same fixture is still on disk for a real re-seal, so just trigger the
    // same persistSealedRunArtifacts call again and confirm idempotency.
    persistSealedRunArtifacts({
      rowId: ctx.rowId,
      repoRoot,
      tenantScope: ctx.tenantScope,
      artifactDir: ctx.seedDir,
      status: "sealed",
      artifactPaths: [path.join(ctx.seedDir, "generated-testcases.json")],
      customerFacingPaths: new Set<string>(),
    });
    const cases = getWorkbenchStorage({ env: env() }).testCases.list({
      runId: ctx.rowId,
    });
    expect(cases).toHaveLength(2);
  });
});
