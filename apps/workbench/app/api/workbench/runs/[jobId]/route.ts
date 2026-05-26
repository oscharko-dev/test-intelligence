import { NextResponse, type NextRequest } from "next/server";
import { getWorkbenchRun } from "@/lib/server/workbench-run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{
    jobId: string;
  }>;
}

export async function GET(
  _request: NextRequest,
  { params }: Params,
): Promise<NextResponse> {
  const { jobId } = await params;
  const run = getWorkbenchRun(jobId);
  if (run === undefined) {
    return NextResponse.json(
      {
        error: {
          code: "WORKBENCH_RUN_NOT_FOUND",
          message: "Workbench run not found.",
        },
      },
      { status: 404 },
    );
  }
  return NextResponse.json({ run });
}
