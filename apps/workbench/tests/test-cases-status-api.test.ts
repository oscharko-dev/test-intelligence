// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as transitionStatus } from "@/app/api/workbench/test-cases/[caseId]/status/route";
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
}

const seedCase = (
  initialStatus: "draft" | "reviewed" | "approved" = "draft",
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
    sourceTestCaseId: `src-${initialStatus}`,
    status: initialStatus,
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
  return { caseId: detail.testCase.id };
};

const post = (caseId: string, body: unknown): Promise<Response> =>
  transitionStatus(
    new Request(`http://localhost/api/workbench/test-cases/${caseId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ caseId }) },
  );

interface SuccessResponse {
  readonly detail: { readonly testCase: { readonly status: string } };
}

interface ErrorResponse {
  readonly error: string;
  readonly currentStatus?: string;
  readonly newStatus?: string;
}

describe("Workbench test case status API", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), "ti-tc-status-"));
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    resetWorkbenchStorageForTests();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetWorkbenchStorageForTests();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("transitions draft → reviewed", async () => {
    const { caseId } = seedCase("draft");
    const response = await post(caseId, { newStatus: "reviewed" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as SuccessResponse;
    expect(body.detail.testCase.status).toBe("reviewed");
  });

  it("returns 422 INVALID_STATUS for a bogus status string", async () => {
    const { caseId } = seedCase("draft");
    const response = await post(caseId, { newStatus: "banana" });
    expect(response.status).toBe(422);
    const body = (await response.json()) as ErrorResponse;
    expect(body.error).toBe("INVALID_STATUS");
  });

  it("returns 422 INVALID_STATUS_TRANSITION with currentStatus and newStatus on a disallowed move", async () => {
    const { caseId } = seedCase("reviewed");
    const response = await post(caseId, { newStatus: "draft" });
    expect(response.status).toBe(422);
    const body = (await response.json()) as ErrorResponse;
    expect(body.error).toBe("INVALID_STATUS_TRANSITION");
    expect(body.currentStatus).toBe("reviewed");
    expect(body.newStatus).toBe("draft");
  });

  it("returns 422 INVALID_STATUS_TRANSITION for same-state moves", async () => {
    const { caseId } = seedCase("draft");
    const response = await post(caseId, { newStatus: "draft" });
    expect(response.status).toBe(422);
    const body = (await response.json()) as ErrorResponse;
    expect(body.error).toBe("INVALID_STATUS_TRANSITION");
  });

  it("returns 404 for an unknown caseId", async () => {
    const response = await post("absent", { newStatus: "reviewed" });
    expect(response.status).toBe(404);
  });
});
