import { NextResponse, type NextRequest } from "next/server";

import { getWorkbenchStorage } from "@/lib/server/storage/bootstrap";
import {
  formatWorkbenchTenantScope,
  resolveWorkbenchTenantScope,
} from "@/lib/server/workbench-tenant-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonError = (
  status: number,
  code: string,
  message: string,
): NextResponse => NextResponse.json({ error: { code, message } }, { status });

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantScope = formatWorkbenchTenantScope(
      resolveWorkbenchTenantScope(process.env),
    );
    const runIdParam = request.nextUrl.searchParams.get("runId");
    const runId =
      runIdParam !== null && runIdParam.length > 0 ? runIdParam : undefined;
    const storage = getWorkbenchStorage({ env: process.env });
    const testCases = storage.testCases.list({
      tenantScope,
      ...(runId !== undefined ? { runId } : {}),
    });
    return NextResponse.json({ testCases });
  } catch {
    return jsonError(
      500,
      "WORKBENCH_TEST_CASES_LIST_FAILED",
      "Persisted test cases could not be listed.",
    );
  }
}
