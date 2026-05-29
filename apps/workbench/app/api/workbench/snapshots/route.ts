import { NextResponse, type NextRequest } from "next/server";
import {
  listWorkbenchSnapshots,
  WorkbenchSnapshotVaultError,
} from "@/lib/server/workbench-snapshot-vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonError = (error: WorkbenchSnapshotVaultError): NextResponse =>
  NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.failureClass !== undefined
          ? { failureClass: error.failureClass }
          : {}),
      },
    },
    { status: error.status },
  );

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ snapshots: await listWorkbenchSnapshots() });
  } catch (error) {
    if (error instanceof WorkbenchSnapshotVaultError) return jsonError(error);
    return NextResponse.json(
      {
        error: {
          code: "SNAPSHOT_CATALOG_FAILED",
          message: "Snapshot catalog could not be loaded.",
        },
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { startWorkbenchSnapshotImport } =
      await import("@/lib/server/workbench-snapshot-vault");
    const body = (await request.json().catch(() => undefined)) as unknown;
    const job = await startWorkbenchSnapshotImport({ body });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    if (error instanceof WorkbenchSnapshotVaultError) return jsonError(error);
    return NextResponse.json(
      {
        error: {
          code: "SNAPSHOT_IMPORT_START_FAILED",
          message: "Snapshot import could not be started.",
        },
      },
      { status: 500 },
    );
  }
}
