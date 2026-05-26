import type { ReactNode } from "react";
import type { RunStatus } from "@/lib/types";
import { cx, ui } from "@/lib/ui-classes";

const STATE_LABEL: Record<RunStatus, string> = {
  idle: "idle",
  queued: "queued",
  running: "running",
  judging: "judging",
  "policy-gate": "policy-gate",
  sealed: "sealed",
  clean: "clean",
  blocked: "blocked",
  blocked_failure: "blocked·failure",
  failed: "failed",
  degraded: "degraded",
};

export interface StatusChipProps {
  state: RunStatus;
  className?: string;
}

export function StatusChip({
  state,
  className,
}: StatusChipProps): ReactNode {
  const tone = toneForState(state);
  const dot = dotForState(state);
  return (
    <span className={cx(ui.chip.base, state, tone, className)}>
      <span className={cx(ui.chip.dot, dot)} />
      <span>{STATE_LABEL[state]}</span>
    </span>
  );
}

function toneForState(state: RunStatus): string {
  switch (state) {
    case "running":
      return ui.chip.running;
    case "judging":
      return ui.chip.judging;
    case "policy-gate":
      return ui.chip.policyGate;
    case "sealed":
    case "clean":
      return ui.chip.ok;
    case "blocked":
    case "blocked_failure":
    case "failed":
      return ui.chip.danger;
    case "degraded":
      return ui.chip.degraded;
    default:
      return ui.chip.idle;
  }
}

function dotForState(state: RunStatus): string | null {
  switch (state) {
    case "running":
      return ui.chip.dotRun;
    case "judging":
      return ui.chip.dotInfo;
    case "policy-gate":
      return ui.chip.dotWarn;
    case "sealed":
    case "clean":
      return ui.chip.dotOk;
    case "blocked":
    case "blocked_failure":
    case "failed":
      return ui.chip.dotDanger;
    case "degraded":
      return ui.chip.dotWarn;
    default:
      return null;
  }
}
