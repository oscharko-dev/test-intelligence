"use client";

import { useState, type ReactNode } from "react";
import { Panel } from "@/components/primitives/Panel";
import type {
  PersistedTestCaseDetail,
  TestCaseVersionRecord,
} from "@/lib/server/storage/types";
import type { PlausibilityWarning } from "@/lib/server/test-case-plausibility";
import { cx, ui } from "@/lib/ui-classes";
import { TestCaseDetailEditorForm } from "./TestCaseDetailEditorForm";
import { TestCaseDetailEditorReadOnly } from "./TestCaseDetailEditorReadOnly";
import { WarningsStrip } from "./TestCaseEditableFields";

export interface TestCaseDetailEditorProps {
  readonly version: TestCaseVersionRecord;
  readonly caseId: string;
  readonly isCurrentVersion: boolean;
  readonly onSaved: (detail: PersistedTestCaseDetail) => void;
}

export function TestCaseDetailEditor({
  version,
  caseId,
  isCurrentVersion,
  onSaved,
}: TestCaseDetailEditorProps): ReactNode {
  const [isEditing, setIsEditing] = useState(false);
  const [warnings, setWarnings] = useState<readonly PlausibilityWarning[]>([]);

  const dismissWarnings = (): void => {
    setWarnings([]);
  };

  const startEdit = (): void => {
    setIsEditing(true);
  };

  const cancelEdit = (): void => {
    setIsEditing(false);
  };

  const handleSaved = (outcome: {
    detail: PersistedTestCaseDetail;
    warnings: readonly PlausibilityWarning[];
  }): void => {
    setIsEditing(false);
    setWarnings(outcome.warnings);
    onSaved(outcome.detail);
  };

  if (isEditing) {
    return (
      <Panel title="Editor — Edit mode">
        <WarningsStrip warnings={warnings} onDismiss={dismissWarnings} />
        <TestCaseDetailEditorForm
          version={version}
          caseId={caseId}
          onSaved={handleSaved}
          onCancel={cancelEdit}
        />
      </Panel>
    );
  }

  const editAction = isCurrentVersion ? (
    <button
      type="button"
      onClick={startEdit}
      className={cx(ui.button.base)}
      aria-label="Edit this test case"
    >
      Edit
    </button>
  ) : undefined;

  return (
    <Panel
      title="Editor"
      {...(editAction !== undefined ? { actions: editAction } : {})}
    >
      <WarningsStrip warnings={warnings} onDismiss={dismissWarnings} />
      {!isCurrentVersion && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 rounded-md border border-dashed border-border-subtle bg-bg-input px-3 py-2 font-mono text-[11px] text-fg-muted"
        >
          Viewing a previous version. Switch to the current version to edit.
        </div>
      )}
      <TestCaseDetailEditorReadOnly version={version} />
    </Panel>
  );
}
