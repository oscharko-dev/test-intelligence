import { NextResponse, type NextRequest } from "next/server";
import {
  searchWorkbenchSnapshot,
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
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { snapshotId } = await context.params;
  try {
    const query = request.nextUrl.searchParams.get("q") ?? "";
    const includeHidden =
      request.nextUrl.searchParams.get("includeHidden") === "true";
    return NextResponse.json({
      search: await searchWorkbenchSnapshot({
        snapshotId,
        query,
        includeHidden,
      }),
    });
  } catch (error) {
    if (error instanceof WorkbenchSnapshotVaultError) return jsonError(error);
    return NextResponse.json(
      {
        error: {
          code: "SNAPSHOT_SEARCH_FAILED",
          message: "Snapshot search could not be loaded.",
        },
      },
      { status: 500 },
    );
  }
}
