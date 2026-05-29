import { NextResponse, type NextRequest } from "next/server";
import {
  previewWorkbenchSnapshotSelection,
  WorkbenchSnapshotVaultError,
} from "@/lib/server/workbench-snapshot-vault";
import type { SnapshotRunSelection } from "@/lib/types";

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

const readSelection = (value: unknown): SnapshotRunSelection => {
  const raw =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const read = (field: string): string[] =>
    Array.isArray(raw[field])
      ? raw[field]
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [];
  return {
    nodeIds: read("nodeIds"),
    pageIds: read("pageIds"),
    frameIds: read("frameIds"),
  };
};

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { snapshotId } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as unknown;
    return NextResponse.json({
      preview: await previewWorkbenchSnapshotSelection({
        snapshotId,
        selection: readSelection(body),
      }),
    });
  } catch (error) {
    if (error instanceof WorkbenchSnapshotVaultError) return jsonError(error);
    return NextResponse.json(
      {
        error: {
          code: "SNAPSHOT_SELECTION_PREVIEW_FAILED",
          message: "Snapshot selection could not be previewed.",
        },
      },
      { status: 500 },
    );
  }
}
