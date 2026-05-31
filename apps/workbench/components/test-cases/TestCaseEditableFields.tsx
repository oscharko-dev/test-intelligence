"use client";

import { useId, type ReactNode } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { IconButton } from "@/components/primitives/IconButton";
import type {
  TestCaseStepRecord,
  TestCaseTraceLinkRecord,
} from "@/lib/server/storage/types";
import type { PlausibilityWarning } from "@/lib/server/test-case-plausibility";
import { cx, ui } from "@/lib/ui-classes";
import type { TestCaseValidationError } from "./test-case-draft-validation";

export function FieldError({
  id,
  message,
}: {
  readonly id: string;
  readonly message: string;
}): ReactNode {
  return (
    <span id={id} role="alert" className={cx(ui.field.hint, ui.field.hintErr)}>
      {message}
    </span>
  );
}

export function EditableList({
  label,
  values,
  onChange,
}: {
  readonly label: string;
  readonly values: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}): ReactNode {
  const groupId = useId();
  const add = (): void => {
    onChange([...values, ""]);
  };
  const remove = (index: number): void => {
    onChange(values.filter((_, i) => i !== index));
  };
  const update = (index: number, value: string): void => {
    onChange(values.map((v, i) => (i === index ? value : v)));
  };
  return (
    <div role="group" aria-labelledby={groupId} className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <span id={groupId} className="text-xs font-medium text-fg-default">
          {label}
        </span>
        <button
          type="button"
          onClick={add}
          className={cx(
            ui.button.base,
            ui.button.ghost,
            "h-[22px] px-2 py-0 text-[11px]",
          )}
          aria-label={`Add ${label} item`}
        >
          <Plus size={11} aria-hidden focusable={false} />
          Add
        </button>
      </div>
      <ol className="m-0 grid list-none gap-1 p-0">
        {values.map((value, index) => (
          <li
            key={index}
            className="grid grid-cols-[28px_1fr_auto] items-center gap-2 rounded-md border border-border-subtle bg-bg-input px-2 py-1.5"
          >
            <span className="font-mono text-[11px] text-fg-muted">
              {index + 1}
            </span>
            <input
              type="text"
              value={value}
              onChange={(e) => {
                update(index, e.target.value);
              }}
              className={cx(ui.field.input, "py-1")}
              aria-label={`${label} item ${index + 1}`}
            />
            <IconButton
              icon={Trash2}
              label={`Remove ${label} item ${index + 1}`}
              variant="sm"
              onClick={() => {
                remove(index);
              }}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepRow({
  index,
  step,
  errors,
  onUpdateAction,
  onUpdateExpected,
  onRemove,
}: {
  readonly index: number;
  readonly step: TestCaseStepRecord;
  readonly errors: readonly TestCaseValidationError[];
  readonly onUpdateAction: (index: number, value: string) => void;
  readonly onUpdateExpected: (index: number, value: string) => void;
  readonly onRemove: (index: number) => void;
}): ReactNode {
  const actionError = errors.find((e) => e.field === `steps[${index}].action`);
  const expectedError = errors.find(
    (e) => e.field === `steps[${index}].expected`,
  );
  const actionErrId = `step-${index}-action-err`;
  const expectedErrId = `step-${index}-expected-err`;
  return (
    <li className="grid grid-cols-[28px_1fr_auto] items-start gap-2 rounded-md border border-border-subtle bg-bg-input px-2 py-2">
      <span className="pt-1.5 font-mono text-[11px] text-fg-muted">
        {index + 1}
      </span>
      <div className="grid gap-1.5">
        <div>
          <textarea
            rows={2}
            value={step.action}
            onChange={(e) => {
              onUpdateAction(index, e.target.value);
            }}
            className={cx(
              ui.field.input,
              "resize-y py-1",
              actionError !== undefined && ui.field.invalid,
            )}
            aria-label={`Step ${index + 1} action`}
            aria-invalid={actionError !== undefined ? true : undefined}
            {...(actionError !== undefined
              ? { "aria-describedby": actionErrId }
              : {})}
          />
          {actionError !== undefined && (
            <FieldError id={actionErrId} message={actionError.message} />
          )}
        </div>
        <div>
          <textarea
            rows={2}
            value={step.expected}
            onChange={(e) => {
              onUpdateExpected(index, e.target.value);
            }}
            className={cx(
              ui.field.input,
              "resize-y py-1",
              expectedError !== undefined && ui.field.invalid,
            )}
            aria-label={`Step ${index + 1} expected result`}
            aria-invalid={expectedError !== undefined ? true : undefined}
            {...(expectedError !== undefined
              ? { "aria-describedby": expectedErrId }
              : {})}
          />
          {expectedError !== undefined && (
            <FieldError id={expectedErrId} message={expectedError.message} />
          )}
        </div>
      </div>
      <IconButton
        icon={Trash2}
        label={`Remove step ${index + 1}`}
        variant="sm"
        onClick={() => {
          onRemove(index);
        }}
      />
    </li>
  );
}

export function EditableSteps({
  steps,
  onChange,
  errors,
}: {
  readonly steps: readonly TestCaseStepRecord[];
  readonly onChange: (next: readonly TestCaseStepRecord[]) => void;
  readonly errors: readonly TestCaseValidationError[];
}): ReactNode {
  const groupId = useId();
  const stepsErrorId = useId();
  const stepsError = errors.find((e) => e.field === "steps");

  const add = (): void => {
    onChange([...steps, { action: "", expected: "" }]);
  };
  const remove = (index: number): void => {
    onChange(steps.filter((_, i) => i !== index));
  };
  const updateAction = (index: number, value: string): void => {
    onChange(steps.map((s, i) => (i === index ? { ...s, action: value } : s)));
  };
  const updateExpected = (index: number, value: string): void => {
    onChange(
      steps.map((s, i) => (i === index ? { ...s, expected: value } : s)),
    );
  };

  return (
    <div role="group" aria-labelledby={groupId} className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <span id={groupId} className="text-xs font-medium text-fg-default">
          Steps
        </span>
        <button
          type="button"
          onClick={add}
          className={cx(
            ui.button.base,
            ui.button.ghost,
            "h-[22px] px-2 py-0 text-[11px]",
          )}
          aria-label="Add step"
        >
          <Plus size={11} aria-hidden focusable={false} />
          Add step
        </button>
      </div>
      {stepsError !== undefined && (
        <FieldError id={stepsErrorId} message={stepsError.message} />
      )}
      <ol
        className="m-0 grid list-none gap-2 p-0"
        {...(stepsError !== undefined
          ? { "aria-describedby": stepsErrorId }
          : {})}
      >
        {steps.map((step, index) => (
          <StepRow
            key={index}
            index={index}
            step={step}
            errors={errors}
            onUpdateAction={updateAction}
            onUpdateExpected={updateExpected}
            onRemove={remove}
          />
        ))}
      </ol>
    </div>
  );
}

export function TraceLinkEditor({
  traceLinks,
  onChange,
  errorId,
  errorMessage,
}: {
  readonly traceLinks: readonly TestCaseTraceLinkRecord[];
  readonly onChange: (next: readonly TestCaseTraceLinkRecord[]) => void;
  readonly errorId: string;
  readonly errorMessage?: string;
}): ReactNode {
  const groupId = useId();
  const remove = (id: string): void => {
    onChange(traceLinks.filter((l) => l.id !== id));
  };
  return (
    <div role="group" aria-labelledby={groupId} className="grid gap-1.5">
      <span id={groupId} className="text-xs font-medium text-fg-default">
        Trace links
      </span>
      {errorMessage !== undefined && (
        <FieldError id={errorId} message={errorMessage} />
      )}
      {traceLinks.length === 0 ? (
        <span
          role="status"
          aria-describedby={errorId}
          className="text-xs italic text-fg-subtle"
        >
          No trace links — at least one is required.
        </span>
      ) : (
        <div className="flex flex-wrap gap-1.5" aria-describedby={errorId}>
          {traceLinks.map((link) => (
            <span key={link.id} className={ui.chip.base}>
              <span className="text-[10px] text-fg-muted">
                {link.targetKind}
              </span>
              <span className="text-fg-default">{link.targetId}</span>
              <button
                type="button"
                onClick={() => {
                  remove(link.id);
                }}
                aria-label={`Remove trace link ${link.targetKind} ${link.targetId}`}
                className="ml-0.5 inline-grid h-[14px] w-[14px] place-items-center rounded-full border-0 bg-transparent text-fg-muted hover:text-fg-default"
              >
                <X size={10} aria-hidden focusable={false} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function WarningsStrip({
  warnings,
  onDismiss,
}: {
  readonly warnings: readonly PlausibilityWarning[];
  readonly onDismiss: () => void;
}): ReactNode {
  if (warnings.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 grid gap-1 rounded-md border border-[hsl(38_50%_28%)] bg-[hsl(38_60%_12%_/_0.4)] px-3 py-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-warn">
          Plausibility warnings
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss plausibility warnings"
          className={cx(
            ui.button.base,
            ui.button.ghost,
            "h-[22px] px-2 py-0 text-[11px]",
          )}
        >
          Dismiss
        </button>
      </div>
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {warnings.map((w) => (
          <li
            key={`${w.targetKind}-${w.targetId}`}
            className="font-mono text-[11px] text-warn"
          >
            {w.targetKind} {w.targetId}: {w.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
