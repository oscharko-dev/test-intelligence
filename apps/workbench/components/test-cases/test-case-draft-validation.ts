/**
 * Client-side mirror of the server validation rules (Issue #58).
 * Must stay in sync with lib/server/test-case-validation.ts — the same
 * six error codes, the same field paths, same blank-check rule.
 */
import type {
  TestCaseStepRecord,
  TestCaseTraceLinkKind,
} from "@/lib/server/storage/types";

export type TestCaseValidationCode =
  | "TITLE_REQUIRED"
  | "AT_LEAST_ONE_STEP"
  | "STEP_ACTION_REQUIRED"
  | "STEP_EXPECTED_REQUIRED"
  | "TRACE_LINK_REQUIRED"
  | "TRACE_TARGET_ID_REQUIRED";

export interface TestCaseValidationError {
  readonly field: string;
  readonly code: TestCaseValidationCode;
  readonly message: string;
}

export interface TraceLinkDraft {
  readonly targetKind: TestCaseTraceLinkKind;
  readonly targetId: string;
}

export interface TestCaseDraftInput {
  readonly title: string;
  readonly steps: readonly TestCaseStepRecord[];
  readonly traceTargets: readonly TraceLinkDraft[];
}

const isBlank = (value: string): boolean => value.trim().length === 0;

const validateSteps = (
  steps: readonly TestCaseStepRecord[],
): TestCaseValidationError[] => {
  if (steps.length === 0) {
    return [
      {
        field: "steps",
        code: "AT_LEAST_ONE_STEP",
        message: "At least one step is required.",
      },
    ];
  }
  const errors: TestCaseValidationError[] = [];
  steps.forEach((step, index) => {
    if (isBlank(step.action)) {
      errors.push({
        field: `steps[${index}].action`,
        code: "STEP_ACTION_REQUIRED",
        message: "Step action is required.",
      });
    }
    if (isBlank(step.expected)) {
      errors.push({
        field: `steps[${index}].expected`,
        code: "STEP_EXPECTED_REQUIRED",
        message: "Step expected result is required.",
      });
    }
  });
  return errors;
};

const validateTraceTargets = (
  traceTargets: readonly TraceLinkDraft[],
): TestCaseValidationError[] => {
  if (traceTargets.length === 0) {
    return [
      {
        field: "traceTargets",
        code: "TRACE_LINK_REQUIRED",
        message: "At least one trace link is required.",
      },
    ];
  }
  const errors: TestCaseValidationError[] = [];
  traceTargets.forEach((target, index) => {
    if (isBlank(target.targetId)) {
      errors.push({
        field: `traceTargets[${index}].targetId`,
        code: "TRACE_TARGET_ID_REQUIRED",
        message: "Trace target id is required.",
      });
    }
  });
  return errors;
};

export const clientValidateDraft = (
  draft: TestCaseDraftInput,
): readonly TestCaseValidationError[] => {
  const errors: TestCaseValidationError[] = [];
  if (isBlank(draft.title)) {
    errors.push({
      field: "title",
      code: "TITLE_REQUIRED",
      message: "Title is required.",
    });
  }
  errors.push(...validateSteps(draft.steps));
  errors.push(...validateTraceTargets(draft.traceTargets));
  return errors;
};
