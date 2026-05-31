import { describe, expect, it } from "vitest";
import { clientValidateDraft } from "@/components/test-cases/test-case-draft-validation";

const VALID_TRACE = [{ targetKind: "run" as const, targetId: "run-abc" }];

const VALID_STEP = { action: "click X", expected: "Y appears" };

describe("clientValidateDraft", () => {
  it("returns an empty array on the happy path", () => {
    const errors = clientValidateDraft({
      title: "Something",
      steps: [VALID_STEP],
      traceTargets: VALID_TRACE,
    });
    expect(errors).toEqual([]);
  });

  it("flags TITLE_REQUIRED when the title is blank or whitespace", () => {
    const errors = clientValidateDraft({
      title: "   ",
      steps: [VALID_STEP],
      traceTargets: VALID_TRACE,
    });
    expect(errors).toContainEqual({
      field: "title",
      code: "TITLE_REQUIRED",
      message: "Title is required.",
    });
  });

  it("flags AT_LEAST_ONE_STEP when there are no steps", () => {
    const errors = clientValidateDraft({
      title: "Has title",
      steps: [],
      traceTargets: VALID_TRACE,
    });
    expect(errors).toContainEqual({
      field: "steps",
      code: "AT_LEAST_ONE_STEP",
      message: "At least one step is required.",
    });
  });

  it("flags STEP_ACTION_REQUIRED at the correct dotted index", () => {
    const errors = clientValidateDraft({
      title: "Has title",
      steps: [VALID_STEP, VALID_STEP, { action: "   ", expected: "ok" }],
      traceTargets: VALID_TRACE,
    });
    expect(errors).toContainEqual({
      field: "steps[2].action",
      code: "STEP_ACTION_REQUIRED",
      message: "Step action is required.",
    });
  });

  it("flags STEP_EXPECTED_REQUIRED at the correct dotted index", () => {
    const errors = clientValidateDraft({
      title: "Has title",
      steps: [{ action: "do", expected: "" }],
      traceTargets: VALID_TRACE,
    });
    expect(errors).toContainEqual({
      field: "steps[0].expected",
      code: "STEP_EXPECTED_REQUIRED",
      message: "Step expected result is required.",
    });
  });

  it("flags TRACE_LINK_REQUIRED when there are no trace targets", () => {
    const errors = clientValidateDraft({
      title: "Has title",
      steps: [VALID_STEP],
      traceTargets: [],
    });
    expect(errors).toContainEqual({
      field: "traceTargets",
      code: "TRACE_LINK_REQUIRED",
      message: "At least one trace link is required.",
    });
  });

  it("flags TRACE_TARGET_ID_REQUIRED at the correct dotted index", () => {
    const errors = clientValidateDraft({
      title: "Has title",
      steps: [VALID_STEP],
      traceTargets: [
        { targetKind: "run", targetId: "run-a" },
        { targetKind: "snapshot", targetId: "   " },
      ],
    });
    expect(errors).toContainEqual({
      field: "traceTargets[1].targetId",
      code: "TRACE_TARGET_ID_REQUIRED",
      message: "Trace target id is required.",
    });
  });

  it("returns multiple errors when multiple rules fail", () => {
    const errors = clientValidateDraft({
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
