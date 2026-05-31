import { describe, expect, it } from "vitest";

import {
  canTransitionTestCaseStatus,
  validateTestCaseDraft,
} from "@/lib/server/test-case-validation";

const baseDraft = {
  title: "ok",
  steps: [{ action: "do", expected: "done" }],
  traceTargets: [{ targetKind: "run" as const, targetId: "run-1" }],
};

describe("validateTestCaseDraft", () => {
  it("returns no errors for a valid draft", () => {
    expect(validateTestCaseDraft(baseDraft)).toStrictEqual([]);
  });

  it("emits TITLE_REQUIRED for a blank title", () => {
    const errors = validateTestCaseDraft({ ...baseDraft, title: "   " });
    expect(errors).toStrictEqual([
      {
        field: "title",
        code: "TITLE_REQUIRED",
        message: "Title is required.",
      },
    ]);
  });

  it("emits AT_LEAST_ONE_STEP when steps are empty", () => {
    const errors = validateTestCaseDraft({ ...baseDraft, steps: [] });
    expect(errors).toContainEqual({
      field: "steps",
      code: "AT_LEAST_ONE_STEP",
      message: "At least one step is required.",
    });
  });

  it("emits STEP_ACTION_REQUIRED with dotted index path", () => {
    const errors = validateTestCaseDraft({
      ...baseDraft,
      steps: [
        { action: "ok", expected: "ok" },
        { action: "   ", expected: "ok" },
      ],
    });
    expect(errors).toContainEqual({
      field: "steps[1].action",
      code: "STEP_ACTION_REQUIRED",
      message: "Step action is required.",
    });
  });

  it("emits STEP_EXPECTED_REQUIRED with dotted index path", () => {
    const errors = validateTestCaseDraft({
      ...baseDraft,
      steps: [
        { action: "ok", expected: "ok" },
        { action: "ok2", expected: "" },
      ],
    });
    expect(errors).toContainEqual({
      field: "steps[1].expected",
      code: "STEP_EXPECTED_REQUIRED",
      message: "Step expected result is required.",
    });
  });

  it("emits TRACE_LINK_REQUIRED when traceTargets are empty", () => {
    const errors = validateTestCaseDraft({
      ...baseDraft,
      traceTargets: [],
    });
    expect(errors).toStrictEqual([
      {
        field: "traceTargets",
        code: "TRACE_LINK_REQUIRED",
        message: "At least one trace link is required.",
      },
    ]);
  });

  it("emits TRACE_TARGET_ID_REQUIRED with dotted index path", () => {
    const errors = validateTestCaseDraft({
      ...baseDraft,
      traceTargets: [
        { targetKind: "run", targetId: "run-1" },
        { targetKind: "snapshot", targetId: "" },
      ],
    });
    expect(errors).toContainEqual({
      field: "traceTargets[1].targetId",
      code: "TRACE_TARGET_ID_REQUIRED",
      message: "Trace target id is required.",
    });
  });

  it("aggregates multiple errors in one call", () => {
    const errors = validateTestCaseDraft({
      title: "",
      steps: [],
      traceTargets: [],
    });
    const codes = errors.map((e) => e.code);
    expect(codes).toContain("TITLE_REQUIRED");
    expect(codes).toContain("AT_LEAST_ONE_STEP");
    expect(codes).toContain("TRACE_LINK_REQUIRED");
  });
});

describe("canTransitionTestCaseStatus", () => {
  it("allows draft → reviewed and draft → approved", () => {
    expect(canTransitionTestCaseStatus("draft", "reviewed")).toBe(true);
    expect(canTransitionTestCaseStatus("draft", "approved")).toBe(true);
  });

  it("allows reviewed → approved", () => {
    expect(canTransitionTestCaseStatus("reviewed", "approved")).toBe(true);
  });

  it("rejects backward transitions", () => {
    expect(canTransitionTestCaseStatus("reviewed", "draft")).toBe(false);
    expect(canTransitionTestCaseStatus("approved", "draft")).toBe(false);
    expect(canTransitionTestCaseStatus("approved", "reviewed")).toBe(false);
  });

  it("rejects same-state transitions", () => {
    expect(canTransitionTestCaseStatus("draft", "draft")).toBe(false);
    expect(canTransitionTestCaseStatus("reviewed", "reviewed")).toBe(false);
    expect(canTransitionTestCaseStatus("approved", "approved")).toBe(false);
  });
});
