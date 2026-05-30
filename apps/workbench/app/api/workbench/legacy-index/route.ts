/**
 * Operator-facing legacy-index endpoint (Issue #54).
 *
 *  - `GET` returns the most recent cached summary (cheap; never re-scans).
 *  - `POST` triggers a fresh `indexLegacyArtifacts()` pass and returns the
 *    resulting summary.
 *
 * WHY ignore the POST body: re-indexing has no operator parameters — it scans
 * the already-resolved data roots (`getWorkbenchStoragePaths` /
 * `WORKBENCH_OUTPUT_ROOTS`). Accepting and trusting client-provided path-like
 * fields would expose a CodeQL "uncontrolled data used in path expression"
 * sink, so the body is intentionally unread.
 */

import { NextResponse } from "next/server";

import {
  getLegacyIndexSummary,
  indexLegacyArtifacts,
  type LegacyIndexSummary,
} from "@/lib/server/workbench-legacy-indexer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ok = (summary: LegacyIndexSummary): NextResponse =>
  NextResponse.json({ summary });

const failure = (): NextResponse =>
  NextResponse.json(
    {
      error: {
        code: "LEGACY_INDEX_FAILED",
        message: "Legacy artifact index could not be refreshed.",
      },
    },
    { status: 500 },
  );

export function GET(): NextResponse {
  return ok(getLegacyIndexSummary());
}

export async function POST(): Promise<NextResponse> {
  try {
    return ok(await indexLegacyArtifacts());
  } catch {
    // The indexer is best-effort and does not surface per-folder failures, so a
    // top-level throw here means the storage adapter itself was unavailable.
    return failure();
  }
}
