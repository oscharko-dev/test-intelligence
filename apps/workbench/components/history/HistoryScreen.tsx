"use client";

import { ChevronRight, Info, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/primitives/Badge";
import { IconButton } from "@/components/primitives/IconButton";
import { Panel } from "@/components/primitives/Panel";
import { StatusChip } from "@/components/primitives/StatusChip";
import { HISTORY_SEED } from "@/lib/history-seed";
import { cx, ui } from "@/lib/ui-classes";

export function HistoryScreen(): ReactNode {
  const [selected, setSelected] = useState<string | null>(null);
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
          <div className={ui.detailPlaceholder}>
            Persisted run-detail loading is not implemented yet.
          </div>
        </Panel>
      )}
    </div>
  );
}
