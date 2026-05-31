"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { IconButton } from "@/components/primitives/IconButton";
import { MetadataRow } from "@/components/primitives/MetadataRow";
import { Panel } from "@/components/primitives/Panel";
import type {
  TestCaseTraceLinkKind,
  TestCaseTraceLinkRecord,
} from "@/lib/server/storage/types";
import { ui } from "@/lib/ui-classes";

interface TraceGroup {
  readonly kind: TestCaseTraceLinkKind;
  readonly label: string;
  readonly links: readonly TestCaseTraceLinkRecord[];
}

const GROUP_ORDER: readonly { kind: TestCaseTraceLinkKind; label: string }[] = [
  { kind: "run", label: "Run" },
  { kind: "snapshot", label: "Snapshot" },
  { kind: "figma-node", label: "Figma node" },
  { kind: "scope-basket", label: "Scope basket" },
];

const groupLinks = (
  traceLinks: readonly TestCaseTraceLinkRecord[],
): readonly TraceGroup[] =>
  GROUP_ORDER.map((entry) => ({
    kind: entry.kind,
    label: entry.label,
    links: traceLinks.filter((link) => link.targetKind === entry.kind),
  })).filter((group) => group.links.length > 0);

const shortId = (id: string): string =>
  id.length <= 14 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;

function copyToClipboard(value: string): void {
  if (typeof navigator === "undefined") return;
  const clip = navigator.clipboard;
  if (clip === undefined) return;
  void clip.writeText(value).catch(() => undefined);
}

function TraceChip({
  link,
}: {
  readonly link: TestCaseTraceLinkRecord;
}): ReactNode {
  const display = shortId(link.targetId);
  const label = `${link.targetKind} ${link.targetId}`;
  if (link.targetKind === "snapshot") {
    return (
      <span className={ui.chip.base}>
        <Link
          href={`/snapshots#${encodeURIComponent(link.targetId)}`}
          aria-label={label}
          className="text-fg-default hover:underline"
        >
          {display}
        </Link>
        <IconButton
          icon={Copy}
          label={`Copy ${link.targetKind} id ${link.targetId}`}
          variant="sm"
          onClick={() => {
            copyToClipboard(link.targetId);
          }}
        />
      </span>
    );
  }
  return (
    <span className={ui.chip.base} aria-label={label}>
      <span className="text-fg-default">{display}</span>
      <IconButton
        icon={Copy}
        label={`Copy ${link.targetKind} id ${link.targetId}`}
        variant="sm"
        onClick={() => {
          copyToClipboard(link.targetId);
        }}
      />
    </span>
  );
}

function TraceSection({ group }: { readonly group: TraceGroup }): ReactNode {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid gap-1.5">
      <h3
        id={headingId}
        className="font-mono text-[10px] uppercase tracking-[0.1em] text-fg-subtle"
      >
        {group.label}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {group.links.map((link) => (
          <TraceChip key={link.id} link={link} />
        ))}
      </div>
    </section>
  );
}

export interface TestCaseTraceabilityPanelProps {
  readonly traceLinks: readonly TestCaseTraceLinkRecord[];
  readonly currentVersionId: string;
}

export function TestCaseTraceabilityPanel({
  traceLinks,
  currentVersionId,
}: TestCaseTraceabilityPanelProps): ReactNode {
  const groups = groupLinks(traceLinks);

  if (groups.length === 0 && traceLinks.length === 0) {
    return (
      <Panel title="Traceability">
        <div
          role="status"
          className="rounded-md border border-dashed border-border-subtle p-4 text-center font-mono text-xs text-fg-muted"
        >
          No traceability links recorded.
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Traceability">
      <div className="grid gap-3">
        {groups.map((group) => (
          <TraceSection key={group.kind} group={group} />
        ))}
        <div className="grid gap-1">
          <MetadataRow label="Source version" value={currentVersionId} />
        </div>
      </div>
    </Panel>
  );
}
