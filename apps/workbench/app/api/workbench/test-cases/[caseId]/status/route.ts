import { NextResponse } from "next/server";

import { getWorkbenchStorage } from "@/lib/server/storage/bootstrap";
import { WorkbenchStorageError } from "@/lib/server/storage/storage-adapter";
import type { TestCaseLifecycleStatus } from "@/lib/server/storage/types";
import {
  formatWorkbenchTenantScope,
  resolveWorkbenchTenantScope,
} from "@/lib/server/workbench-tenant-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ caseId: string }> };

const VALID_STATUSES: ReadonlySet<TestCaseLifecycleStatus> = new Set([
  "draft",
  "reviewed",
  "approved",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const jsonError = (
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse =>
  NextResponse.json({ error: { code, message, ...(extra ?? {}) } }, { status });

interface StatusBody {
  readonly newStatus: TestCaseLifecycleStatus;
  readonly changeReason?: string;
}

const parseBody = (raw: unknown): StatusBody | "invalid-status" | undefined => {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.newStatus !== "string") return undefined;
  if (!VALID_STATUSES.has(raw.newStatus as TestCaseLifecycleStatus)) {
    return "invalid-status";
  }
  const changeReason =
    typeof raw.changeReason === "string" ? raw.changeReason : undefined;
  return {
    newStatus: raw.newStatus as TestCaseLifecycleStatus,
    ...(changeReason !== undefined ? { changeReason } : {}),
  };
};

const isInvalidTransition = (error: unknown): error is WorkbenchStorageError =>
  error instanceof WorkbenchStorageError &&
  error.code === "INVALID_STATUS_TRANSITION";

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
  const parsed = parseBody(rawBody);
  if (parsed === "invalid-status") {
    return NextResponse.json({ error: "INVALID_STATUS" }, { status: 422 });
  }
  if (parsed === undefined) {
    return jsonError(400, "INVALID_BODY", "Request body shape is invalid.");
  }
  try {
    const env = process.env;
    const tenantScope = formatWorkbenchTenantScope(
      resolveWorkbenchTenantScope(env),
    );
    const storage = getWorkbenchStorage({ env });
    const detail = storage.testCases.transitionStatus({
      testCaseId: caseId,
      tenantScope,
      newStatus: parsed.newStatus,
      ...(parsed.changeReason !== undefined
        ? { changeReason: parsed.changeReason }
        : {}),
    });
    return NextResponse.json({ detail });
  } catch (error) {
    if (isInvalidTransition(error)) {
      const details = error.details as
        | {
            currentStatus?: TestCaseLifecycleStatus;
            newStatus?: TestCaseLifecycleStatus;
          }
        | undefined;
      return NextResponse.json(
        {
          error: "INVALID_STATUS_TRANSITION",
          currentStatus: details?.currentStatus,
          newStatus: details?.newStatus,
        },
        { status: 422 },
      );
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
      "WORKBENCH_TEST_CASE_STATUS_FAILED",
      "Could not transition test case status.",
    );
  }
}
