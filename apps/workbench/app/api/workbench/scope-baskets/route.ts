import { NextResponse, type NextRequest } from "next/server";
import {
  getScopeBasketForSnapshot,
  parseScopeSelection,
  saveScopeBasketSelection,
  WorkbenchScopeBasketError,
} from "@/lib/server/workbench-scope-basket-store";
import type { ScopeBasketRecord } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BASKET_LABEL = "Snapshot scope basket";

const jsonError = (error: WorkbenchScopeBasketError): NextResponse =>
  NextResponse.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status },
  );

const failure = (code: string, message: string): NextResponse =>
  NextResponse.json({ error: { code, message } }, { status: 500 });

/**
 * Operator-safe projection: only the fields the client needs to rehydrate the
 * ephemeral basket. The tenant scope is server-resolved, never echoed from the
 * request body.
 */
const projectBasket = (
  record: ScopeBasketRecord,
): {
  snapshotId?: string;
  label: string;
  selection: ScopeBasketRecord["selection"];
  itemCount: number;
} => ({
  ...(record.snapshotId !== undefined ? { snapshotId: record.snapshotId } : {}),
  label: record.label,
  selection: record.selection,
  itemCount: record.itemCount,
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const snapshotId = request.nextUrl.searchParams.get("snapshotId") ?? "";
  try {
    const record = getScopeBasketForSnapshot(snapshotId);
    return NextResponse.json({
      basket: record === undefined ? null : projectBasket(record),
    });
  } catch (error) {
    if (error instanceof WorkbenchScopeBasketError) return jsonError(error);
    return failure(
      "SCOPE_BASKET_READ_FAILED",
      "Scope basket could not be loaded.",
    );
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => undefined)) as unknown;
    const fields =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    if (typeof fields.snapshotId !== "string") {
      throw new WorkbenchScopeBasketError({
        status: 400,
        code: "SCOPE_BASKET_SNAPSHOT_ID_REQUIRED",
        message: "A snapshot id is required to persist a scope basket.",
      });
    }
    const label =
      typeof fields.label === "string" && fields.label.trim().length > 0
        ? fields.label.trim()
        : DEFAULT_BASKET_LABEL;
    const record = saveScopeBasketSelection({
      snapshotId: fields.snapshotId,
      label,
      selection: parseScopeSelection(fields.selection),
    });
    return NextResponse.json({ basket: projectBasket(record) });
  } catch (error) {
    if (error instanceof WorkbenchScopeBasketError) return jsonError(error);
    return failure(
      "SCOPE_BASKET_SAVE_FAILED",
      "Scope basket could not be saved.",
    );
  }
}
