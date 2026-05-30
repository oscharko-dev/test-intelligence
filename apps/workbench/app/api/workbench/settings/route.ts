import { NextResponse, type NextRequest } from "next/server";
import {
  readWorkbenchSettings,
  redactWorkbenchSettingsForClient,
  writeWorkbenchSettings,
} from "@/lib/server/workbench-settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SENSITIVE_JSON_HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
} as const;

const settingsJson = (body: unknown, init?: ResponseInit): NextResponse =>
  NextResponse.json(body, {
    ...init,
    headers: {
      ...SENSITIVE_JSON_HEADERS,
      ...init?.headers,
    },
  });

const jsonError = ({
  status,
  code,
  message,
}: {
  status: number;
  code: string;
  message: string;
}): NextResponse =>
  settingsJson({ error: { code, message } }, { status });

export async function GET(): Promise<NextResponse> {
  try {
    return settingsJson({
      settings: redactWorkbenchSettingsForClient(await readWorkbenchSettings()),
    });
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
    return settingsJson({
      settings: redactWorkbenchSettingsForClient(
        await writeWorkbenchSettings(settings),
      ),
    });
  } catch {
    return jsonError({
      status: 500,
      code: "WORKBENCH_SETTINGS_WRITE_FAILED",
      message: "Workbench settings could not be saved.",
    });
  }
}
