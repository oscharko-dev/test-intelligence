"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/primitives/Badge";
import type { TestCaseSummary } from "@/lib/server/storage/types";
import { ui } from "@/lib/ui-classes";
import {
  EMPTY_FILTERS,
  TestCasesFilterBar,
  type TestCasesFilters,
} from "./TestCasesFilterBar";
import { TestCasesList } from "./TestCasesList";
import { listTestCases, type ApiResult } from "./api";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly summaries: readonly TestCaseSummary[] }
  | { readonly kind: "error"; readonly message: string };

const matchesFilters = (
  row: TestCaseSummary,
  filters: TestCasesFilters,
): boolean => {
  if (filters.runId.length > 0 && row.sourceRunId !== filters.runId)
    return false;
  if (
    filters.snapshotId.length > 0 &&
    !row.snapshotIds.includes(filters.snapshotId)
  )
    return false;
  if (filters.lifecycle.length > 0 && row.status !== filters.lifecycle)
    return false;
  if (
    filters.versionStatus.length > 0 &&
    row.versionStatus !== filters.versionStatus
  )
    return false;
  if (filters.priority.length > 0 && row.priority !== filters.priority)
    return false;
  if (filters.risk.length > 0 && row.risk !== filters.risk) return false;
  if (filters.tags.length > 0) {
    const matchesAllTags = filters.tags.every((tag) => row.tags.includes(tag));
    if (!matchesAllTags) return false;
  }
  return true;
};

const fromResult = (
  result: ApiResult<readonly TestCaseSummary[]>,
): LoadState =>
  result.ok
    ? { kind: "ready", summaries: result.value }
    : { kind: "error", message: result.error.message };

export function TestCasesScreen(): ReactNode {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filters, setFilters] = useState<TestCasesFilters>(EMPTY_FILTERS);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listTestCases();
      if (cancelled) return;
      setState(fromResult(result));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const summaries = useMemo<readonly TestCaseSummary[]>(
    () => (state.kind === "ready" ? state.summaries : []),
    [state],
  );

  const filtered = useMemo<readonly TestCaseSummary[]>(
    () => summaries.filter((row) => matchesFilters(row, filters)),
    [summaries, filters],
  );

  return (
    <div className={ui.screen.root}>
      <header className={ui.screen.head}>
        <h1 className={ui.screen.title}>Test Cases</h1>
        <span className={ui.screen.spacer} />
        {state.kind === "ready" && (
          <span className={ui.screen.meta}>
            <Badge>{filtered.length}</Badge>
            <span>of {summaries.length} cases</span>
          </span>
        )}
      </header>
      <p className="mb-3 text-xs text-fg-muted">
        Persisted, generated test cases across runs. Open a row to inspect the
        canonical fields and traceability.
      </p>
      <TestCasesFilterBar
        summaries={summaries}
        filters={filters}
        onChange={setFilters}
      />
      <div className="mt-3">
        {state.kind === "loading" && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-md border border-dashed border-border-subtle p-6 text-center font-mono text-xs text-fg-muted"
          >
            Loading persisted test cases…
          </div>
        )}
        {state.kind === "error" && (
          <div
            role="alert"
            className="rounded-md border border-[hsl(0_50%_30%)] bg-[hsl(0_50%_12%_/_0.4)] p-3 font-mono text-xs text-danger"
          >
            {state.message}
          </div>
        )}
        {state.kind === "ready" && (
          <TestCasesList rows={filtered} hasAnyData={summaries.length > 0} />
        )}
      </div>
    </div>
  );
}
