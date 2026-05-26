import { NextResponse, type NextRequest } from "next/server";
import {
  readWorkbenchRunFile,
  WorkbenchRunRegistryError,
} from "@/lib/server/workbench-run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{
    jobId: string;
  }>;
}

const contentDispositionFilename = (filename: string): string => {
  const safe = filename.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 128);
  return safe.length > 0 ? safe : "artifact";
};

export async function GET(
  request: NextRequest,
  { params }: Params,
): Promise<Response> {
  const { jobId } = await params;
  const requestedPath = request.nextUrl.searchParams.get("path");
  if (requestedPath === null) {
    return NextResponse.json(
      {
        error: {
          code: "WORKBENCH_FILE_PATH_REQUIRED",
          message: "Artifact path query parameter is required.",
        },
      },
      { status: 400 },
    );
  }
  try {
    const file = await readWorkbenchRunFile(jobId, requestedPath);
    const body = new Uint8Array(file.bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-disposition": `inline; filename="${contentDispositionFilename(file.filename)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof WorkbenchRunRegistryError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "WORKBENCH_FILE_READ_FAILED",
          message: "Artifact file could not be read.",
        },
      },
      { status: 500 },
    );
  }
}
