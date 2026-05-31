import { NextResponse } from "next/server";

import { getWorkbenchStorage } from "@/lib/server/storage/bootstrap";
import {
  formatWorkbenchTenantScope,
  resolveWorkbenchTenantScope,
} from "@/lib/server/workbench-tenant-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

const jsonError = (
  status: number,
  code: string,
  message: string,
): NextResponse => NextResponse.json({ error: { code, message } }, { status });

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { caseId } = await context.params;
  try {
    const tenantScope = formatWorkbenchTenantScope(
      resolveWorkbenchTenantScope(process.env),
    );
    const detail = getWorkbenchStorage({ env: process.env }).testCases.get(
      caseId,
      tenantScope,
    );
    if (detail === undefined) {
      return jsonError(
        404,
        "WORKBENCH_TEST_CASE_NOT_FOUND",
        "Test case not found.",
      );
    }
    return NextResponse.json(detail);
  } catch {
    return jsonError(
      500,
      "WORKBENCH_TEST_CASE_READ_FAILED",
      "Persisted test case could not be loaded.",
    );
  }
}
