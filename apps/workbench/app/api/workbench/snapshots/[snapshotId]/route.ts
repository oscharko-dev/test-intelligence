import { NextResponse } from "next/server";
import {
  getWorkbenchSnapshotDetail,
  WorkbenchSnapshotVaultError,
} from "@/lib/server/workbench-snapshot-vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ snapshotId: string }>;
};

const jsonError = (error: WorkbenchSnapshotVaultError): NextResponse =>
  NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
      },
    },
    { status: error.status },
  );

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { snapshotId } = await context.params;
  try {
    return NextResponse.json({
      detail: await getWorkbenchSnapshotDetail(snapshotId),
    });
  } catch (error) {
    if (error instanceof WorkbenchSnapshotVaultError) return jsonError(error);
    return NextResponse.json(
      {
        error: {
          code: "SNAPSHOT_DETAIL_FAILED",
          message: "Snapshot detail could not be loaded.",
        },
      },
      { status: 500 },
    );
  }
}
