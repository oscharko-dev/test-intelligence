import type { ReactNode } from "react";
import { AlertTriangle, Check, X, Zap } from "lucide-react";
import { STAGE_ORDER } from "@/lib/run-state";
import type { RunStatus, StageData, StageName } from "@/lib/types";
import { cx, ui } from "@/lib/ui-classes";

const LABELS: Record<StageName, string> = {
  generator: "Generator",
  judge: "Logic judge",
  visual_sidecar: "Visual sidecar",
  policy_gate: "Policy gate",
};

export interface StageCardProps {
  name: StageName;
  data: StageData;
  activeStage: StageName | undefined;
  runStatus: RunStatus;
}

export function StageCard({
  name,
  data,
  activeStage,
  runStatus,
}: StageCardProps): ReactNode {
  const idx = STAGE_ORDER.indexOf(name);
  const activeIdx =
    activeStage !== undefined ? STAGE_ORDER.indexOf(activeStage) : -1;

  let cls: string | null = null;
  if (data.outcome === "clean") cls = ui.runDetail.stageDone;
  else if (data.outcome === "failed" || data.outcome === "blocked") {
    cls = ui.runDetail.stageFail;
  } else if (idx === activeIdx) cls = ui.runDetail.stageActive;

  return (
    <div className={cx(ui.runDetail.stage, cls)}>
      <div className={ui.runDetail.stageHead}>
        <span className={ui.runDetail.stageName}>{LABELS[name]}</span>
        <span>{name}</span>
      </div>
      <div className={ui.runDetail.metrics}>
        <div className={ui.runDetail.metric}>
          <span className={ui.runDetail.metricLabel}>attempts</span>
          <b className={ui.runDetail.metricValue}>{data.attempts}</b>
        </div>
        <div className={cx(ui.runDetail.metric, ui.runDetail.metricOk)}>
          <span className={ui.runDetail.metricLabel}>success</span>
          <b className={cx(ui.runDetail.metricValue, ui.runDetail.metricOk)}>
            {data.successes}
          </b>
        </div>
        <div
          className={cx(
            ui.runDetail.metric,
            data.failures > 0 && ui.runDetail.metricFail,
          )}
        >
          <span className={ui.runDetail.metricLabel}>failures</span>
          <b
            className={cx(
              ui.runDetail.metricValue,
              data.failures > 0 && ui.runDetail.metricFail,
            )}
          >
            {data.failures}
          </b>
        </div>
      </div>
      <div className={ui.runDetail.outcome}>
        <span>outcome</span>
        <StageOutcomeLabel
          outcome={data.outcome}
          inFlight={idx === activeIdx && runStatus !== "idle"}
        />
      </div>
    </div>
  );
}

function StageOutcomeLabel({
  outcome,
  inFlight,
}: {
  outcome: StageData["outcome"];
  inFlight: boolean;
}): ReactNode {
  if (outcome === "clean") {
    return (
      <span className={ui.runDetail.outcomeOk}>
        <Check size={12} aria-hidden focusable={false} /> clean
      </span>
    );
  }
  if (outcome === "blocked") {
    return (
      <span className={ui.runDetail.outcomeDanger}>
        <AlertTriangle size={12} aria-hidden focusable={false} /> blocked
      </span>
    );
  }
  if (outcome === "failed") {
    return (
      <span className={ui.runDetail.outcomeDanger}>
        <X size={12} aria-hidden focusable={false} /> failed
      </span>
    );
  }
  if (inFlight) {
    return (
      <span className={ui.runDetail.outcomeInflight}>
        <Zap size={12} aria-hidden focusable={false} /> in&nbsp;flight
      </span>
    );
  }
  return <span className={ui.runDetail.outcomePending}>pending</span>;
}
