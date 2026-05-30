import { NextResponse, type NextRequest } from "next/server";
import {
  importWorkbenchSettingsFromEnvContent,
  importWorkbenchSettingsFromEnvPath,
  redactWorkbenchSettingsForClient,
} from "@/lib/server/workbench-settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SENSITIVE_JSON_HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
} as const;

const settingsImportJson = (
  body: unknown,
  init?: ResponseInit,
): NextResponse =>
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
  settingsImportJson({ error: { code, message } }, { status });

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

  if (typeof body !== "object" || body === null) {
    return jsonError({
      status: 400,
      code: "INVALID_IMPORT_REQUEST",
      message: "Import request must provide a path or .env content.",
    });
  }

  const raw = body as { path?: unknown; content?: unknown };
  const envPath = typeof raw.path === "string" ? raw.path.trim() : "";
  const content = typeof raw.content === "string" ? raw.content : "";
  try {
    if (envPath.length > 0) {
      return settingsImportJson({
        settings: redactWorkbenchSettingsForClient(
          await importWorkbenchSettingsFromEnvPath(envPath),
        ),
      });
    }
    if (content.trim().length > 0) {
      return settingsImportJson({
        settings: redactWorkbenchSettingsForClient(
          await importWorkbenchSettingsFromEnvContent(content),
        ),
      });
    }
    return jsonError({
      status: 400,
      code: "INVALID_IMPORT_REQUEST",
      message: "Import request must provide a path or .env content.",
    });
  } catch (error) {
    return jsonError({
      status: 400,
      code: "WORKBENCH_SETTINGS_IMPORT_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Workbench settings could not be imported.",
    });
  }
}
