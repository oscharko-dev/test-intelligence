"use client";

import { useId, type ReactNode } from "react";
import { Badge } from "@/components/primitives/Badge";
import { Panel } from "@/components/primitives/Panel";
import { TextField } from "@/components/primitives/TextField";
import type { TestCaseVersionRecord } from "@/lib/server/storage/types";
import { cx, ui } from "@/lib/ui-classes";

export interface TestCaseDetailEditorProps {
  readonly version: TestCaseVersionRecord;
}

const NOOP = (): void => undefined;

function DisabledTextArea({
  label,
  value,
  rows = 3,
}: {
  readonly label: string;
  readonly value: string;
  readonly rows?: number;
}): ReactNode {
  const id = useId();
  return (
    <div className={ui.field.root}>
      <label htmlFor={id} className={ui.field.label}>
        <span>{label}</span>
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        disabled
        onChange={NOOP}
        className={cx(
          ui.field.input,
          ui.field.disabled,
          "min-h-[64px] resize-y",
        )}
        aria-readonly="true"
      />
    </div>
  );
}

function ReadOnlyList({
  label,
  values,
  emptyText,
}: {
  readonly label: string;
  readonly values: readonly string[];
  readonly emptyText: string;
}): ReactNode {
  const groupId = useId();
  if (values.length === 0) {
    return (
      <div className="grid gap-1">
        <span id={groupId} className="text-xs font-medium text-fg-default">
          {label}
        </span>
        <span
          role="status"
          className="text-xs italic text-fg-subtle"
          aria-labelledby={groupId}
        >
          {emptyText}
        </span>
      </div>
    );
  }
  return (
    <div role="group" aria-labelledby={groupId} className="grid gap-1.5">
      <span id={groupId} className="text-xs font-medium text-fg-default">
        {label}
      </span>
      <ol className="m-0 grid list-none gap-1 p-0">
        {values.map((value, index) => (
          <li
            key={`${index}-${value}`}
            className="grid grid-cols-[28px_1fr] items-center gap-2 rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-xs"
          >
            <span className="font-mono text-[11px] text-fg-muted">
              {index + 1}
            </span>
            <input
              type="text"
              value={value}
              disabled
              onChange={NOOP}
              className={cx(ui.field.input, ui.field.disabled, "py-1")}
              aria-label={`${label} item ${index + 1}`}
              aria-readonly="true"
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepsList({
  steps,
}: {
  readonly steps: TestCaseVersionRecord["steps"];
}): ReactNode {
  const groupId = useId();
  if (steps.length === 0) {
    return (
      <div className="grid gap-1">
        <span id={groupId} className="text-xs font-medium text-fg-default">
          Steps
        </span>
        <span
          role="status"
          className="text-xs italic text-fg-subtle"
          aria-labelledby={groupId}
        >
          No steps recorded.
        </span>
      </div>
    );
  }
  return (
    <div role="group" aria-labelledby={groupId} className="grid gap-1.5">
      <span id={groupId} className="text-xs font-medium text-fg-default">
        Steps
      </span>
      <ol className="m-0 grid list-none gap-2 p-0">
        {steps.map((step, index) => (
          <li
            key={`${index}-${step.action}`}
            className="grid grid-cols-[28px_1fr] items-start gap-2 rounded-md border border-border-subtle bg-bg-input px-2 py-2"
          >
            <span className="pt-1.5 font-mono text-[11px] text-fg-muted">
              {index + 1}
            </span>
            <div className="grid gap-1.5">
              <input
                type="text"
                value={step.action}
                disabled
                onChange={NOOP}
                className={cx(ui.field.input, ui.field.disabled, "py-1")}
                aria-label={`Step ${index + 1} action`}
                aria-readonly="true"
              />
              <input
                type="text"
                value={step.expected}
                disabled
                onChange={NOOP}
                className={cx(ui.field.input, ui.field.disabled, "py-1")}
                aria-label={`Step ${index + 1} expected result`}
                aria-readonly="true"
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TagsChips({ tags }: { readonly tags: readonly string[] }): ReactNode {
  const groupId = useId();
  if (tags.length === 0) {
    return (
      <div className="grid gap-1">
        <span id={groupId} className="text-xs font-medium text-fg-default">
          Tags
        </span>
        <span className="text-xs italic text-fg-subtle">No tags recorded.</span>
      </div>
    );
  }
  return (
    <div role="group" aria-labelledby={groupId} className="grid gap-1">
      <span id={groupId} className="text-xs font-medium text-fg-default">
        Tags
      </span>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span key={tag} className={ui.chip.base}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TestCaseDetailEditor({
  version,
}: TestCaseDetailEditorProps): ReactNode {
  const hasDescription =
    version.description !== undefined && version.description.length > 0;
  return (
    <Panel title="Editor">
      <div
        role="status"
        aria-live="polite"
        className="mb-3 rounded-md border border-dashed border-border-subtle bg-bg-input px-3 py-2 font-mono text-[11px] text-fg-muted"
      >
        Editing is read-only until the next release ships the save flow (issue
        #58). The fields below show the persisted current version.
      </div>
      <div className="grid gap-3">
        <TextField
          label="Title"
          value={version.title}
          onChange={NOOP}
          disabled
        />
        <DisabledTextArea
          label="Objective"
          value={version.objective}
          rows={3}
        />
        {hasDescription && (
          <DisabledTextArea
            label="Description"
            value={version.description ?? ""}
            rows={4}
          />
        )}
        <ReadOnlyList
          label="Preconditions"
          values={version.preconditions}
          emptyText="No preconditions recorded."
        />
        <StepsList steps={version.steps} />
        <ReadOnlyList
          label="Test data"
          values={version.testData}
          emptyText="No test data recorded."
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="grid gap-1">
            <span className="text-xs font-medium text-fg-default">
              Priority
            </span>
            <Badge variant="accent">
              {version.priority.length > 0 ? version.priority : "—"}
            </Badge>
          </div>
          <div className="grid gap-1">
            <span className="text-xs font-medium text-fg-default">Risk</span>
            <Badge variant="warn">
              {version.risk.length > 0 ? version.risk : "—"}
            </Badge>
          </div>
        </div>
        <TagsChips tags={version.tags} />
      </div>
    </Panel>
  );
}
