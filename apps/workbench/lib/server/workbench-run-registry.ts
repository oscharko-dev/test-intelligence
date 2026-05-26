import {
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createProductionTopologyClientBundle } from "@oscharko-dev/ti-model-gateway";
import type {
  ProductionRunnerEvent,
  ProductionRunnerLlmConfig,
  RunFigmaToQcTestCasesInput,
  RunFigmaToQcTestCasesResult,
} from "@oscharko-dev/ti-production-runner";
import isPathInside from "is-path-inside";
import {
  DEFAULT_ARTIFACT_NAMES,
  INITIAL_RUN,
  isTerminal,
} from "@/lib/run-state";
import type {
  Artifact,
  ArtifactStatus,
  CustomerMarkdownFile,
  RunState,
  RunStatus,
  StageName,
  Stages,
} from "@/lib/types";
import {
  safeRelativePath,
  type PreparedWorkbenchRun,
} from "./workbench-run-validation";

interface WorkbenchRunRecord {
  state: RunState;
  promise?: Promise<void>;
}

interface WorkbenchRunStore {
  activeJobId: string | null;
  jobs: Map<string, WorkbenchRunRecord>;
}

interface ReadWorkbenchRunFileResult {
  bytes: Buffer;
  contentType: string;
  filename: string;
}

interface ProductionRunnerModule {
  runFigmaToQcTestCases: (
    input: RunFigmaToQcTestCasesInput,
  ) => Promise<RunFigmaToQcTestCasesResult>;
}

export class WorkbenchRunRegistryError extends Error {
  readonly status: number;
  readonly code: string;

  constructor({
    status,
    code,
    message,
  }: {
    status: number;
    code: string;
    message: string;
  }) {
    super(message);
    this.name = "WorkbenchRunRegistryError";
    this.status = status;
    this.code = code;
  }
}

const globalForRuns = globalThis as typeof globalThis & {
  __TI_WORKBENCH_RUN_STORE__?: WorkbenchRunStore;
};

const PRODUCTION_RUNNER_PACKAGE_PARTS = [
  "@oscharko-dev",
  "ti-production-runner",
] as const;

const loadProductionRunner = async (): Promise<ProductionRunnerModule> =>
  (await import(
    /* webpackIgnore: true */
    PRODUCTION_RUNNER_PACKAGE_PARTS.join("/")
  )) as ProductionRunnerModule;

const getStore = (): WorkbenchRunStore => {
  if (globalForRuns.__TI_WORKBENCH_RUN_STORE__ === undefined) {
    globalForRuns.__TI_WORKBENCH_RUN_STORE__ = {
      activeJobId: null,
      jobs: new Map<string, WorkbenchRunRecord>(),
    };
  }
  return globalForRuns.__TI_WORKBENCH_RUN_STORE__;
};

export const resetWorkbenchRunStoreForTests = (): void => {
  globalForRuns.__TI_WORKBENCH_RUN_STORE__ = {
    activeJobId: null,
    jobs: new Map<string, WorkbenchRunRecord>(),
  };
};

const cloneStages = (stages: Stages): Stages => ({
  generator: { ...stages.generator },
  judge: { ...stages.judge },
  visual_sidecar: { ...stages.visual_sidecar },
  policy_gate: { ...stages.policy_gate },
});

const setStage = (
  stages: Stages,
  stage: StageName,
  next: Partial<Stages[StageName]>,
): Stages => ({
  ...stages,
  [stage]: {
    ...stages[stage],
    ...next,
  },
});

const pendingArtifacts = (): Artifact[] =>
  DEFAULT_ARTIFACT_NAMES.map((name) => ({
    name,
    size: "-",
    status: "pending",
  }));

const createQueuedRun = (prepared: PreparedWorkbenchRun): RunState => ({
  ...INITIAL_RUN,
  status: "queued",
  jobId: prepared.jobId,
  config: prepared.config,
  generatedAt: prepared.generatedAt,
  stages: cloneStages(INITIAL_RUN.stages),
  artifacts: pendingArtifacts(),
  artifactDir: prepared.artifactDir,
  outputRoot: prepared.outputRoot,
  customerMarkdown: [],
});

const updateRecord = (
  jobId: string,
  updater: (state: RunState) => RunState,
): void => {
  const record = getStore().jobs.get(jobId);
  if (record === undefined) return;
  record.state = updater(record.state);
};

const updateStage = ({
  jobId,
  status,
  stage,
  outcome,
}: {
  jobId: string;
  status: RunStatus;
  stage: StageName;
  outcome: "pending" | "clean" | "blocked" | "failed";
}): void => {
  updateRecord(jobId, (state) => {
    const current = state.stages[stage];
    const attempts = Math.max(current.attempts, 1);
    const successes = outcome === "clean" ? Math.max(current.successes, 1) : 0;
    const failures =
      outcome === "blocked" || outcome === "failed"
        ? Math.max(current.failures, 1)
        : current.failures;
    return {
      ...state,
      status,
      stages: setStage(state.stages, stage, {
        attempts,
        successes,
        failures,
        outcome,
      }),
    };
  });
};

const handleRunnerEvent =
  (jobId: string) =>
  (event: ProductionRunnerEvent): void => {
    switch (event.phase) {
      case "intent_derivation_started":
        updateStage({
          jobId,
          status: "running",
          stage: "generator",
          outcome: "pending",
        });
        break;
      case "intent_derivation_complete":
        updateStage({
          jobId,
          status: "running",
          stage: "generator",
          outcome: "clean",
        });
        break;
      case "visual_sidecar_started":
        updateStage({
          jobId,
          status: "running",
          stage: "visual_sidecar",
          outcome: "pending",
        });
        break;
      case "visual_sidecar_complete":
      case "visual_sidecar_skipped":
        updateStage({
          jobId,
          status: "running",
          stage: "visual_sidecar",
          outcome: "clean",
        });
        break;
      case "prompt_compiled":
      case "llm_gateway_request":
      case "llm_gateway_response":
      case "validation_started":
        updateStage({
          jobId,
          status: "judging",
          stage: "judge",
          outcome: "pending",
        });
        break;
      case "validation_complete":
        updateStage({
          jobId,
          status: "judging",
          stage: "judge",
          outcome: "clean",
        });
        break;
      case "policy_decision": {
        const blocked = event.details?.blocked === true;
        updateStage({
          jobId,
          status: "policy-gate",
          stage: "policy_gate",
          outcome: blocked ? "blocked" : "clean",
        });
        break;
      }
      case "export_started":
      case "export_complete":
      case "evidence_sealed":
      case "finops_recorded":
      case "cache_break":
      case "replay_cache_hit":
      case "repair_loop_iteration":
        break;
      case "cancelled":
        updateStage({
          jobId,
          status: "failed",
          stage: "generator",
          outcome: "failed",
        });
        break;
    }
  };

const buildLlmConfig = (
  prepared: PreparedWorkbenchRun,
): ProductionRunnerLlmConfig => {
  const bundleInput = {
    endpoint: prepared.env.endpoint,
    visualEndpoint: prepared.env.visualEndpoint,
    deployment: prepared.env.deployment,
    ictRegisterRef: prepared.env.ictRegisterRef,
    visualPrimaryDeployment: prepared.env.visualPrimaryDeployment,
    visualFallbackDeployment: prepared.env.visualFallbackDeployment,
    ...(prepared.env.logicJudgeDeployment !== undefined
      ? { logicJudgeDeployment: prepared.env.logicJudgeDeployment }
      : {}),
    ...(prepared.env.a11yJudgeDeployment !== undefined
      ? { a11yJudgeDeployment: prepared.env.a11yJudgeDeployment }
      : {}),
    ...(prepared.env.coveragePlannerDeployment !== undefined
      ? { coveragePlannerDeployment: prepared.env.coveragePlannerDeployment }
      : {}),
    ...(prepared.env.riskRankerDeployment !== undefined
      ? { riskRankerDeployment: prepared.env.riskRankerDeployment }
      : {}),
    modelRevisionSuffix: "workbench-real-run",
    gatewayRelease: "test-intelligence-workbench",
  };
  const bundle = createProductionTopologyClientBundle(bundleInput, {
    apiKeyProvider: () => prepared.env.apiKey,
  });
  const llm: ProductionRunnerLlmConfig = {
    client: bundle.testGeneration,
    maxOutputTokens: 32_000,
    maxWallClockMs: 240_000,
  };
  if (prepared.config.visualSidecar) {
    llm.bundle = bundle;
  } else {
    if (bundle.logicJudge !== undefined) {
      llm.logicJudge = bundle.logicJudge;
    }
    if (bundle.coveragePlanner !== undefined) {
      llm.coveragePlanner = bundle.coveragePlanner;
    }
    if (bundle.riskRanker !== undefined) {
      llm.riskRanker = bundle.riskRanker;
    }
  }
  return llm;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
};

const fileInfo = async (
  filePath: string,
): Promise<{ size: string; isFile: boolean }> => {
  const info = await stat(filePath).catch(() => null);
  if (info === null) return { size: "-", isFile: false };
  if (!info.isFile()) return { size: "dir", isFile: false };
  return { size: formatBytes(info.size), isFile: true };
};

const downloadHrefFor = (jobId: string, relativePath: string): string =>
  `/api/workbench/runs/${encodeURIComponent(jobId)}/files?path=${encodeURIComponent(relativePath)}`;

const artifactFromPath = async ({
  jobId,
  artifactDir,
  filePath,
  status,
  customerFacing = false,
}: {
  jobId: string;
  artifactDir: string;
  filePath: string;
  status: ArtifactStatus;
  customerFacing?: boolean;
}): Promise<Artifact> => {
  const resolvedArtifactDir = path.resolve(artifactDir);
  const absolute = path.resolve(filePath);
  if (!isPathInside(absolute, resolvedArtifactDir)) {
    throw new WorkbenchRunRegistryError({
      status: 500,
      code: "WORKBENCH_RUNNER_ARTIFACT_OUTSIDE_ROOT",
      message: "Runner returned an artifact outside the run root.",
    });
  }
  const relativePath = safeRelativePath(resolvedArtifactDir, absolute);
  const info = await fileInfo(absolute);
  return {
    name: relativePath,
    path: relativePath,
    size: info.size,
    status,
    ...(info.isFile
      ? { downloadHref: downloadHrefFor(jobId, relativePath) }
      : {}),
    ...(customerFacing ? { customerFacing: true } : {}),
  };
};

const customerMarkdownFileFromPath = async ({
  jobId,
  artifactDir,
  filePath,
  combined,
}: {
  jobId: string;
  artifactDir: string;
  filePath: string;
  combined: boolean;
}): Promise<CustomerMarkdownFile> => {
  const resolvedArtifactDir = path.resolve(artifactDir);
  const absolute = path.resolve(filePath);
  if (!isPathInside(absolute, resolvedArtifactDir)) {
    throw new WorkbenchRunRegistryError({
      status: 500,
      code: "WORKBENCH_RUNNER_CUSTOMER_MARKDOWN_OUTSIDE_ROOT",
      message: "Runner returned customer Markdown outside the run root.",
    });
  }
  const relativePath = safeRelativePath(resolvedArtifactDir, absolute);
  const info = await fileInfo(absolute);
  return {
    name: path.basename(absolute),
    path: relativePath,
    size: info.size,
    downloadHref: downloadHrefFor(jobId, relativePath),
    combined,
  };
};

export const resultArtifactPaths = (
  result: RunFigmaToQcTestCasesResult,
): string[] => {
  const rawValues = Object.entries(result.artifactPaths)
    .filter(([key]) => key !== "finopsTimeSeriesStore")
    .map(([, value]) => value);
  const paths = rawValues.filter((value): value is string => {
    return typeof value === "string" && value.length > 0;
  });
  return [
    ...paths,
    result.customerMarkdownPaths.combined,
    ...result.customerMarkdownPaths.perCase,
    result.customerMarkdownPaths.pdf,
  ];
};

const finishWithArtifacts = async ({
  jobId,
  artifactDir,
  blocked,
  artifactPaths,
  customerMarkdownPaths,
}: {
  jobId: string;
  artifactDir: string;
  blocked: boolean;
  artifactPaths: readonly string[];
  customerMarkdownPaths: {
    combined: string;
    perCase: readonly string[];
  };
}): Promise<void> => {
  const dedupedPaths = Array.from(
    new Set(artifactPaths.map((p) => path.resolve(p))),
  );
  const customerMarkdownSet = new Set(
    [customerMarkdownPaths.combined, ...customerMarkdownPaths.perCase].map(
      (p) => path.resolve(p),
    ),
  );
  const artifacts = await Promise.all(
    dedupedPaths.map((filePath) =>
      artifactFromPath({
        jobId,
        artifactDir,
        filePath,
        status:
          blocked && path.basename(filePath).includes("policy")
            ? "blocked"
            : "ok",
        customerFacing: customerMarkdownSet.has(path.resolve(filePath)),
      }),
    ),
  );
  const customerMarkdown = await Promise.all([
    customerMarkdownFileFromPath({
      jobId,
      artifactDir,
      filePath: customerMarkdownPaths.combined,
      combined: true,
    }),
    ...customerMarkdownPaths.perCase.map((filePath) =>
      customerMarkdownFileFromPath({
        jobId,
        artifactDir,
        filePath,
        combined: false,
      }),
    ),
  ]);
  updateRecord(jobId, (state) => {
    const stages = cloneStages(state.stages);
    const finalStages: Stages = {
      generator:
        stages.generator.outcome === "pending"
          ? { attempts: 1, successes: 1, failures: 0, outcome: "clean" }
          : stages.generator,
      judge:
        stages.judge.outcome === "pending"
          ? { attempts: 1, successes: 1, failures: 0, outcome: "clean" }
          : stages.judge,
      visual_sidecar:
        stages.visual_sidecar.outcome === "pending"
          ? { attempts: 1, successes: 1, failures: 0, outcome: "clean" }
          : stages.visual_sidecar,
      policy_gate: blocked
        ? { attempts: 1, successes: 0, failures: 1, outcome: "blocked" }
        : { attempts: 1, successes: 1, failures: 0, outcome: "clean" },
    };
    return {
      ...state,
      status: blocked ? "blocked" : "sealed",
      stages: finalStages,
      artifacts,
      customerMarkdown,
    };
  });
};

const sanitizeErrorMessage = (
  error: unknown,
  prepared: PreparedWorkbenchRun,
): string => {
  const raw =
    error instanceof Error
      ? error.message
      : "Workbench runner failed unexpectedly.";
  const secrets = [prepared.env.apiKey, prepared.env.figmaToken].filter(
    (value) => value.length >= 4,
  );
  let message = raw.replace(/[\u0000-\u001f\u007f]+/gu, " ").slice(0, 900);
  for (const secret of secrets) {
    message = message.split(secret).join("[redacted]");
  }
  return message
    .replace(
      /(api[-_ ]?key|access[-_ ]?token|authorization)\s*[:=]\s*\S+/giu,
      "$1=[redacted]",
    )
    .trim();
};

const failRun = (prepared: PreparedWorkbenchRun, error: unknown): void => {
  const message = sanitizeErrorMessage(error, prepared);
  updateRecord(prepared.jobId, (state) => {
    const stage =
      (Object.keys(state.stages) as StageName[]).find(
        (name) => state.stages[name].outcome === "pending",
      ) ?? "generator";
    return {
      ...state,
      status: "failed",
      errorMessage: message,
      stages: setStage(state.stages, stage, {
        attempts: Math.max(state.stages[stage].attempts, 1),
        successes: 0,
        failures: Math.max(state.stages[stage].failures, 1),
        outcome: "failed",
      }),
      artifacts: state.artifacts.map((artifact) => ({
        ...artifact,
        status: artifact.status === "pending" ? "fail" : artifact.status,
      })),
    };
  });
};

const executeRealRun = async (
  prepared: PreparedWorkbenchRun,
): Promise<void> => {
  const safeOutputRoot = prepared.allowedOutputRoots
    .map((root) => path.resolve(root))
    .find((root) => isPathInside(prepared.outputRoot, root));
  if (safeOutputRoot === undefined) {
    throw new WorkbenchRunRegistryError({
      status: 400,
      code: "WORKBENCH_OUTPUT_ROOT_NOT_ALLOWED",
      message: "Output root is outside the allowed Workbench output roots.",
    });
  }
  const resolvedOutputRoot = path.resolve(prepared.outputRoot);
  if (!isPathInside(resolvedOutputRoot, safeOutputRoot)) {
    throw new WorkbenchRunRegistryError({
      status: 400,
      code: "WORKBENCH_OUTPUT_ROOT_NOT_ALLOWED",
      message: "Output root is outside the allowed Workbench output roots.",
    });
  }
  const safeArtifactDir = path.resolve(prepared.artifactDir);
  if (!isPathInside(safeArtifactDir, resolvedOutputRoot)) {
    throw new WorkbenchRunRegistryError({
      status: 400,
      code: "WORKBENCH_ARTIFACT_ROOT_NOT_ALLOWED",
      message: "Artifact root is outside the Workbench output root.",
    });
  }
  await mkdir(safeArtifactDir, { recursive: true });
  const input: RunFigmaToQcTestCasesInput = {
    jobId: prepared.jobId,
    generatedAt: prepared.generatedAt,
    source: {
      kind: "figma_url",
      figmaUrl: prepared.config.figmaUrl,
      accessToken: prepared.env.figmaToken,
    },
    outputRoot: resolvedOutputRoot,
    artifactDir: safeArtifactDir,
    llm: buildLlmConfig(prepared),
    events: handleRunnerEvent(prepared.jobId),
  };
  if (prepared.customContextMarkdown !== undefined) {
    input.customContextMarkdown = prepared.customContextMarkdown;
  }
  const { runFigmaToQcTestCases } = await loadProductionRunner();
  const result = await runFigmaToQcTestCases(input);
  await finishWithArtifacts({
    jobId: prepared.jobId,
    artifactDir: result.artifactDir,
    blocked: result.blocked,
    artifactPaths: resultArtifactPaths(result),
    customerMarkdownPaths: result.customerMarkdownPaths,
  });
};

const executeMockRun = async (
  prepared: PreparedWorkbenchRun,
): Promise<void> => {
  const resolvedOutputRoot = path.resolve(prepared.outputRoot);
  const safeArtifactDir = path.resolve(prepared.artifactDir);
  if (!isPathInside(safeArtifactDir, resolvedOutputRoot)) {
    throw new WorkbenchRunRegistryError({
      status: 400,
      code: "WORKBENCH_ARTIFACT_ROOT_NOT_ALLOWED",
      message: "Artifact root is outside the Workbench output root.",
    });
  }
  const event = handleRunnerEvent(prepared.jobId);
  event({
    phase: "intent_derivation_started",
    timestamp: performance.now(),
  });
  const customerMarkdownDir = path.join(safeArtifactDir, "customer-markdown");
  await mkdir(customerMarkdownDir, {
    recursive: true,
  });
  event({
    phase: "intent_derivation_complete",
    timestamp: performance.now(),
    details: { screens: 1, detectedFields: 3, detectedActions: 2 },
  });
  event({
    phase: prepared.config.visualSidecar
      ? "visual_sidecar_complete"
      : "visual_sidecar_skipped",
    timestamp: performance.now(),
  });
  event({ phase: "prompt_compiled", timestamp: performance.now() });
  event({ phase: "validation_complete", timestamp: performance.now() });
  event({
    phase: "policy_decision",
    timestamp: performance.now(),
    details: { blocked: false, approved: 2, blockedCount: 0, needsReview: 0 },
  });

  const artifactPaths = await Promise.all(
    DEFAULT_ARTIFACT_NAMES.map(async (name) => {
      const artifactPath = path.join(safeArtifactDir, name);
      await writeFile(
        artifactPath,
        JSON.stringify(
          {
            jobId: prepared.jobId,
            generatedAt: prepared.generatedAt,
            artifact: name,
            fixture: "workbench-mock-runner",
          },
          null,
          2,
        ),
        "utf8",
      );
      return artifactPath;
    }),
  );
  const combined = path.join(customerMarkdownDir, "testfaelle.md");
  const perCase = [
    path.join(customerMarkdownDir, "testfall-001.md"),
    path.join(customerMarkdownDir, "testfall-002.md"),
  ];
  await writeFile(
    combined,
    [
      "# Fachliche Testfaelle",
      "",
      `Run: ${prepared.jobId}`,
      "",
      "## Testfall 1: Antrag starten",
      "",
      "Der Nutzer startet einen regulierten Antrag aus der Workbench-Fixture.",
      "",
      "## Testfall 2: Pflichtdaten validieren",
      "",
      "Fehlende Pflichtdaten werden fachlich nachvollziehbar blockiert.",
      "",
    ].join("\n"),
    "utf8",
  );
  await Promise.all(
    perCase.map((filePath, index) =>
      writeFile(
        filePath,
        [
          `# Testfall ${index + 1}`,
          "",
          `Quelle: ${prepared.config.figmaUrl}`,
          "",
          "## Erwartung",
          "",
          "Der fachliche Ablauf ist auditierbar dokumentiert.",
          "",
        ].join("\n"),
        "utf8",
      ),
    ),
  );
  await finishWithArtifacts({
    jobId: prepared.jobId,
    artifactDir: safeArtifactDir,
    blocked: false,
    artifactPaths: [...artifactPaths, combined, ...perCase],
    customerMarkdownPaths: { combined, perCase },
  });
};

const executeRun = async (prepared: PreparedWorkbenchRun): Promise<void> => {
  const store = getStore();
  try {
    if (process.env.WORKBENCH_RUNNER_MODE === "mock") {
      await executeMockRun(prepared);
    } else {
      await executeRealRun(prepared);
    }
  } catch (error) {
    failRun(prepared, error);
  } finally {
    if (store.activeJobId === prepared.jobId) {
      store.activeJobId = null;
    }
  }
};

export const startWorkbenchRun = (prepared: PreparedWorkbenchRun): RunState => {
  const store = getStore();
  const activeJobId = store.activeJobId;
  if (activeJobId !== null) {
    const active = store.jobs.get(activeJobId);
    if (active !== undefined && !isTerminal(active.state.status)) {
      throw new WorkbenchRunRegistryError({
        status: 409,
        code: "WORKBENCH_RUN_ALREADY_ACTIVE",
        message: "Another Workbench run is already active.",
      });
    }
    store.activeJobId = null;
  }
  if (store.jobs.has(prepared.jobId)) {
    throw new WorkbenchRunRegistryError({
      status: 409,
      code: "WORKBENCH_RUN_JOB_ID_EXISTS",
      message: "A Workbench run with this job ID already exists.",
    });
  }
  const record: WorkbenchRunRecord = {
    state: createQueuedRun(prepared),
  };
  const initialState = record.state;
  store.jobs.set(prepared.jobId, record);
  store.activeJobId = prepared.jobId;
  record.promise = executeRun(prepared);
  return initialState;
};

export const getWorkbenchRun = (jobId: string): RunState | undefined =>
  getStore().jobs.get(jobId)?.state;

export const getWorkbenchRunCompletionForTests = (
  jobId: string,
): Promise<void> | undefined => getStore().jobs.get(jobId)?.promise;

const contentTypeFor = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".txt") return "text/markdown; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".zip") return "application/zip";
  return "application/octet-stream";
};

export const readWorkbenchRunFile = async (
  jobId: string,
  requestedPath: string,
): Promise<ReadWorkbenchRunFileResult> => {
  const record = getStore().jobs.get(jobId);
  if (record === undefined) {
    throw new WorkbenchRunRegistryError({
      status: 404,
      code: "WORKBENCH_RUN_NOT_FOUND",
      message: "Workbench run not found.",
    });
  }
  const artifactDir = record.state.artifactDir;
  if (artifactDir === undefined) {
    throw new WorkbenchRunRegistryError({
      status: 404,
      code: "WORKBENCH_RUN_ARTIFACTS_UNAVAILABLE",
      message: "Workbench run artifacts are not available yet.",
    });
  }
  const normalized = requestedPath.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    throw new WorkbenchRunRegistryError({
      status: 400,
      code: "WORKBENCH_FILE_PATH_INVALID",
      message: "Requested artifact path is invalid.",
    });
  }
  const resolvedArtifactDir = path.resolve(artifactDir);
  const absolute = path.resolve(resolvedArtifactDir, normalized);
  if (!isPathInside(absolute, resolvedArtifactDir)) {
    throw new WorkbenchRunRegistryError({
      status: 403,
      code: "WORKBENCH_FILE_PATH_FORBIDDEN",
      message: "Requested artifact path is outside the run artifact root.",
    });
  }
  const info = await lstat(absolute).catch(() => null);
  if (info === null || !info.isFile() || info.isSymbolicLink()) {
    throw new WorkbenchRunRegistryError({
      status: 404,
      code: "WORKBENCH_FILE_NOT_FOUND",
      message: "Requested artifact file was not found.",
    });
  }
  const [realArtifactDir, realFilePath] = await Promise.all([
    realpath(resolvedArtifactDir),
    realpath(absolute),
  ]);
  if (!isPathInside(realFilePath, realArtifactDir)) {
    throw new WorkbenchRunRegistryError({
      status: 403,
      code: "WORKBENCH_FILE_PATH_FORBIDDEN",
      message:
        "Requested artifact path resolves outside the run artifact root.",
    });
  }
  return {
    bytes: await readFile(realFilePath),
    contentType: contentTypeFor(realFilePath),
    filename: path.basename(absolute),
  };
};
