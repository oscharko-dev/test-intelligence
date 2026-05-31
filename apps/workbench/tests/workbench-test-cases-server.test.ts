// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getTestCaseDetail } from "@/app/api/workbench/test-cases/[caseId]/route";
import { GET as listTestCases } from "@/app/api/workbench/test-cases/route";
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

const contentRef = {
  sha256: SHA,
  byteSize: 32,
  storageRef: artifactStorageRef(SHA),
};

const seedPersistedCase = (args: {
  sourceTestCaseId: string;
}): { caseId: string; runId: string; tenantScope: string } => {
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
    content: contentRef,
  });
  const detail = storage.testCases.create({
    tenantScope,
    sourceRunId: run.id,
    sourceGeneratedSeedId: seed.id,
    sourceTestCaseId: args.sourceTestCaseId,
    status: "draft",
    initialVersion: {
      source: "generated",
      title: "Persisted case",
      objective: "Cover persistence path",
      preconditions: [],
      steps: [{ action: "go", expected: "ok" }],
      testData: [],
      priority: "P1",
      risk: "low",
      tags: ["L1"],
      status: "generated",
      content: contentRef,
      traceTargets: [{ targetKind: "run", targetId: run.id }],
    },
  });
  return { caseId: detail.testCase.id, runId: run.id, tenantScope };
};

interface ListResponseBody {
  readonly testCases: ReadonlyArray<{
    readonly id: string;
    readonly sourceTestCaseId: string;
    readonly title: string;
    readonly priority: string;
    readonly risk: string;
    readonly tags: readonly string[];
    readonly versionStatus: string;
    readonly snapshotIds: readonly string[];
    readonly traceLinkKinds: readonly string[];
  }>;
}

interface DetailResponseBody {
  readonly testCase: { id: string };
  readonly currentVersion: { title: string };
}

interface ErrorResponseBody {
  readonly error: { code: string; message: string };
}

describe("Workbench test cases API", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), "ti-tc-routes-"));
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    resetWorkbenchStorageForTests();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetWorkbenchStorageForTests();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("GET /api/workbench/test-cases returns persisted cases filtered by runId with current-version summary fields", async () => {
    const a = seedPersistedCase({ sourceTestCaseId: "tc-a" });
    seedPersistedCase({ sourceTestCaseId: "tc-b" });

    const request = new NextRequest(
      `http://localhost/api/workbench/test-cases?runId=${a.runId}`,
    );
    const response = await listTestCases(request);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListResponseBody;
    expect(body.testCases).toHaveLength(1);
    const summary = body.testCases[0];
    expect(summary?.sourceTestCaseId).toBe("tc-a");
    expect(summary?.title).toBe("Persisted case");
    expect(summary?.priority).toBe("P1");
    expect(summary?.risk).toBe("low");
    expect(summary?.tags).toStrictEqual(["L1"]);
    expect(summary?.versionStatus).toBe("generated");
    expect(summary?.snapshotIds).toStrictEqual([]);
    expect(summary?.traceLinkKinds).toStrictEqual(["run"]);
  });

  it("GET /api/workbench/test-cases without runId returns every case", async () => {
    seedPersistedCase({ sourceTestCaseId: "tc-a" });
    seedPersistedCase({ sourceTestCaseId: "tc-b" });

    const request = new NextRequest(
      `http://localhost/api/workbench/test-cases`,
    );
    const response = await listTestCases(request);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListResponseBody;
    expect(body.testCases.map((c) => c.sourceTestCaseId).sort()).toStrictEqual([
      "tc-a",
      "tc-b",
    ]);
  });

  it("GET /api/workbench/test-cases/[caseId] returns the detail bundle", async () => {
    const { caseId } = seedPersistedCase({ sourceTestCaseId: "tc-a" });
    const response = await getTestCaseDetail(new Request("http://localhost"), {
      params: Promise.resolve({ caseId }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as DetailResponseBody;
    expect(body.testCase.id).toBe(caseId);
    expect(body.currentVersion.title).toBe("Persisted case");
  });

  it("GET /api/workbench/test-cases/[caseId] returns 404 for an unknown id", async () => {
    const response = await getTestCaseDetail(new Request("http://localhost"), {
      params: Promise.resolve({ caseId: "absent" }),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as ErrorResponseBody;
    expect(body.error.code).toBe("WORKBENCH_TEST_CASE_NOT_FOUND");
  });
});
