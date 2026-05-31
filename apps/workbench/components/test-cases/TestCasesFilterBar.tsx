"use client";

import { useId, type ReactNode } from "react";
import { SelectField } from "@/components/primitives/SelectField";
import type {
  TestCaseLifecycleStatus,
  TestCaseSummary,
} from "@/lib/server/storage/types";
import { cx, ui } from "@/lib/ui-classes";

const LIFECYCLE_OPTIONS: readonly TestCaseLifecycleStatus[] = [
  "draft",
  "reviewed",
  "approved",
];

export interface TestCasesFilters {
  readonly runId: string;
  readonly snapshotId: string;
  readonly lifecycle: TestCaseLifecycleStatus | "";
  readonly versionStatus: string;
  readonly priority: string;
  readonly risk: string;
  readonly tags: readonly string[];
}

export const EMPTY_FILTERS: TestCasesFilters = {
  runId: "",
  snapshotId: "",
  lifecycle: "",
  versionStatus: "",
  priority: "",
  risk: "",
  tags: [],
};

export interface TestCasesFilterBarProps {
  readonly summaries: readonly TestCaseSummary[];
  readonly filters: TestCasesFilters;
  readonly onChange: (next: TestCasesFilters) => void;
}

const distinct = (values: Iterable<string>): readonly string[] => {
  const seen = new Set<string>();
  for (const value of values) {
    if (value.length > 0) seen.add(value);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
};

const groupFor = (
  summaries: readonly TestCaseSummary[],
  picker: (row: TestCaseSummary) => string,
): readonly string[] => distinct(summaries.map(picker));

const tagSet = (summaries: readonly TestCaseSummary[]): readonly string[] =>
  distinct(summaries.flatMap((row) => row.tags));

const snapshotSet = (
  summaries: readonly TestCaseSummary[],
): readonly string[] => distinct(summaries.flatMap((row) => row.snapshotIds));

function toggleTag(current: readonly string[], tag: string): readonly string[] {
  return current.includes(tag)
    ? current.filter((t) => t !== tag)
    : [...current, tag];
}

function ChipGroup({
  label,
  options,
  value,
  onSelect,
}: {
  readonly label: string;
  readonly options: readonly string[];
  readonly value: string;
  readonly onSelect: (next: string) => void;
}): ReactNode {
  const groupId = useId();
  if (options.length === 0) return null;
  return (
    <div role="group" aria-labelledby={groupId} className="grid gap-1">
      <span id={groupId} className="text-xs font-medium text-fg-default">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                onSelect(selected ? "" : option);
              }}
              className={cx(ui.chip.base, selected && ui.chip.running)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TagsGroup({
  options,
  selected,
  onToggle,
}: {
  readonly options: readonly string[];
  readonly selected: readonly string[];
  readonly onToggle: (tag: string) => void;
}): ReactNode {
  const groupId = useId();
  if (options.length === 0) return null;
  return (
    <div role="group" aria-labelledby={groupId} className="grid gap-1">
      <span id={groupId} className="text-xs font-medium text-fg-default">
        Tags
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((tag) => {
          const isOn = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={isOn}
              onClick={() => {
                onToggle(tag);
              }}
              className={cx(ui.chip.base, isOn && ui.chip.running)}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TestCasesFilterBar({
  summaries,
  filters,
  onChange,
}: TestCasesFilterBarProps): ReactNode {
  const runOptions = groupFor(summaries, (row) => row.sourceRunId);
  const snapshotOptions = snapshotSet(summaries);
  const lifecycleOptions = LIFECYCLE_OPTIONS;
  const versionStatusOptions = groupFor(summaries, (row) => row.versionStatus);
  const priorityOptions = groupFor(summaries, (row) => row.priority);
  const riskOptions = groupFor(summaries, (row) => row.risk);
  const tagOptions = tagSet(summaries);

  return (
    <section
      aria-label="Test case filters"
      className="grid gap-3 rounded-md border border-border-subtle bg-bg-panel p-3"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SelectField
          label="Run"
          value={filters.runId}
          onChange={(next) => {
            onChange({ ...filters, runId: next });
          }}
          options={[
            { value: "", label: "All runs" },
            ...runOptions.map((id) => ({ value: id, label: id })),
          ]}
        />
        <SelectField
          label="Snapshot"
          value={filters.snapshotId}
          onChange={(next) => {
            onChange({ ...filters, snapshotId: next });
          }}
          options={[
            { value: "", label: "All snapshots" },
            ...snapshotOptions.map((id) => ({ value: id, label: id })),
          ]}
        />
      </div>
      <ChipGroup
        label="Lifecycle status"
        options={lifecycleOptions}
        value={filters.lifecycle}
        onSelect={(next) => {
          onChange({
            ...filters,
            lifecycle: (next === ""
              ? ""
              : (next as TestCaseLifecycleStatus)) as TestCasesFilters["lifecycle"],
          });
        }}
      />
      <ChipGroup
        label="Version status"
        options={versionStatusOptions}
        value={filters.versionStatus}
        onSelect={(next) => {
          onChange({ ...filters, versionStatus: next });
        }}
      />
      <ChipGroup
        label="Priority"
        options={priorityOptions}
        value={filters.priority}
        onSelect={(next) => {
          onChange({ ...filters, priority: next });
        }}
      />
      <ChipGroup
        label="Risk"
        options={riskOptions}
        value={filters.risk}
        onSelect={(next) => {
          onChange({ ...filters, risk: next });
        }}
      />
      <TagsGroup
        options={tagOptions}
        selected={filters.tags}
        onToggle={(tag) => {
          onChange({ ...filters, tags: toggleTag(filters.tags, tag) });
        }}
      />
    </section>
  );
}
