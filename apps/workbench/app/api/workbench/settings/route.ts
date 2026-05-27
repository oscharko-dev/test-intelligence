import { NextResponse, type NextRequest } from "next/server";
import {
  readWorkbenchSettings,
  writeWorkbenchSettings,
} from "@/lib/server/workbench-settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonError = ({
  status,
  code,
  message,
}: {
  status: number;
  code: string;
  message: string;
}): NextResponse => NextResponse.json({ error: { code, message } }, { status });

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ settings: await readWorkbenchSettings() });
  } catch {
    return jsonError({
      status: 500,
      code: "WORKBENCH_SETTINGS_READ_FAILED",
      message: "Workbench settings could not be loaded.",
    });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
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
    const settings =
      typeof body === "object" && body !== null && "settings" in body
        ? (body as { settings?: unknown }).settings
        : body;
    return NextResponse.json({
      settings: await writeWorkbenchSettings(settings),
    });
  } catch {
    return jsonError({
      status: 500,
      code: "WORKBENCH_SETTINGS_WRITE_FAILED",
      message: "Workbench settings could not be saved.",
    });
  }
}
