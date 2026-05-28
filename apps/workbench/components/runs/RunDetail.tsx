"use client";

import { AlertTriangle, Download, FileText, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/primitives/Badge";
import { IconButton } from "@/components/primitives/IconButton";
import { Panel } from "@/components/primitives/Panel";
import { StatusChip } from "@/components/primitives/StatusChip";
import { STAGE_ORDER } from "@/lib/run-state";
import type { CustomerOutputFile, RunState, StageName } from "@/lib/types";
import { cx, ui } from "@/lib/ui-classes";
import { ArtifactRow } from "./ArtifactRow";
import { StageCard } from "./StageCard";

export interface RunDetailProps {
  run: RunState;
  onNewRun: () => void;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19) + "Z";
}

function CustomerOutputPanel({
  title,
  description,
  files,
}: {
  title: string;
  description: string;
  files: readonly CustomerOutputFile[];
}): ReactNode {
  if (files.length === 0) return null;
  return (
    <div className="mt-4">
      <Panel
        title={title}
        description={description}
        bodyFlush
        actions={<Badge variant="success">{files.length} files</Badge>}
      >
        <table className={ui.table.table}>
          <thead>
            <tr>
              <th className={cx(ui.table.th, ui.table.colStatus)} />
              <th className={ui.table.th}>file</th>
              <th className={ui.table.th}>type</th>
              <th className={cx(ui.table.th, ui.table.colSize)}>size</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.path} className={ui.table.row}>
                <td
                  className={cx(
                    ui.table.td,
                    ui.table.colStatus,
                    ui.table.rowStatus,
                  )}
                >
                  <span className={ui.table.iconOk}>
                    <FileText size={14} aria-hidden focusable={false} />
                  </span>
                </td>
                <td className={cx(ui.table.td, ui.table.colName)}>
                  <a
                    className="break-all text-accent hover:underline"
                    href={file.downloadHref}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {file.path}
                  </a>
                </td>
                <td className={ui.table.td}>
                  <span className={cx(ui.table.label, ui.table.labelOk)}>
                    {file.combined ? "combined" : "per-case"}
                  </span>
                </td>
                <td className={cx(ui.table.td, ui.table.colSize)}>
                  {file.size}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

export function RunDetail({ run, onNewRun }: RunDetailProps): ReactNode {
  const activeStage: StageName | undefined = STAGE_ORDER.find(
    (s) => run.stages[s].outcome === "pending",
  );

  return (
    <div className={ui.screen.root}>
      <div className={ui.screen.head}>
        <h2 className={ui.screen.title}>Run detail</h2>
        <Badge variant="accent">live</Badge>
        <span className={ui.screen.spacer} />
        <div className={ui.screen.actions}>
          <button
            className={cx(ui.button.base, ui.button.ghost)}
            type="button"
            onClick={onNewRun}
          >
            <RotateCcw size={14} aria-hidden focusable={false} /> New run
          </button>
        </div>
      </div>

      <div className={ui.runDetail.header}>
        <span className={ui.runDetail.job}>{run.jobId ?? "—"}</span>
        <span className={ui.runDetail.meta}>
          <span>generatedAt&nbsp;{formatTimestamp(run.generatedAt)}</span>
          <span>contract&nbsp;{run.contractVersion}</span>
        </span>
        <span className={ui.runDetail.spacer} />
        <StatusChip state={run.status} />
      </div>

      <div className={ui.runDetail.stages}>
        {STAGE_ORDER.map((name) => (
          <StageCard
            key={name}
            name={name}
            data={run.stages[name]}
            activeStage={activeStage}
            runStatus={run.status}
          />
        ))}
      </div>

      {run.errorMessage !== undefined && (
        <div className="mt-4">
          <Panel title="Run error" description="Sanitized operator message.">
            <div className="flex items-start gap-2 font-mono text-xs text-danger">
              <AlertTriangle size={14} aria-hidden focusable={false} />
              <span>{run.errorMessage}</span>
            </div>
          </Panel>
        </div>
      )}

      {run.artifactDir !== undefined && (
        <div className="mt-4">
          <Panel
            title="Artifact root"
            description="Filesystem root for this run. File links are limited to this directory."
          >
            <div className="grid gap-1 font-mono text-xs">
              <span className="break-all text-fg-default">
                {run.artifactDir}
              </span>
              {run.outputRoot !== undefined && (
                <span className="break-all text-fg-muted">
                  outputRoot {run.outputRoot}
                </span>
              )}
            </div>
          </Panel>
        </div>
      )}

      <CustomerOutputPanel
        title="Customer Markdown"
        description="Customer-facing Markdown emitted by the production runner."
        files={run.customerMarkdown ?? []}
      />

      <CustomerOutputPanel
        title="Customer PDF"
        description="Customer-facing PDFs emitted by the production runner."
        files={run.customerPdf ?? []}
      />

      <CustomerOutputPanel
        title="Customer TXT"
        description="Customer-facing plain-text files emitted by the production runner."
        files={run.customerTxt ?? []}
      />

      <div className="mt-4">
        <Panel
          title="Artifacts"
          description="Outputs produced by the run. Status reflects the policy-gate verdict."
          bodyFlush
          actions={
            <>
              <Badge variant="neutral">{run.artifacts.length} files</Badge>
              <IconButton
                icon={Download}
                label="Download artifact bundle"
                iconSize={14}
              />
            </>
          }
        >
          <table className={ui.table.table}>
            <thead>
              <tr>
                <th className={cx(ui.table.th, ui.table.colStatus)} />
                <th className={ui.table.th}>file</th>
                <th className={ui.table.th}>status</th>
                <th className={cx(ui.table.th, ui.table.colSize)}>size</th>
              </tr>
            </thead>
            <tbody>
              {run.artifacts.map((a) => (
                <ArtifactRow key={a.name} artifact={a} />
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
