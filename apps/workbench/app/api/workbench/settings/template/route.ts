import { WORKBENCH_IMPORT_ENV_TEMPLATE } from "@/lib/server/workbench-settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response(WORKBENCH_IMPORT_ENV_TEMPLATE, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": 'attachment; filename="import.env"',
      "cache-control": "no-store",
    },
  });
}
