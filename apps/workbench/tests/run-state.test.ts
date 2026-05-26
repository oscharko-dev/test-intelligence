import { describe, expect, it } from "vitest";
import {
  ADVANCE_ORDER,
  DEFAULT_ARTIFACT_NAMES,
  INITIAL_RUN,
  isTerminal,
  runReducer,
  sizeFor,
  withArtifactsForState,
} from "@/lib/run-state";
import type { RunConfig, RunState } from "@/lib/types";

const SAMPLE_CONFIG: RunConfig = {
  figmaUrl: "https://www.figma.com/design/ABC/Example?node-id=1-2",
  customContext: "",
  outputDir: ".out",
  outputRunSubdir: "job-id",
  visualSidecar: true,
  allowPolicyBlocked: false,
  caCerts: "",
  jobIdOverride: "",
};

function queue(): RunState {
  return runReducer(INITIAL_RUN, {
    type: "queue",
    jobId: "ti-workbench-1",
    config: SAMPLE_CONFIG,
  });
}

describe("runReducer", () => {
  it("starts idle", () => {
    expect(INITIAL_RUN.status).toBe("idle");
    expect(INITIAL_RUN.artifacts).toHaveLength(DEFAULT_ARTIFACT_NAMES.length);
    expect(INITIAL_RUN.artifacts.every((a) => a.status === "pending")).toBe(
      true,
    );
  });

  it("queue transitions to queued with jobId and config", () => {
    const s = queue();
    expect(s.status).toBe("queued");
    expect(s.jobId).toBe("ti-workbench-1");
    expect(s.config).toEqual(SAMPLE_CONFIG);
    expect(s.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("advance walks through the full lifecycle to sealed", () => {
    let s = queue();
    s = runReducer(s, { type: "advance", to: "running" });
    expect(s.status).toBe("running");
    expect(s.stages.generator.outcome).toBe("clean");

    s = runReducer(s, { type: "advance", to: "judging" });
    expect(s.status).toBe("judging");
    expect(s.stages.judge.outcome).toBe("clean");

    s = runReducer(s, { type: "advance", to: "policy-gate" });
    expect(s.status).toBe("policy-gate");
    expect(s.stages.visual_sidecar.outcome).toBe("clean");

    s = runReducer(s, { type: "advance", to: "sealed" });
    expect(s.status).toBe("sealed");
    expect(s.stages.policy_gate.outcome).toBe("clean");

    expect(s.artifacts.every((a) => a.status === "ok")).toBe(true);
  });

  it("fault.blocked sets policy_gate failure and status", () => {
    let s = queue();
    s = runReducer(s, { type: "advance", to: "running" });
    s = runReducer(s, { type: "fault", kind: "blocked" });
    expect(s.status).toBe("blocked");
    expect(s.stages.policy_gate.outcome).toBe("blocked");
  });

  it("fault.failed sets the first pending stage as failed", () => {
    const s = runReducer(queue(), { type: "fault", kind: "failed" });
    expect(s.status).toBe("failed");
    expect(s.stages.generator.outcome).toBe("failed");
  });

  it("reset returns to initial idle state", () => {
    const s = runReducer(queue(), { type: "reset" });
    expect(s).toEqual(INITIAL_RUN);
  });
});

describe("ADVANCE_ORDER", () => {
  it("starts at queued and ends at sealed", () => {
    expect(ADVANCE_ORDER[0]).toBe("queued");
    expect(ADVANCE_ORDER[ADVANCE_ORDER.length - 1]).toBe("sealed");
  });
});

describe("isTerminal", () => {
  it.each([
    ["idle", true],
    ["sealed", true],
    ["clean", true],
    ["blocked", true],
    ["blocked_failure", true],
    ["failed", true],
    ["queued", false],
    ["running", false],
    ["judging", false],
    ["policy-gate", false],
    ["degraded", false],
  ] as const)("isTerminal(%s) === %s", (status, expected) => {
    expect(isTerminal(status)).toBe(expected);
  });
});

describe("sizeFor", () => {
  it("is deterministic for the same name", () => {
    expect(sizeFor("coverage-plan.json")).toBe(sizeFor("coverage-plan.json"));
  });
  it("produces a 'NN.N KB' shape", () => {
    expect(sizeFor("policy-report.json")).toMatch(/^\d+\.\d KB$/);
  });
});

describe("withArtifactsForState", () => {
  it("marks no artifacts ok for queued", () => {
    const out = withArtifactsForState("queued", INITIAL_RUN.artifacts);
    expect(out.every((a) => a.status === "pending")).toBe(true);
  });

  it("marks all artifacts ok for sealed/clean", () => {
    const sealed = withArtifactsForState("sealed", INITIAL_RUN.artifacts);
    expect(sealed.every((a) => a.status === "ok")).toBe(true);
    sealed.forEach((a) => {
      expect(a.size).not.toBe("—");
    });
  });

  it("marks the boundary artifact fail when state is failed", () => {
    const out = withArtifactsForState("failed", INITIAL_RUN.artifacts);
    expect(out.filter((a) => a.status === "fail")).toHaveLength(1);
  });

  it("marks the boundary artifact blocked for both blocked and blocked_failure", () => {
    const blocked = withArtifactsForState("blocked", INITIAL_RUN.artifacts);
    const blockedFailure = withArtifactsForState(
      "blocked_failure",
      INITIAL_RUN.artifacts,
    );
    const blockedBoundary = blocked.filter((a) => a.status === "blocked");
    const bfBoundary = blockedFailure.filter((a) => a.status === "blocked");
    expect(blockedBoundary).toHaveLength(1);
    expect(bfBoundary).toHaveLength(1);
    expect(bfBoundary[0]?.name).toBe(blockedBoundary[0]?.name);
  });
});
