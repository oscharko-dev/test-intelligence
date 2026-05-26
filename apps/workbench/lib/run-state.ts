import type {
  Artifact,
  RunAction,
  RunState,
  RunStatus,
  StageName,
  Stages,
} from "./types";

export const STAGE_ORDER: readonly StageName[] = [
  "generator",
  "judge",
  "visual_sidecar",
  "policy_gate",
];

export const ADVANCE_ORDER: readonly RunStatus[] = [
  "queued",
  "running",
  "judging",
  "policy-gate",
  "sealed",
];

function emptyStages(): Stages {
  return {
    generator: { attempts: 0, successes: 0, failures: 0, outcome: "pending" },
    judge: { attempts: 0, successes: 0, failures: 0, outcome: "pending" },
    visual_sidecar: {
      attempts: 0,
      successes: 0,
      failures: 0,
      outcome: "pending",
    },
    policy_gate: { attempts: 0, successes: 0, failures: 0, outcome: "pending" },
  };
}

export const DEFAULT_ARTIFACT_NAMES: readonly string[] = [
  "coverage-plan.json",
  "coverage-report.json",
  "policy-report.json",
  "validation-report.json",
  "run-quality.json",
  "visual-sidecar-result.json",
  "production-runner-evidence-seal.json",
  "genealogy.json",
  "workflow-topology.json",
  "compliance-annotations.json",
];

function defaultArtifacts(): Artifact[] {
  return DEFAULT_ARTIFACT_NAMES.map((name) => ({
    name,
    size: "—",
    status: "pending",
  }));
}

export const INITIAL_RUN: RunState = {
  status: "idle",
  jobId: null,
  config: null,
  generatedAt: null,
  contractVersion: "v0.4.1",
  stages: emptyStages(),
  artifacts: defaultArtifacts(),
};

export function sizeFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const kb = 4 + (h % 220);
  return `${kb}.${(h % 9) + 1} KB`;
}

const STAGE_READY: Partial<Record<RunStatus, number>> = {
  queued: 0,
  running: 1,
  judging: 3,
  "policy-gate": 6,
  sealed: 10,
  clean: 10,
  blocked: 6,
  blocked_failure: 6,
  failed: 2,
};

export function withArtifactsForState(
  state: RunStatus,
  art: readonly Artifact[],
): Artifact[] {
  const n = STAGE_READY[state] ?? 0;
  const isBlocked = state === "blocked" || state === "blocked_failure";
  return art.map<Artifact>((a, i) => {
    if (i < n) {
      const ok = state === "sealed" || state === "clean" || i < n - 1;
      return {
        ...a,
        size: a.size === "—" ? sizeFor(a.name) : a.size,
        status: ok ? "ok" : isBlocked ? "blocked" : "ok",
      };
    }
    return {
      ...a,
      status: state === "failed" && i === n ? "fail" : "pending",
    };
  });
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "queue": {
      return {
        ...INITIAL_RUN,
        status: "queued",
        jobId: action.jobId,
        generatedAt: new Date().toISOString(),
        config: action.config,
      };
    }
    case "advance": {
      const next = action.to;
      const stages: Stages = { ...state.stages };
      if (next === "running") {
        stages.generator = {
          attempts: 12,
          successes: 12,
          failures: 0,
          outcome: "clean",
        };
      } else if (next === "judging") {
        stages.judge = {
          attempts: 12,
          successes: 11,
          failures: 1,
          outcome: "clean",
        };
      } else if (next === "policy-gate") {
        stages.visual_sidecar = {
          attempts: 12,
          successes: 12,
          failures: 0,
          outcome: "clean",
        };
      } else if (next === "sealed") {
        stages.policy_gate = {
          attempts: 1,
          successes: 1,
          failures: 0,
          outcome: "clean",
        };
      }
      return {
        ...state,
        status: next,
        stages,
        artifacts: withArtifactsForState(next, state.artifacts),
      };
    }
    case "fault": {
      const stages: Stages = { ...state.stages };
      if (action.kind === "blocked" || action.kind === "blocked_failure") {
        stages.policy_gate = {
          attempts: 1,
          successes: 0,
          failures: 1,
          outcome: "blocked",
        };
      }
      if (action.kind === "failed") {
        const last =
          STAGE_ORDER.find((s) => stages[s].outcome === "pending") ??
          "generator";
        stages[last] = {
          attempts: 3,
          successes: 0,
          failures: 3,
          outcome: "failed",
        };
      }
      return {
        ...state,
        status: action.kind,
        stages,
        artifacts: withArtifactsForState(action.kind, state.artifacts),
      };
    }
    case "hydrate":
      return action.state;
    case "reset":
      return INITIAL_RUN;
  }
}

export function isTerminal(status: RunStatus): boolean {
  return (
    status === "idle" ||
    status === "sealed" ||
    status === "clean" ||
    status === "blocked" ||
    status === "blocked_failure" ||
    status === "failed"
  );
}
