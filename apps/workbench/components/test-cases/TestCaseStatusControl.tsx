"use client";

import { useId, useState, type ReactNode } from "react";
import { Badge, type BadgeVariant } from "@/components/primitives/Badge";
import { Panel } from "@/components/primitives/Panel";
import type {
  PersistedTestCaseDetail,
  TestCaseLifecycleStatus,
} from "@/lib/server/storage/types";
import { cx, ui } from "@/lib/ui-classes";
import { transitionTestCaseStatus } from "./api-mutations";

export interface TestCaseStatusControlProps {
  readonly status: TestCaseLifecycleStatus;
  readonly caseId: string;
  readonly onTransition: (detail: PersistedTestCaseDetail) => void;
}

const STATUS_VARIANT: Record<TestCaseLifecycleStatus, BadgeVariant> = {
  draft: "neutral",
  reviewed: "info",
  approved: "success",
};

const NEXT_STATES: Record<
  TestCaseLifecycleStatus,
  readonly TestCaseLifecycleStatus[]
> = {
  draft: ["reviewed", "approved"],
  reviewed: ["approved"],
  approved: [],
};

const TRANSITION_LABEL: Record<TestCaseLifecycleStatus, string> = {
  draft: "Mark as Draft",
  reviewed: "Mark as Reviewed",
  approved: "Mark as Approved",
};

type PanelState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "confirming";
      readonly target: TestCaseLifecycleStatus;
    }
  | {
      readonly kind: "saving";
      readonly target: TestCaseLifecycleStatus;
    }
  | {
      readonly kind: "error";
      readonly target: TestCaseLifecycleStatus;
      readonly message: string;
    };

export function TestCaseStatusControl({
  status,
  caseId,
  onTransition,
}: TestCaseStatusControlProps): ReactNode {
  const [panel, setPanel] = useState<PanelState>({ kind: "idle" });
  const [changeReason, setChangeReason] = useState("");
  const reasonId = useId();
  const errorId = useId();

  const nextStates = NEXT_STATES[status];

  const openConfirm = (target: TestCaseLifecycleStatus): void => {
    setChangeReason("");
    setPanel({ kind: "confirming", target });
  };

  const cancel = (): void => {
    setPanel({ kind: "idle" });
    setChangeReason("");
  };

  const confirm = async (target: TestCaseLifecycleStatus): Promise<void> => {
    setPanel({ kind: "saving", target });
    const reason = changeReason.trim().length > 0 ? changeReason : undefined;
    const result = await transitionTestCaseStatus(caseId, target, reason);
    if (result.ok) {
      setPanel({ kind: "idle" });
      setChangeReason("");
      onTransition(result.detail);
      return;
    }
    const message =
      result.kind === "invalid-transition"
        ? result.message
        : result.error.message;
    setPanel({ kind: "error", target, message });
  };

  const isSaving = panel.kind === "saving";
  const activeTarget =
    panel.kind === "confirming" ||
    panel.kind === "saving" ||
    panel.kind === "error"
      ? panel.target
      : undefined;
  const errorMessage = panel.kind === "error" ? panel.message : undefined;

  return (
    <Panel title="Status">
      <div className="grid gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">Current:</span>
          <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
        </div>

        {nextStates.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {nextStates.map((next) => (
              <button
                key={next}
                type="button"
                className={ui.button.base}
                disabled={isSaving || panel.kind === "confirming"}
                aria-label={TRANSITION_LABEL[next]}
                onClick={() => {
                  openConfirm(next);
                }}
              >
                {TRANSITION_LABEL[next]}
              </button>
            ))}
          </div>
        )}

        {nextStates.length === 0 && (
          <p className="text-xs italic text-fg-subtle">
            This test case is approved. No further transitions are available.
          </p>
        )}

        {activeTarget !== undefined && (
          <div className="grid gap-2 rounded-md border border-border-subtle bg-bg-input p-3">
            <div>
              <label
                htmlFor={reasonId}
                className="mb-1 block text-xs font-medium text-fg-default"
              >
                Change reason{" "}
                <span className="font-normal text-fg-muted">(optional)</span>
              </label>
              <textarea
                id={reasonId}
                rows={2}
                maxLength={500}
                value={changeReason}
                onChange={(e) => {
                  setChangeReason(e.target.value);
                }}
                disabled={isSaving}
                aria-label="Change reason for status transition"
                className={cx(
                  ui.field.input,
                  "resize-y",
                  isSaving && ui.field.disabled,
                )}
                placeholder="Optional note about why the status is changing…"
              />
              <span className="mt-0.5 block text-right font-mono text-[10px] text-fg-muted">
                {changeReason.length} / 500
              </span>
            </div>
            {errorMessage !== undefined && (
              <p id={errorId} role="alert" className="text-xs text-danger">
                {errorMessage}
              </p>
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={isSaving}
                className={cx(ui.button.base, ui.button.primary)}
                aria-label={`Confirm ${TRANSITION_LABEL[activeTarget]}`}
                onClick={() => {
                  void confirm(activeTarget);
                }}
              >
                {isSaving ? "Saving…" : "Confirm"}
              </button>
              <button
                type="button"
                disabled={isSaving}
                className={cx(ui.button.base, ui.button.ghost)}
                aria-label="Cancel status transition"
                onClick={cancel}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
