import { NextResponse } from "next/server";

import { writeArtifact } from "@/lib/server/storage";
import {
  getWorkbenchStorage,
  getWorkbenchStoragePaths,
} from "@/lib/server/storage/bootstrap";
import { WorkbenchStorageError } from "@/lib/server/storage/storage-adapter";
import type {
  AppendTestCaseVersionInput,
  TestCaseStepRecord,
  TestCaseTraceLinkKind,
  TestCaseTraceTargetInput,
} from "@/lib/server/storage/types";
import { checkTestCasePlausibility } from "@/lib/server/test-case-plausibility";
import {
  formatWorkbenchTenantScope,
  resolveWorkbenchTenantScope,
} from "@/lib/server/workbench-tenant-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ caseId: string }> };

const jsonError = (
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse =>
  NextResponse.json({ error: { code, message, ...(extra ?? {}) } }, { status });

const TRACE_KINDS: ReadonlySet<TestCaseTraceLinkKind> = new Set([
  "run",
  "snapshot",
  "figma-node",
  "scope-basket",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

const parseSteps = (value: unknown): readonly TestCaseStepRecord[] => {
  if (!Array.isArray(value)) return [];
  const out: TestCaseStepRecord[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (
      typeof entry.action === "string" &&
      typeof entry.expected === "string"
    ) {
      out.push({ action: entry.action, expected: entry.expected });
    }
  }
  return out;
};

const parseTraceTargets = (
  value: unknown,
): readonly TestCaseTraceTargetInput[] => {
  if (!Array.isArray(value)) return [];
  const out: TestCaseTraceTargetInput[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { targetKind, targetId } = entry;
    if (typeof targetKind !== "string" || typeof targetId !== "string")
      continue;
    if (!TRACE_KINDS.has(targetKind as TestCaseTraceLinkKind)) continue;
    out.push({
      targetKind: targetKind as TestCaseTraceLinkKind,
      targetId,
    });
  }
  return out;
};

interface AppendBody {
  readonly version: AppendTestCaseVersionInput["version"];
  readonly changeReason?: string;
}

const parseBody = (raw: unknown): AppendBody | undefined => {
  if (!isRecord(raw)) return undefined;
  const title = typeof raw.title === "string" ? raw.title : undefined;
  if (title === undefined) return undefined;
  const objective = typeof raw.objective === "string" ? raw.objective : "";
  const priority = typeof raw.priority === "string" ? raw.priority : "";
  const risk = typeof raw.risk === "string" ? raw.risk : "";
  const status = typeof raw.status === "string" ? raw.status : "draft";
  const description =
    typeof raw.description === "string" ? raw.description : undefined;
  const changeReason =
    typeof raw.changeReason === "string" ? raw.changeReason : undefined;
  return {
    version: {
      title,
      objective,
      preconditions: parseStringArray(raw.preconditions),
      steps: parseSteps(raw.steps),
      testData: parseStringArray(raw.testData),
      priority,
      risk,
      tags: parseStringArray(raw.tags),
      status,
      ...(description !== undefined ? { description } : {}),
      // Placeholder content; the route fills it in before persistence.
      content: { sha256: "", byteSize: 0, storageRef: "" },
      traceTargets: parseTraceTargets(raw.traceTargets),
    },
    ...(changeReason !== undefined ? { changeReason } : {}),
  };
};

const canonicalBytes = (version: AppendBody["version"]): Uint8Array => {
  const canonical = JSON.stringify({
    title: version.title,
    objective: version.objective,
    preconditions: version.preconditions,
    steps: version.steps,
    testData: version.testData,
    priority: version.priority,
    risk: version.risk,
    tags: version.tags,
    status: version.status,
    description: version.description ?? null,
    traceTargets: version.traceTargets,
  });
  return new Uint8Array(Buffer.from(canonical, "utf8"));
};

const isValidationFailure = (error: unknown): error is WorkbenchStorageError =>
  error instanceof WorkbenchStorageError && error.code === "VALIDATION_FAILED";

const isCaseMissing = (error: unknown): error is WorkbenchStorageError =>
  error instanceof WorkbenchStorageError &&
  error.code === "REFERENTIAL_INTEGRITY";

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { caseId } = await context.params;
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_BODY", "Request body must be valid JSON.");
  }
  const body = parseBody(rawBody);
  if (body === undefined) {
    return jsonError(400, "INVALID_BODY", "Request body shape is invalid.");
  }
  try {
    const env = process.env;
    const tenantScope = formatWorkbenchTenantScope(
      resolveWorkbenchTenantScope(env),
    );
    const storage = getWorkbenchStorage({ env });
    const paths = getWorkbenchStoragePaths({ env });
    const content = writeArtifact(paths, canonicalBytes(body.version));
    const input: AppendTestCaseVersionInput = {
      testCaseId: caseId,
      tenantScope,
      ...(body.changeReason !== undefined
        ? { changeReason: body.changeReason }
        : {}),
      version: { ...body.version, content },
    };
    const detail = storage.testCases.appendVersion(input);
    const warnings = checkTestCasePlausibility(
      body.version.traceTargets,
      storage.snapshots,
      tenantScope,
    );
    return NextResponse.json({ detail, warnings });
  } catch (error) {
    if (isValidationFailure(error)) {
      return NextResponse.json({ errors: error.details }, { status: 422 });
    }
    if (isCaseMissing(error)) {
      return jsonError(
        404,
        "WORKBENCH_TEST_CASE_NOT_FOUND",
        "Test case not found.",
      );
    }
    return jsonError(
      500,
      "WORKBENCH_TEST_CASE_APPEND_FAILED",
      "Could not append a new version.",
    );
  }
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { caseId } = await context.params;
  try {
    const env = process.env;
    const tenantScope = formatWorkbenchTenantScope(
      resolveWorkbenchTenantScope(env),
    );
    const storage = getWorkbenchStorage({ env });
    const current = storage.testCases.get(caseId, tenantScope);
    if (current === undefined) {
      return jsonError(
        404,
        "WORKBENCH_TEST_CASE_NOT_FOUND",
        "Test case not found.",
      );
    }
    const versions = storage.testCases.listVersions(caseId, tenantScope);
    return NextResponse.json({ versions });
  } catch {
    return jsonError(
      500,
      "WORKBENCH_TEST_CASE_VERSIONS_LIST_FAILED",
      "Could not load version history.",
    );
  }
}
