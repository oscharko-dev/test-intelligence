/**
 * Pure validation rules for a manual test-case draft (Issue #58 scope).
 *
 * Required fields per the issue: title, at least one step (each with action and
 * expected), at least one trace link (each with a non-empty targetId). The
 * repository invokes this before persisting; an empty result means save proceeds.
 */

import type {
  TestCaseStepRecord,
  TestCaseTraceLinkKind,
  TestCaseTraceTargetInput,
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

export interface TestCaseDraftInput {
  readonly title: string;
  readonly steps: readonly TestCaseStepRecord[];
  readonly traceTargets: readonly TestCaseTraceTargetInput[];
}

const isBlank = (value: string): boolean => value.trim().length === 0;

const validateSteps = (
  steps: readonly TestCaseStepRecord[],
): TestCaseValidationError[] => {
  const errors: TestCaseValidationError[] = [];
  if (steps.length === 0) {
    errors.push({
      field: "steps",
      code: "AT_LEAST_ONE_STEP",
      message: "At least one step is required.",
    });
    return errors;
  }
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
  traceTargets: readonly TestCaseTraceTargetInput[],
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

export const validateTestCaseDraft = (
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

export const ALLOWED_STATUS_TRANSITIONS: ReadonlyMap<
  string,
  readonly string[]
> = new Map([
  ["draft", ["reviewed", "approved"]],
  ["reviewed", ["approved"]],
  ["approved", []],
]);

export const canTransitionTestCaseStatus = (
  from: string,
  to: string,
): boolean => {
  if (from === to) return false;
  const allowed = ALLOWED_STATUS_TRANSITIONS.get(from);
  return allowed !== undefined && allowed.includes(to);
};

export type { TestCaseTraceLinkKind };
