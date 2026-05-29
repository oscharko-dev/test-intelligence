import { describe, expect, it } from "vitest";
import { ADVANCE_ORDER, INITIAL_RUN, runReducer } from "@/lib/run-state";
import { DEFAULT_FORM } from "@/lib/runs-form";
import type { AdvanceTarget, RunConfig, RunState } from "@/lib/types";

const SAMPLE_CONFIG: RunConfig = {
  ...DEFAULT_FORM,
  figmaUrl: "https://www.figma.com/design/ABC/E?node-id=1-2",
  outputDir: ".out",
};

describe("full ADVANCE_ORDER walk", () => {
  it("queue → running → judging → policy-gate → sealed", () => {
    let s: RunState = runReducer(INITIAL_RUN, {
      type: "queue",
      jobId: "ti-workbench-walk",
      config: SAMPLE_CONFIG,
    });
    expect(s.status).toBe(ADVANCE_ORDER[0]);
    for (let i = 1; i < ADVANCE_ORDER.length; i += 1) {
      const target = ADVANCE_ORDER[i] as AdvanceTarget;
      s = runReducer(s, { type: "advance", to: target });
      expect(s.status).toBe(target);
    }
    expect(s.status).toBe("sealed");
    // After sealed, every stage is non-pending
    expect(s.stages.generator.outcome).not.toBe("pending");
    expect(s.stages.judge.outcome).not.toBe("pending");
    expect(s.stages.visual_sidecar.outcome).not.toBe("pending");
    expect(s.stages.policy_gate.outcome).not.toBe("pending");
  });
});
