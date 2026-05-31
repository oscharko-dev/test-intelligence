"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/primitives/Badge";
import { Panel } from "@/components/primitives/Panel";
import type { TestCaseVersionRecord } from "@/lib/server/storage/types";
import { cx } from "@/lib/ui-classes";
import { listTestCaseVersions } from "./api";

export interface TestCaseVersionHistoryProps {
  readonly caseId: string;
  readonly currentVersionId: string;
  readonly selectedVersionId?: string;
  readonly onSelectVersion?: (versionId: string) => void;
}

type LoadState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly versions: readonly TestCaseVersionRecord[];
    }
  | { readonly kind: "error"; readonly message: string };

const CHANGE_REASON_MAX = 80;

const truncate = (text: string): string =>
  text.length <= CHANGE_REASON_MAX
    ? text
    : `${text.slice(0, CHANGE_REASON_MAX)}…`;

const formatRelative = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

function VersionRow({
  version,
  isCurrent,
  isSelected,
  onSelect,
}: {
  readonly version: TestCaseVersionRecord;
  readonly isCurrent: boolean;
  readonly isSelected: boolean;
  readonly onSelect: (id: string) => void;
}): ReactNode {
  const reason = version.changeReason;
  const isTruncated = reason !== undefined && reason.length > CHANGE_REASON_MAX;

  return (
    <li>
      <button
        type="button"
        aria-label={`Version ${version.versionIndex}${isCurrent ? " (current)" : ""}`}
        aria-pressed={isSelected}
        onClick={() => {
          onSelect(version.id);
        }}
        className={cx(
          "w-full rounded-md border px-2.5 py-2 text-left transition-colors duration-75",
          isSelected
            ? "border-accent bg-[hsl(210_60%_14%_/_0.6)]"
            : "border-border-subtle bg-bg-input hover:border-border-strong hover:bg-bg-elev",
        )}
      >
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] font-semibold text-fg-default">
            v{version.versionIndex}
          </span>
          <Badge
            variant={version.source === "generated" ? "neutral" : "accent"}
          >
            {version.source}
          </Badge>
          {isCurrent && <Badge variant="success">current</Badge>}
          <span className="ml-auto font-mono text-[10px] text-fg-muted">
            {formatRelative(version.createdAt)}
          </span>
        </div>
        {reason !== undefined && reason.length > 0 && (
          <p
            className="mt-1 font-mono text-[10px] text-fg-muted"
            {...(isTruncated ? { title: reason } : {})}
          >
            {truncate(reason)}
          </p>
        )}
      </button>
    </li>
  );
}

export function TestCaseVersionHistory({
  caseId,
  currentVersionId,
  selectedVersionId,
  onSelectVersion,
}: TestCaseVersionHistoryProps): ReactNode {
  // WHY initialise to "loading" instead of setting it inside the effect:
  // setState inside an effect body triggers a cascading render. The first
  // render already sees the loading state, so the effect only needs to
  // update once the fetch resolves.
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listTestCaseVersions(caseId);
      if (cancelled) return;
      if (result.ok) {
        setState({ kind: "ready", versions: result.versions });
      } else {
        setState({ kind: "error", message: result.error.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  // Selection is derived directly from props — no state mirror, no effect.
  const effectiveSelected = selectedVersionId ?? currentVersionId;

  const handleSelect = (id: string): void => {
    onSelectVersion?.(id);
  };

  if (state.kind === "loading") {
    return (
      <Panel title="Version history">
        <div
          role="status"
          aria-live="polite"
          className="py-2 text-center font-mono text-xs text-fg-muted"
        >
          Loading…
        </div>
      </Panel>
    );
  }

  if (state.kind === "error") {
    return (
      <Panel title="Version history">
        <div role="alert" className="text-xs text-danger">
          {state.message}
        </div>
      </Panel>
    );
  }

  if (state.versions.length === 0) {
    return (
      <Panel title="Version history">
        <div
          role="status"
          className="py-2 text-center font-mono text-xs italic text-fg-muted"
        >
          No versions recorded.
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Version history">
      <ol className="m-0 grid list-none gap-1.5 p-0">
        {state.versions.map((version) => (
          <VersionRow
            key={version.id}
            version={version}
            isCurrent={version.id === currentVersionId}
            isSelected={version.id === effectiveSelected}
            onSelect={handleSelect}
          />
        ))}
      </ol>
    </Panel>
  );
}
