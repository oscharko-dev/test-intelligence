import type { ReactNode } from "react";
import { File, FileCheck, FileWarning, type LucideIcon } from "lucide-react";
import type { Artifact } from "@/lib/types";
import { cx, ui } from "@/lib/ui-classes";

const ICONS: Record<Artifact["status"], LucideIcon> = {
  ok: FileCheck,
  blocked: FileWarning,
  fail: FileWarning,
  pending: File,
};

function toneFor(status: Artifact["status"]): string {
  if (status === "ok") return ui.table.iconOk;
  if (status === "blocked" || status === "fail") return ui.table.iconErr;
  return ui.table.iconInfo;
}

function labelToneFor(status: Artifact["status"]): string {
  if (status === "ok") return ui.table.labelOk;
  if (status === "blocked" || status === "fail") return ui.table.labelErr;
  return ui.table.labelPending;
}

export interface ArtifactRowProps {
  artifact: Artifact;
}

export function ArtifactRow({ artifact }: ArtifactRowProps): ReactNode {
  const Icon = ICONS[artifact.status];
  return (
    <tr className={ui.table.row}>
      <td className={cx(ui.table.td, ui.table.colStatus, ui.table.rowStatus)}>
        <span className={toneFor(artifact.status)}>
          <Icon size={14} aria-hidden focusable={false} />
        </span>
      </td>
      <td className={cx(ui.table.td, ui.table.colName)}>
        <span className="inline-flex max-w-full items-center gap-2">
          {artifact.downloadHref !== undefined ? (
            <a
              className="truncate text-accent hover:underline"
              href={artifact.downloadHref}
              target="_blank"
              rel="noreferrer"
            >
              {artifact.name}
            </a>
          ) : (
            <span className="truncate">{artifact.name}</span>
          )}
          {artifact.customerFacing === true && (
            <span className="rounded border border-[hsl(142_40%_26%)] px-1 py-0.5 text-[10px] uppercase tracking-[0.08em] text-success">
              customer
            </span>
          )}
        </span>
      </td>
      <td className={ui.table.td}>
        <span className={cx(ui.table.label, labelToneFor(artifact.status))}>
          {artifact.status}
        </span>
      </td>
      <td className={cx(ui.table.td, ui.table.colSize)}>{artifact.size}</td>
    </tr>
  );
}
