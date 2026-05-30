"use client";

import { ChevronRight, Info, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/primitives/Badge";
import { IconButton } from "@/components/primitives/IconButton";
import { Panel } from "@/components/primitives/Panel";
import { StatusChip } from "@/components/primitives/StatusChip";
import { HISTORY_SEED } from "@/lib/history-seed";
import { cx, ui } from "@/lib/ui-classes";

interface LegacyIndexSummary {
  readonly indexed: number;
  readonly alreadyIndexed: number;
  readonly legacyReadOnly: number;
  readonly skipped: number;
  readonly warnings: readonly string[];
}

const isLegacySummary = (value: unknown): value is LegacyIndexSummary =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { indexed?: unknown }).indexed === "number" &&
  typeof (value as { alreadyIndexed?: unknown }).alreadyIndexed === "number" &&
  typeof (value as { legacyReadOnly?: unknown }).legacyReadOnly === "number" &&
  typeof (value as { skipped?: unknown }).skipped === "number" &&
  Array.isArray((value as { warnings?: unknown }).warnings);

export function HistoryScreen(): ReactNode {
  const [selected, setSelected] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<LegacyIndexSummary | null>(null);
  const [legacyError, setLegacyError] = useState<string | null>(null);

  // Read-only fetch of the latest legacy-index summary. WHY no PUT/POST fallback
  // on failure: the summary lives in a server singleton; the client must never
  // re-derive or replace it locally, so a failed GET only shows "unavailable".
  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        const response = await fetch("/api/workbench/legacy-index", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          setLegacyError("Legacy index summary is unavailable.");
          return;
        }
        const payload = (await response.json().catch(() => undefined)) as
          | { summary?: unknown }
          | undefined;
        if (payload === undefined || !isLegacySummary(payload.summary)) {
          setLegacyError("Legacy index summary is unavailable.");
          return;
        }
        setLegacy(payload.summary);
        setLegacyError(null);
      } catch {
        if (!controller.signal.aborted) {
          setLegacyError("Legacy index summary is unavailable.");
        }
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <div className={ui.screen.root}>
      <div className={ui.screen.head}>
        <h2 className={ui.screen.title}>Run history</h2>
        <Badge variant="neutral">read-only</Badge>
        <span className={ui.screen.spacer} />
        <span className={ui.screen.meta}>
          <Info size={11} aria-hidden focusable={false} /> sample data
        </span>
      </div>

      <Panel bodyFlush>
        <table className={ui.table.table}>
          <thead>
            <tr>
              <th className={ui.table.th}>jobId</th>
              <th className={ui.table.th}>started</th>
              <th className={ui.table.th}>status</th>
              <th className={ui.table.th}>stages</th>
              <th className={cx(ui.table.th, ui.table.colArtifacts)}>
                artifacts
              </th>
              <th className={cx(ui.table.th, ui.table.colAction)} />
            </tr>
          </thead>
          <tbody>
            {HISTORY_SEED.map((r) => (
              <tr
                key={r.jobId}
                className={ui.table.rowLink}
                onClick={() => {
                  setSelected(r.jobId);
                }}
              >
                <td className={cx(ui.table.td, ui.table.colJob)}>{r.jobId}</td>
                <td className={cx(ui.table.td, "text-fg-muted")}>
                  {r.started}
                </td>
                <td className={ui.table.td}>
                  <StatusChip state={r.status} />
                </td>
                <td className={cx(ui.table.td, ui.table.colStages)}>
                  {r.stages}
                </td>
                <td className={cx(ui.table.td, ui.table.colArtifacts)}>
                  {r.artifacts}
                </td>
                <td className={cx(ui.table.td, ui.table.colAction)}>
                  <ChevronRight size={14} aria-hidden focusable={false} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {selected !== null && (
        <Panel
          title={`Detail · ${selected}`}
          actions={
            <IconButton
              icon={X}
              label="Close detail"
              iconSize={14}
              onClick={() => {
                setSelected(null);
              }}
            />
          }
        >
          <LegacyIndexPanel summary={legacy} error={legacyError} />
        </Panel>
      )}
    </div>
  );
}

function LegacyIndexPanel({
  summary,
  error,
}: {
  summary: LegacyIndexSummary | null;
  error: string | null;
}): ReactNode {
  if (summary === null) {
    return (
      <div className={ui.detailPlaceholder}>
        {error ?? "Loading legacy index summary…"}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-fg-muted md:grid-cols-4">
        <span>indexed {summary.indexed}</span>
        <span>already-indexed {summary.alreadyIndexed}</span>
        <span>legacy read-only {summary.legacyReadOnly}</span>
        <span>skipped {summary.skipped}</span>
      </div>
      {summary.warnings.length > 0 && (
        <ul className="m-0 grid gap-1 rounded border border-border-subtle bg-bg-input p-2 font-mono text-[11px] text-fg-muted">
          {summary.warnings.slice(0, 8).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
