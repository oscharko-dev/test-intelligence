"use client";

import { useId, useState, type ReactNode } from "react";
import { TextField } from "@/components/primitives/TextField";
import type {
  PersistedTestCaseDetail,
  TestCaseStepRecord,
  TestCaseTraceLinkRecord,
  TestCaseVersionRecord,
} from "@/lib/server/storage/types";
import type { PlausibilityWarning } from "@/lib/server/test-case-plausibility";
import { cx, ui } from "@/lib/ui-classes";
import { appendTestCaseVersion, type AppendVersionBody } from "./api-mutations";
import {
  EditableList,
  EditableSteps,
  FieldError,
  TraceLinkEditor,
} from "./TestCaseEditableFields";
import {
  clientValidateDraft,
  type TestCaseValidationError,
} from "./test-case-draft-validation";

interface EditDraft {
  readonly title: string;
  readonly objective: string;
  readonly preconditions: readonly string[];
  readonly steps: readonly TestCaseStepRecord[];
  readonly testData: readonly string[];
  readonly priority: string;
  readonly risk: string;
  readonly tags: readonly string[];
  readonly description: string;
  readonly traceLinks: readonly TestCaseTraceLinkRecord[];
  readonly changeReason: string;
}

const draftFromVersion = (version: TestCaseVersionRecord): EditDraft => ({
  title: version.title,
  objective: version.objective,
  preconditions: [...version.preconditions],
  steps: [...version.steps],
  testData: [...version.testData],
  priority: version.priority,
  risk: version.risk,
  tags: [...version.tags],
  description: version.description ?? "",
  traceLinks: [...version.traceLinks],
  changeReason: "",
});

const buildBody = (draft: EditDraft, status: string): AppendVersionBody => ({
  title: draft.title,
  objective: draft.objective,
  preconditions: draft.preconditions,
  steps: draft.steps,
  testData: draft.testData,
  priority: draft.priority,
  risk: draft.risk,
  tags: draft.tags,
  status,
  traceTargets: draft.traceLinks.map((l) => ({
    targetKind: l.targetKind,
    targetId: l.targetId,
  })),
  ...(draft.description.trim().length > 0
    ? { description: draft.description }
    : {}),
  ...(draft.changeReason.trim().length > 0
    ? { changeReason: draft.changeReason }
    : {}),
});

type SaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | {
      readonly kind: "validation";
      readonly errors: readonly TestCaseValidationError[];
    }
  | { readonly kind: "error"; readonly message: string };

export interface SaveOutcome {
  readonly detail: PersistedTestCaseDetail;
  readonly warnings: readonly PlausibilityWarning[];
}

export interface TestCaseDetailEditorFormProps {
  readonly version: TestCaseVersionRecord;
  readonly caseId: string;
  readonly onSaved: (outcome: SaveOutcome) => void;
  readonly onCancel: () => void;
}

export function TestCaseDetailEditorForm({
  version,
  caseId,
  onSaved,
  onCancel,
}: TestCaseDetailEditorFormProps): ReactNode {
  const [draft, setDraft] = useState<EditDraft>(() =>
    draftFromVersion(version),
  );
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  const titleErrId = useId();
  const traceErrId = useId();
  const changeReasonId = useId();

  const clientErrors = clientValidateDraft({
    title: draft.title,
    steps: draft.steps,
    traceTargets: draft.traceLinks.map((l) => ({
      targetKind: l.targetKind,
      targetId: l.targetId,
    })),
  });

  const serverErrors = saveState.kind === "validation" ? saveState.errors : [];
  const errors: readonly TestCaseValidationError[] = [
    ...clientErrors,
    ...serverErrors,
  ];

  const titleError = errors.find((e) => e.field === "title");
  const traceError = errors.find((e) => e.field === "traceTargets");

  const isSaving = saveState.kind === "saving";
  const canSave = clientErrors.length === 0 && !isSaving;

  const handleSave = async (): Promise<void> => {
    if (clientErrors.length > 0) return;
    setSaveState({ kind: "saving" });
    const result = await appendTestCaseVersion(
      caseId,
      buildBody(draft, version.status),
    );
    if (result.ok) {
      setSaveState({ kind: "idle" });
      onSaved({ detail: result.detail, warnings: result.warnings });
      return;
    }
    if (result.kind === "validation") {
      setSaveState({ kind: "validation", errors: result.errors });
      return;
    }
    setSaveState({ kind: "error", message: result.error.message });
  };

  return (
    <div className="grid gap-3">
      {saveState.kind === "error" && (
        <div
          role="alert"
          className="mb-1 rounded-md border border-[hsl(0_50%_30%)] bg-[hsl(0_50%_12%_/_0.4)] px-3 py-2 font-mono text-xs text-danger"
        >
          {saveState.message}
        </div>
      )}

      <div>
        <TextField
          label="Title"
          required
          value={draft.title}
          onChange={(v) => {
            setDraft((d) => ({ ...d, title: v }));
          }}
          invalid={titleError !== undefined}
          {...(titleError !== undefined ? { describedBy: titleErrId } : {})}
        />
        {titleError !== undefined && (
          <FieldError id={titleErrId} message={titleError.message} />
        )}
      </div>

      <div className={ui.field.root}>
        <label className={ui.field.label}>
          <span>Objective</span>
        </label>
        <textarea
          rows={3}
          value={draft.objective}
          onChange={(e) => {
            setDraft((d) => ({ ...d, objective: e.target.value }));
          }}
          className={cx(ui.field.input, "resize-y")}
          aria-label="Objective"
        />
      </div>

      <div className={ui.field.root}>
        <label className={ui.field.label}>
          <span>
            Description{" "}
            <span className="font-normal text-fg-muted">(optional)</span>
          </span>
        </label>
        <textarea
          rows={3}
          value={draft.description}
          onChange={(e) => {
            setDraft((d) => ({ ...d, description: e.target.value }));
          }}
          className={cx(ui.field.input, "resize-y")}
          aria-label="Description"
        />
      </div>

      <EditableList
        label="Preconditions"
        values={draft.preconditions}
        onChange={(v) => {
          setDraft((d) => ({ ...d, preconditions: v }));
        }}
      />

      <EditableSteps
        steps={draft.steps}
        onChange={(v) => {
          setDraft((d) => ({ ...d, steps: v }));
        }}
        errors={errors}
      />

      <EditableList
        label="Test data"
        values={draft.testData}
        onChange={(v) => {
          setDraft((d) => ({ ...d, testData: v }));
        }}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextField
          label="Priority"
          value={draft.priority}
          onChange={(v) => {
            setDraft((d) => ({ ...d, priority: v }));
          }}
        />
        <TextField
          label="Risk"
          value={draft.risk}
          onChange={(v) => {
            setDraft((d) => ({ ...d, risk: v }));
          }}
        />
      </div>

      <EditableList
        label="Tags"
        values={draft.tags}
        onChange={(v) => {
          setDraft((d) => ({ ...d, tags: v }));
        }}
      />

      <TraceLinkEditor
        traceLinks={draft.traceLinks}
        onChange={(v) => {
          setDraft((d) => ({ ...d, traceLinks: v }));
        }}
        errorId={traceErrId}
        {...(traceError !== undefined
          ? { errorMessage: traceError.message }
          : {})}
      />

      <div className={ui.field.root}>
        <label htmlFor={changeReasonId} className={ui.field.label}>
          <span>
            Change reason{" "}
            <span className="font-normal text-fg-muted">(optional)</span>
          </span>
          <span className="font-mono text-[10px] text-fg-muted">
            {draft.changeReason.length} / 500
          </span>
        </label>
        <textarea
          id={changeReasonId}
          rows={2}
          maxLength={500}
          value={draft.changeReason}
          onChange={(e) => {
            setDraft((d) => ({ ...d, changeReason: e.target.value }));
          }}
          className={cx(ui.field.input, "resize-y")}
          aria-label="Change reason for this version"
          placeholder="Optional note about what changed and why…"
        />
      </div>

      <div className={cx(ui.bottomBar.root, "mt-0")}>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => {
            void handleSave();
          }}
          className={cx(ui.button.base, ui.button.primary)}
          aria-label="Save new version"
        >
          {isSaving ? "Saving…" : "Save version"}
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={onCancel}
          className={cx(ui.button.base, ui.button.ghost)}
          aria-label="Cancel editing"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
