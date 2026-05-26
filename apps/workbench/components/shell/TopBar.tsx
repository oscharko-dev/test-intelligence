"use client";

import type { ReactNode } from "react";
import { GitBranch } from "lucide-react";
import Image from "next/image";
import { StatusChip } from "@/components/primitives/StatusChip";
import { cx, ui } from "@/lib/ui-classes";
import { useWorkbench } from "@/lib/workbench-context";

export function TopBar(): ReactNode {
  const { runState } = useWorkbench();
  const active = runState.status !== "idle";
  return (
    <header role="banner" className={ui.topbar.root}>
      <span className={ui.topbar.mark}>
        <Image
          src="/keiko-logo.svg"
          alt="Test-Intelligence Logo"
          width={23}
          height={23}
          className={ui.topbar.logo}
          priority={false}
        />
        <span className={ui.topbar.brandText}>Test-Intelligence</span>
        <span className={ui.topbar.subtle}>· workbench</span>
      </span>
      <span className={ui.topbar.sep} aria-hidden />
      <span className={ui.topbar.workspace} title="Active workspace">
        <GitBranch size={12} aria-hidden focusable={false} />
        <span>
          <b className={ui.topbar.workspaceStrong}>workspace</b>/eu-north-1
        </span>
        <span className={ui.topbar.subtle}>·</span>
        <span>contract {runState.contractVersion}</span>
      </span>
      <span className={ui.topbar.sep} aria-hidden />
      {active ? (
        <span className={ui.topbar.inline}>
          <StatusChip state={runState.status} />
          {runState.jobId !== null && (
            <span className={ui.topbar.subtle}>{runState.jobId}</span>
          )}
        </span>
      ) : (
        <span className={cx(ui.topbar.inline, ui.topbar.subtle)}>
          <StatusChip state="idle" />
          <span>no active run</span>
        </span>
      )}
      <span className={ui.topbar.spacer} />
    </header>
  );
}
