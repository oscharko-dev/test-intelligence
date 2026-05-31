// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GeneratedTestCase } from "@oscharko-dev/ti-contracts";

import { artifactStorageRef, type ContentRef } from "@/lib/server/storage";
import {
  getWorkbenchStorage,
  resetWorkbenchStorageForTests,
} from "@/lib/server/storage/bootstrap";
import {
  ingestGeneratedTestCases,
  mapGeneratedToPersistedInitialVersion,
} from "@/lib/server/workbench-test-case-ingestion";

const contentRef = (suffix: string): ContentRef => {
  const sha = suffix.padStart(64, "0").slice(0, 64);
  return { sha256: sha, byteSize: 64, storageRef: artifactStorageRef(sha) };
};

const generatedFixture = (
  overrides: Record<string, unknown> = {},
): GeneratedTestCase => {
  // WHY a structural cast: a real GeneratedTestCase carries dozens of engine
  // fields not exercised by the persisted projection (qcMappingPreview,
  // confidence components, audit envelope, ...). The mapping under test only
  // reads the columns it persists, so a focused literal keeps the test signal
  // tight and avoids coupling the test to unrelated contract churn. Overrides
  // are loosely typed so individual cases can supply structural variants
  // without satisfying every contract-level literal constraint.
  const base = {
    id: "gen-tc-1",
    sourceJobId: "job-1",
    title: "Validate IBAN",
    objective: "Ensure IBAN is enforced",
    level: "system",
    type: "functional",
    priority: "p1",
    riskCategory: "regulated_data",
    technique: "boundary_value_analysis",
    preconditions: ["User signed in"],
    testData: ["DE89370400440532013000"],
    steps: [
      { index: 1, action: "Enter IBAN", expected: "Field accepts value" },
      { index: 2, action: "Submit", expected: "Form validates" },
    ],
    expectedResults: ["IBAN accepted"],
    figmaTraceRefs: [{ screenId: "s1", nodeId: "node-1" }],
    assumptions: [],
    openQuestions: [],
    ...overrides,
  };
  return base as unknown as GeneratedTestCase;
};

describe("mapGeneratedToPersistedInitialVersion", () => {
  it("projects the canonical fields onto the storage initial-version shape", () => {
    const projection = mapGeneratedToPersistedInitialVersion({
      generated: generatedFixture(),
      runRowId: "run-row-1",
      content: contentRef("a1"),
    });
    expect(projection.sourceTestCaseId).toBe("gen-tc-1");
    expect(projection.initialVersion.source).toBe("generated");
    expect(projection.initialVersion.title).toBe("Validate IBAN");
    expect(projection.initialVersion.priority).toBe("p1");
    expect(projection.initialVersion.risk).toBe("regulated_data");
    expect(projection.initialVersion.status).toBe("generated");
    expect(projection.initialVersion.steps).toStrictEqual([
      { action: "Enter IBAN", expected: "Field accepts value" },
      { action: "Submit", expected: "Form validates" },
    ]);
  });

  it("builds deterministic ordered tags from level/type/technique/polarity/category/regulatoryRelevance and dedupes", () => {
    const projection = mapGeneratedToPersistedInitialVersion({
      generated: generatedFixture({
        level: "acceptance",
        type: "functional",
        technique: "boundary_value_analysis",
        polarity: "negative",
        category: "validation_rule",
        regulatoryRelevance: { domain: "banking", rationale: "IBAN check" },
      }),
      runRowId: "run-row-1",
      content: contentRef("a1"),
    });
    expect(projection.initialVersion.tags).toStrictEqual([
      "acceptance",
      "functional",
      "boundary_value_analysis",
      "negative",
      "validation_rule",
      "banking",
    ]);
  });

  it("emits only the run trace target when no snapshot or figma refs are present", () => {
    const projection = mapGeneratedToPersistedInitialVersion({
      generated: generatedFixture({ figmaTraceRefs: [] }),
      runRowId: "run-row-1",
      content: contentRef("a1"),
    });
    expect(projection.initialVersion.traceTargets).toStrictEqual([
      { targetKind: "run", targetId: "run-row-1" },
    ]);
  });

  it("adds snapshot and figma-node trace targets when available, dedupes node ids", () => {
    const projection = mapGeneratedToPersistedInitialVersion({
      generated: generatedFixture({
        figmaTraceRefs: [
          { screenId: "s1", nodeId: "node-1" },
          { screenId: "s2", nodeId: "node-1" },
          { screenId: "s3", nodeId: "node-2" },
        ],
      }),
      runRowId: "run-row-1",
      snapshotId: "snap-9",
      content: contentRef("a1"),
    });
    expect(projection.initialVersion.traceTargets).toStrictEqual([
      { targetKind: "run", targetId: "run-row-1" },
      { targetKind: "snapshot", targetId: "snap-9" },
      { targetKind: "figma-node", targetId: "node-1" },
      { targetKind: "figma-node", targetId: "node-2" },
    ]);
  });

  it("omits description (no markdown source on a fresh generated case)", () => {
    const projection = mapGeneratedToPersistedInitialVersion({
      generated: generatedFixture(),
      runRowId: "run-row-1",
      content: contentRef("a1"),
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        projection.initialVersion,
        "description",
      ),
    ).toBe(false);
  });
});

describe("ingestGeneratedTestCases (in-memory adapter)", () => {
  let repoRoot: string;
  let previousRepoRoot: string | undefined;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), "ti-tc-ingest-"));
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

  const seedRunAndSeed = (
    seedBytes: Uint8Array,
  ): { rowId: string; tenantScope: string; generatedSeedId: string } => {
    const storage = getWorkbenchStorage({ env: env() });
    const run = storage.runs.create({
      tenantScope: "default/default/default",
      status: "sealed",
    });
    // The seed itself is just a content-addressed payload, so the bytes used
    // for the artifact and the bytes ingested are the same in this test.
    const seed = storage.generatedSeeds.create({
      runId: run.id,
      tenantScope: run.tenantScope,
      status: "ready",
      count: 1,
      content: {
        sha256: "0".repeat(64),
        byteSize: seedBytes.byteLength,
        storageRef: artifactStorageRef("0".repeat(64)),
      },
    });
    return {
      rowId: run.id,
      tenantScope: run.tenantScope,
      generatedSeedId: seed.id,
    };
  };

  it("persists each case once and reports the count", () => {
    const list = {
      schemaVersion: "1.0.0",
      jobId: "job-x",
      testCases: [
        generatedFixture({ id: "tc-1" }),
        generatedFixture({ id: "tc-2" }),
      ],
    };
    const seedBytes = new Uint8Array(Buffer.from(JSON.stringify(list), "utf8"));
    const ctx = seedRunAndSeed(seedBytes);

    const report = ingestGeneratedTestCases({
      env: env(),
      rowId: ctx.rowId,
      tenantScope: ctx.tenantScope,
      generatedSeedId: ctx.generatedSeedId,
      seedBytes,
    });
    expect(report.persistedCount).toBe(2);
    expect(report.skippedDuplicateCount).toBe(0);

    const cases = getWorkbenchStorage({ env: env() }).testCases.list({
      runId: ctx.rowId,
    });
    expect(cases).toHaveLength(2);
    const ids = cases.map((c) => c.sourceTestCaseId).sort();
    expect(ids).toStrictEqual(["tc-1", "tc-2"]);

    const detail = getWorkbenchStorage({ env: env() }).testCases.get(
      cases[0]!.id,
      ctx.tenantScope,
    );
    expect(
      detail?.currentVersion.traceLinks.length ?? 0,
    ).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent on a second ingestion of the same seed", () => {
    const list = {
      schemaVersion: "1.0.0",
      jobId: "job-x",
      testCases: [generatedFixture({ id: "tc-1" })],
    };
    const seedBytes = new Uint8Array(Buffer.from(JSON.stringify(list), "utf8"));
    const ctx = seedRunAndSeed(seedBytes);

    const first = ingestGeneratedTestCases({
      env: env(),
      rowId: ctx.rowId,
      tenantScope: ctx.tenantScope,
      generatedSeedId: ctx.generatedSeedId,
      seedBytes,
    });
    const second = ingestGeneratedTestCases({
      env: env(),
      rowId: ctx.rowId,
      tenantScope: ctx.tenantScope,
      generatedSeedId: ctx.generatedSeedId,
      seedBytes,
    });
    expect(first.persistedCount).toBe(1);
    expect(second.persistedCount).toBe(0);
    expect(second.skippedDuplicateCount).toBe(1);
    expect(
      getWorkbenchStorage({ env: env() }).testCases.list({ runId: ctx.rowId }),
    ).toHaveLength(1);
  });

  it("tolerates a bare array seed payload (legacy/mock-runner shape)", () => {
    const seedBytes = new Uint8Array(
      Buffer.from(JSON.stringify([generatedFixture({ id: "legacy" })]), "utf8"),
    );
    const ctx = seedRunAndSeed(seedBytes);
    const report = ingestGeneratedTestCases({
      env: env(),
      rowId: ctx.rowId,
      tenantScope: ctx.tenantScope,
      generatedSeedId: ctx.generatedSeedId,
      seedBytes,
    });
    expect(report.persistedCount).toBe(1);
  });

  it("returns an empty report when the JSON is neither a list nor an object with testCases", () => {
    const seedBytes = new Uint8Array(
      Buffer.from(JSON.stringify({ unrelated: true }), "utf8"),
    );
    const ctx = seedRunAndSeed(seedBytes);
    const report = ingestGeneratedTestCases({
      env: env(),
      rowId: ctx.rowId,
      tenantScope: ctx.tenantScope,
      generatedSeedId: ctx.generatedSeedId,
      seedBytes,
    });
    expect(report.persistedCount).toBe(0);
    expect(report.skippedDuplicateCount).toBe(0);
  });

  it("never throws when the seed bytes are not valid JSON", () => {
    const seedBytes = new Uint8Array(Buffer.from("not json", "utf8"));
    const ctx = seedRunAndSeed(seedBytes);
    const report = ingestGeneratedTestCases({
      env: env(),
      rowId: ctx.rowId,
      tenantScope: ctx.tenantScope,
      generatedSeedId: ctx.generatedSeedId,
      seedBytes,
    });
    expect(report.persistedCount).toBe(0);
  });

  it("skips malformed entries and persists the otherwise-valid ones in the same payload", () => {
    const malformed = [
      { id: "missing-title" },
      {
        id: "missing-steps",
        title: "T",
        objective: "O",
        preconditions: [],
        testData: [],
        figmaTraceRefs: [],
      },
      "not-an-object",
      null,
    ];
    const valid = generatedFixture({ id: "valid-1" });
    const seedBytes = new Uint8Array(
      Buffer.from(
        JSON.stringify({
          jobId: "j",
          schemaVersion: "x",
          testCases: [...malformed, valid],
        }),
        "utf8",
      ),
    );
    const ctx = seedRunAndSeed(seedBytes);
    const report = ingestGeneratedTestCases({
      env: env(),
      rowId: ctx.rowId,
      tenantScope: ctx.tenantScope,
      generatedSeedId: ctx.generatedSeedId,
      seedBytes,
    });
    expect(report.persistedCount).toBe(1);
    expect(report.skippedDuplicateCount).toBe(0);
    expect(
      getWorkbenchStorage({ env: env() }).testCases.list({ runId: ctx.rowId }),
    ).toHaveLength(1);
  });
});
