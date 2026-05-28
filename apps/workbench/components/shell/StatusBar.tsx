"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Clock, Globe } from "lucide-react";
import { useWorkbench } from "@/lib/workbench-context";
import type { RunStatus } from "@/lib/types";
import { cx, ui } from "@/lib/ui-classes";

const INITIAL_CLOCK_LABEL = "--:--:--Z";

function dotClass(status: RunStatus): string {
  if (status === "idle") return "";
  if (status === "sealed" || status === "clean") return ui.statusbar.ok;
  if (
    status === "blocked" ||
    status === "failed" ||
    status === "blocked_failure"
  ) {
    return ui.statusbar.err;
  }
  return ui.statusbar.run;
}

export function StatusBar(): ReactNode {
  const { runState, lastRunAt, gatewayState } = useWorkbench();
  const time = useSyncExternalStore(
    subscribeClock,
    getClockSnapshot,
    getClockServerSnapshot,
  );

  return (
    <footer role="contentinfo" className={ui.statusbar.root}>
      <span className={ui.statusbar.segment}>
        <span className={cx(ui.statusbar.dot, ui.statusbar.info)} />
        contract {runState.contractVersion}
      </span>
      <span className={ui.statusbar.segment}>
        <Globe size={11} aria-hidden focusable={false} />
        region eu-north-1
      </span>
      <span className={ui.statusbar.segment}>
        <span
          className={cx(
            ui.statusbar.dot,
            gatewayState === "ok"
              ? ui.statusbar.ok
              : gatewayState === "warn"
                ? ui.statusbar.warn
                : ui.statusbar.err,
          )}
        />
        gateway {gatewayState === "ok" ? "reachable" : gatewayState}
      </span>
      <span className={ui.statusbar.segment}>
        <span className={cx(ui.statusbar.dot, dotClass(runState.status))} />
        {runState.status !== "idle" ? (
          <>
            run {runState.jobId ?? ""} · {runState.status}
          </>
        ) : (
          <>last run · {lastRunAt}</>
        )}
      </span>
      <span className={ui.statusbar.spacer} />
      <span className={cx(ui.statusbar.segment, ui.statusbar.muted)}>
        <span className={ui.statusbar.dim}>node</span>&nbsp;22.13.0
      </span>
      <span className={cx(ui.statusbar.segment, ui.statusbar.muted)}>
        <span className={ui.statusbar.dim}>workbench</span>&nbsp;0.0.0
      </span>
      <span className={ui.statusbar.segment}>
        <Clock size={11} aria-hidden focusable={false} />
        {time}
      </span>
    </footer>
  );
}

function formatTime(d: Date): string {
  return d.toISOString().slice(11, 19) + "Z";
}

function subscribeClock(onStoreChange: () => void): () => void {
  const timer = setInterval(onStoreChange, 1000);
  return () => {
    clearInterval(timer);
  };
}

function getClockSnapshot(): string {
  return formatTime(new Date());
}

function getClockServerSnapshot(): string {
  return INITIAL_CLOCK_LABEL;
}
