export type StageName =
  | "generator"
  | "judge"
  | "visual_sidecar"
  | "policy_gate";

export type StageOutcome = "pending" | "clean" | "blocked" | "failed";

export interface StageData {
  attempts: number;
  successes: number;
  failures: number;
  outcome: StageOutcome;
}

export type Stages = Record<StageName, StageData>;

export type RunStatus =
  | "idle"
  | "queued"
  | "running"
  | "judging"
  | "policy-gate"
  | "sealed"
  | "clean"
  | "blocked"
  | "blocked_failure"
  | "failed"
  | "degraded";

export type ArtifactStatus = "pending" | "ok" | "blocked" | "fail";

export interface Artifact {
  name: string;
  size: string;
  status: ArtifactStatus;
  path?: string;
  downloadHref?: string;
  customerFacing?: boolean;
}

export interface CustomerOutputFile {
  name: string;
  path: string;
  size: string;
  downloadHref: string;
  combined: boolean;
}

export type CustomerMarkdownFile = CustomerOutputFile;

export interface RunConfig {
  figmaUrl: string;
  customContext: string;
  outputDir: string;
  outputRunSubdir: OutputSubdir;
  visualSidecar: boolean;
  allowPolicyBlocked: boolean;
  caCerts: string;
  jobIdOverride: string;
}

export type OutputSubdir = "job-id" | "timestamp" | "none";

export interface RunState {
  status: RunStatus;
  jobId: string | null;
  config: RunConfig | null;
  generatedAt: string | null;
  contractVersion: string;
  stages: Stages;
  artifacts: Artifact[];
  artifactDir?: string;
  outputRoot?: string;
  customerMarkdown?: CustomerMarkdownFile[];
  customerPdf?: CustomerOutputFile[];
  customerTxt?: CustomerOutputFile[];
  errorMessage?: string;
}

export type RunAction =
  | { type: "queue"; jobId: string; config: RunConfig }
  | { type: "advance"; to: AdvanceTarget }
  | { type: "fault"; kind: FaultKind }
  | { type: "hydrate"; state: RunState }
  | { type: "reset" };

export type AdvanceTarget = "running" | "judging" | "policy-gate" | "sealed";
export type FaultKind = "blocked" | "failed" | "blocked_failure";

export interface ValidationIssue {
  field: string;
  label: string;
  message: string;
}

export interface HistoryRow {
  jobId: string;
  started: string;
  status: RunStatus;
  stages: string;
  artifacts: number;
}
