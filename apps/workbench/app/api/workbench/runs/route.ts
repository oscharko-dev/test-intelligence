import { NextResponse, type NextRequest } from "next/server";
import {
  startWorkbenchRun,
  toClientRunState,
  WorkbenchRunRegistryError,
} from "@/lib/server/workbench-run-registry";
import {
  prepareWorkbenchRun,
  WorkbenchRunValidationError,
} from "@/lib/server/workbench-run-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonError = ({
  status,
  code,
  message,
  issues,
}: {
  status: number;
  code: string;
  message: string;
  issues?: unknown;
}): NextResponse =>
  NextResponse.json(
    {
      error: {
        code,
        message,
        ...(issues !== undefined ? { issues } : {}),
      },
    },
    { status },
  );

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError({
      status: 400,
      code: "INVALID_JSON",
      message: "Request body must be valid JSON.",
    });
  }

  try {
    const prepared = await prepareWorkbenchRun({
      body,
      env: process.env,
      now:
        process.env.WORKBENCH_FIXED_NOW !== undefined
          ? new Date(process.env.WORKBENCH_FIXED_NOW)
          : new Date(),
    });
    const run = startWorkbenchRun(prepared);
    return NextResponse.json({ run: toClientRunState(run) }, { status: 202 });
  } catch (error) {
    if (error instanceof WorkbenchRunValidationError) {
      return jsonError({
        status: error.status,
        code: error.code,
        message: error.message,
        issues: error.issues,
      });
    }
    if (error instanceof WorkbenchRunRegistryError) {
      return jsonError({
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }
    return jsonError({
      status: 500,
      code: "WORKBENCH_RUN_START_FAILED",
      message: "Workbench run could not be started.",
    });
  }
}
