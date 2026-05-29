import { NextResponse } from "next/server";
import { getWorkbenchSnapshotImportJob } from "@/lib/server/workbench-snapshot-vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { jobId } = await context.params;
  const job = getWorkbenchSnapshotImportJob(jobId);
  if (job === undefined) {
    return NextResponse.json(
      {
        error: {
          code: "SNAPSHOT_IMPORT_JOB_NOT_FOUND",
          message: "Snapshot import job was not found.",
        },
      },
      { status: 404 },
    );
  }
  return NextResponse.json({ job });
}
