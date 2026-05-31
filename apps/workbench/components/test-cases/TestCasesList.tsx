"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { TestCaseSummary } from "@/lib/server/storage/types";
import { cx, ui } from "@/lib/ui-classes";

export const TEST_CASES_LIST_PAGE_SIZE = 200;

export interface TestCasesListProps {
  readonly rows: readonly TestCaseSummary[];
  readonly hasAnyData: boolean;
}

function shortTags(tags: readonly string[]): string {
  if (tags.length === 0) return "—";
  if (tags.length <= 3) return tags.join(", ");
  return `${tags.slice(0, 3).join(", ")} +${tags.length - 3}`;
}

function shortRunId(runId: string): string {
  if (runId.length <= 16) return runId;
  return `${runId.slice(0, 10)}…${runId.slice(-4)}`;
}

export function TestCasesList({
  rows,
  hasAnyData,
}: TestCasesListProps): ReactNode {
  const [revealAll, setRevealAll] = useState(false);

  if (rows.length === 0) {
    return (
      <div
        role="status"
        className="rounded-md border border-dashed border-border-subtle p-6 text-center font-mono text-xs text-fg-muted"
      >
        {hasAnyData
          ? "No test cases match the current filters."
          : "No persisted test cases yet."}
      </div>
    );
  }

  const visible =
    revealAll || rows.length <= TEST_CASES_LIST_PAGE_SIZE
      ? rows
      : rows.slice(0, TEST_CASES_LIST_PAGE_SIZE);
  const hiddenCount = rows.length - visible.length;

  return (
    <div className="overflow-auto rounded-md border border-border-subtle">
      <table className={ui.table.table}>
        <thead>
          <tr>
            <th className={ui.table.th} scope="col">
              Title
            </th>
            <th className={ui.table.th} scope="col">
              Run
            </th>
            <th className={ui.table.th} scope="col">
              Status
            </th>
            <th className={ui.table.th} scope="col">
              Priority
            </th>
            <th className={ui.table.th} scope="col">
              Risk
            </th>
            <th className={ui.table.th} scope="col">
              Tags
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.id} className={cx(ui.table.row, ui.table.rowLink)}>
              <td className={cx(ui.table.td, ui.table.colName)}>
                <Link
                  href={`/test-cases/${encodeURIComponent(row.id)}`}
                  className="font-ui text-fg-default hover:underline"
                  data-testid="test-case-row-link"
                >
                  {row.title.length > 0 ? row.title : "(untitled)"}
                </Link>
              </td>
              <td className={cx(ui.table.td, ui.table.colJob)}>
                {shortRunId(row.sourceRunId)}
              </td>
              <td className={ui.table.td}>{row.status}</td>
              <td className={ui.table.td}>{row.priority}</td>
              <td className={ui.table.td}>{row.risk}</td>
              <td className={ui.table.td}>{shortTags(row.tags)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 && (
        <div className="flex justify-center border-t border-border-subtle bg-bg-panel p-2">
          <button
            type="button"
            className={cx(ui.button.base)}
            onClick={() => {
              setRevealAll(true);
            }}
            data-testid="test-cases-show-more"
          >
            Show {hiddenCount} more
          </button>
        </div>
      )}
    </div>
  );
}
