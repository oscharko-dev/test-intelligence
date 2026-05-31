// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET as listVersions,
  POST as appendVersion,
} from "@/app/api/workbench/test-cases/[caseId]/versions/route";
import { artifactStorageRef } from "@/lib/server/storage";
import {
  getWorkbenchStorage,
  resetWorkbenchStorageForTests,
} from "@/lib/server/storage/bootstrap";
import {
  formatWorkbenchTenantScope,
  resolveWorkbenchTenantScope,
} from "@/lib/server/workbench-tenant-scope";

const SHA = "1".repeat(64);
const CONTENT_REF = {
  sha256: SHA,
  byteSize: 32,
  storageRef: artifactStorageRef(SHA),
};

interface SeedResult {
  readonly caseId: string;
  readonly runId: string;
  readonly tenantScope: string;
}

const seedCase = (
  args: {
    readonly sourceTestCaseId?: string;
    readonly status?: "draft" | "reviewed" | "approved";
  } = {},
): SeedResult => {
  const tenantScope = formatWorkbenchTenantScope(
    resolveWorkbenchTenantScope(process.env),
  );
  const storage = getWorkbenchStorage({ env: process.env });
  const run = storage.runs.create({ tenantScope, status: "sealed" });
  const seed = storage.generatedSeeds.create({
    runId: run.id,
    tenantScope,
    status: "ready",
    count: 1,
    content: CONTENT_REF,
  });
  const detail = storage.testCases.create({
    tenantScope,
    sourceRunId: run.id,
    sourceGeneratedSeedId: seed.id,
    sourceTestCaseId: args.sourceTestCaseId ?? "src-tc",
    status: args.status ?? "draft",
    initialVersion: {
      source: "generated",
      title: "Seed",
      objective: "x",
      preconditions: [],
      steps: [{ action: "go", expected: "ok" }],
      testData: [],
      priority: "P1",
      risk: "low",
      tags: [],
      status: "generated",
      content: CONTENT_REF,
      traceTargets: [{ targetKind: "run", targetId: run.id }],
    },
  });
  return { caseId: detail.testCase.id, runId: run.id, tenantScope };
};

const postJson = (caseId: string, body: unknown): Promise<Response> =>
  appendVersion(
    new Request(
      `http://localhost/api/workbench/test-cases/${caseId}/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ caseId }) },
  );

const getJson = (caseId: string): Promise<Response> =>
  listVersions(new Request("http://localhost"), {
    params: Promise.resolve({ caseId }),
  });

interface DetailResponse {
  readonly detail: {
    readonly testCase: {
      readonly id: string;
      readonly currentVersionId: string;
    };
    readonly currentVersion: {
      readonly versionIndex: number;
      readonly source: string;
      readonly title: string;
    };
  };
  readonly warnings: ReadonlyArray<{
    readonly kind: string;
    readonly targetId: string;
  }>;
}

interface ValidationErrorResponse {
  readonly errors: ReadonlyArray<{
    readonly field: string;
    readonly code: string;
  }>;
}

interface VersionsResponse {
  readonly versions: ReadonlyArray<{ readonly versionIndex: number }>;
}

const validVersionBody = (runId: string): Record<string, unknown> => ({
  title: "Manual v2",
  objective: "Improved",
  preconditions: [],
  steps: [{ action: "Updated step", expected: "Updated outcome" }],
  testData: [],
  priority: "P1",
  risk: "low",
  tags: [],
  status: "draft",
  traceTargets: [{ targetKind: "run", targetId: runId }],
  changeReason: "Operator polish",
});

describe("Workbench test case versions API", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), "ti-tc-versions-"));
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    resetWorkbenchStorageForTests();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetWorkbenchStorageForTests();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("POST appends a new manual version and returns detail + warnings", async () => {
    const { caseId, runId } = seedCase();
    const response = await postJson(caseId, validVersionBody(runId));
    expect(response.status).toBe(200);
    const body = (await response.json()) as DetailResponse;
    expect(body.detail.currentVersion.versionIndex).toBe(2);
    expect(body.detail.currentVersion.source).toBe("manual");
    expect(body.detail.currentVersion.title).toBe("Manual v2");
    expect(body.warnings).toStrictEqual([]);
  });

  it("POST returns 422 with structured errors on validation failure", async () => {
    const { caseId, runId } = seedCase();
    const response = await postJson(caseId, {
      ...validVersionBody(runId),
      title: "   ",
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as ValidationErrorResponse;
    expect(body.errors.some((e) => e.code === "TITLE_REQUIRED")).toBe(true);
  });

  it("POST returns 404 for an unknown caseId", async () => {
    const response = await postJson("absent", validVersionBody("run-x"));
    expect(response.status).toBe(404);
  });

  it("POST surfaces a plausibility warning for a missing snapshot target", async () => {
    const { caseId, runId } = seedCase();
    const response = await postJson(caseId, {
      ...validVersionBody(runId),
      traceTargets: [
        { targetKind: "run", targetId: runId },
        { targetKind: "snapshot", targetId: "ghost-snap" },
      ],
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as DetailResponse;
    expect(body.warnings).toContainEqual({
      kind: "trace-target-missing",
      targetKind: "snapshot",
      targetId: "ghost-snap",
      message: expect.stringContaining("ghost-snap"),
    });
  });

  it("GET returns versions newest first", async () => {
    const { caseId, runId } = seedCase();
    await postJson(caseId, validVersionBody(runId));
    await postJson(caseId, validVersionBody(runId));
    const response = await getJson(caseId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as VersionsResponse;
    expect(body.versions.map((v) => v.versionIndex)).toStrictEqual([3, 2, 1]);
  });

  it("GET returns 404 for an unknown caseId", async () => {
    const response = await getJson("absent");
    expect(response.status).toBe(404);
  });
});
