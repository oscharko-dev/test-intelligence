import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import isPathInside from "is-path-inside";
import {
  SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS,
  type RegionAttestationHostingRegion,
} from "@oscharko-dev/ti-contracts";
import type { RunConfig, ValidationIssue } from "@/lib/types";
import { looksLikeFigmaDesignUrl } from "@/lib/runs-form";
import {
  SETTINGS_BASELINE,
  SETTINGS_KEYS,
  type SettingsKey,
} from "@/lib/settings-state";
import { readPersistedWorkbenchSettingsOverrides } from "./workbench-settings-store";

export interface WorkbenchEnvStatus {
  featureGate: boolean;
  modelEndpoint: boolean;
  modelApiKey: boolean;
  modelDeployment: boolean;
  figmaToken: boolean;
  visualEndpoint: boolean;
  visualPrimaryDeployment: boolean;
  visualFallbackDeployment: boolean;
}

export interface ResolvedWorkbenchEnv {
  endpoint: string;
  deployment: string;
  apiKey: string;
  figmaToken: string;
  ictRegisterRef: string;
  visualEndpoint: string;
  visualPrimaryDeployment: string;
  visualFallbackDeployment: string;
  regionAttestedRegion: RegionAttestationHostingRegion;
  regionAttestationSovereignSource: boolean;
  regionAttestationSigningKey: string;
  logicJudgeDeployment?: string;
  a11yJudgeDeployment?: string;
  coveragePlannerDeployment?: string;
  riskRankerDeployment?: string;
  status: WorkbenchEnvStatus;
}

export interface PreparedWorkbenchRun {
  config: RunConfig;
  jobId: string;
  generatedAt: string;
  repoRoot: string;
  outputRoot: string;
  allowedOutputRoots: string[];
  artifactDir: string;
  caCertPath?: string;
  customContextMarkdown?: string;
  env: ResolvedWorkbenchEnv;
}

export class WorkbenchRunValidationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: readonly ValidationIssue[];

  constructor({
    status,
    code,
    message,
    issues = [],
  }: {
    status: number;
    code: string;
    message: string;
    issues?: readonly ValidationIssue[];
  }) {
    super(message);
    this.name = "WorkbenchRunValidationError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

const DEFAULT_TEST_GENERATION_DEPLOYMENT = "gpt-oss-120b";
const DEFAULT_VISUAL_PRIMARY_DEPLOYMENT = "llama-4-maverick-vision";
const DEFAULT_VISUAL_FALLBACK_DEPLOYMENT = "phi-4-multimodal-instruct";
const DEFAULT_LOCAL_ICT_REGISTER_REF = "test-intelligence-local-ict";
const MAX_CUSTOM_CONTEXT_BYTES = 256 * 1024;
const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,95}$/u;

const truthy = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
};

const SUPPORTED_REGION_ATTESTATION_HOSTING_REGION_SET = new Set<string>(
  SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS,
);

const supportedRegion = (
  value: string | undefined,
): RegionAttestationHostingRegion | undefined =>
  value !== undefined &&
  SUPPORTED_REGION_ATTESTATION_HOSTING_REGION_SET.has(value)
    ? (value as RegionAttestationHostingRegion)
    : undefined;

const readFirstEnv = (
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): string | undefined => {
  for (const name of names) {
    const raw = env[name];
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value.length > 0) return value;
  }
  return undefined;
};

const readWorkbenchRequestSettings = (
  value: unknown,
): Partial<Record<SettingsKey, string | boolean>> => {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  const out: Partial<Record<SettingsKey, string | boolean>> = {};
  for (const key of SETTINGS_KEYS) {
    const v = raw[key];
    if (v === undefined) continue;
    const baseline = SETTINGS_BASELINE[key];
    if (v === baseline) continue;
    if (typeof v === "string") {
      out[key] = v;
    } else if (typeof v === "boolean") {
      out[key] = v;
    }
  }
  return out;
};

const mergeWorkbenchEnvWithSettings = (
  env: NodeJS.ProcessEnv,
  settings: Partial<Record<SettingsKey, string | boolean>>,
): NodeJS.ProcessEnv => {
  if (Object.keys(settings).length === 0) return env;
  const resolved = { ...env };
  for (const key of SETTINGS_KEYS) {
    const value = settings[key];
    if (value === undefined) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    if (typeof value === "boolean") {
      resolved[key] = value ? "1" : "0";
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
};

export const resolveRepoRoot = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const explicit = env.WORKBENCH_REPO_ROOT?.trim();
  if (explicit) return path.resolve(explicit);
  const cwd = process.cwd();
  return cwd.endsWith(path.join("apps", "workbench"))
    ? path.resolve(cwd, "../..")
    : path.resolve(cwd);
};

export { isPathInside };

const resolveAllowedOutputRoots = (
  repoRoot: string,
  env: NodeJS.ProcessEnv,
): string[] => {
  const configured =
    env.WORKBENCH_OUTPUT_ROOTS?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];
  return [
    repoRoot,
    ...configured.map((entry) => path.resolve(repoRoot, entry)),
  ];
};

export const safeRelativePath = (root: string, filePath: string): string =>
  path.relative(root, filePath).split(path.sep).join("/");

const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/u;

const resolveWorkspaceRelativePath = (
  repoRoot: string,
  rawPath: string,
): string | null => {
  const trimmed = rawPath.trim();
  if (
    trimmed.length === 0 ||
    path.isAbsolute(trimmed) ||
    WINDOWS_ABSOLUTE_PATH.test(trimmed)
  ) {
    return null;
  }
  const normalized = path.normalize(trimmed);
  if (
    normalized === "." ||
    normalized.startsWith("..") ||
    path.isAbsolute(normalized) ||
    WINDOWS_ABSOLUTE_PATH.test(normalized)
  ) {
    return null;
  }
  return path.join(repoRoot, normalized);
};

export const formatTimestampForRunSubdir = (generatedAt: string): string =>
  generatedAt.replaceAll(":", "-").replaceAll(".", "-");

export const resolveRunOutputDir = ({
  outputRoot,
  outputRunSubdir,
  jobId,
  generatedAt,
}: {
  outputRoot: string;
  outputRunSubdir: RunConfig["outputRunSubdir"];
  jobId: string;
  generatedAt: string;
}): string => {
  if (outputRunSubdir === "job-id") return path.join(outputRoot, jobId);
  if (outputRunSubdir === "timestamp") {
    return path.join(outputRoot, formatTimestampForRunSubdir(generatedAt));
  }
  return outputRoot;
};

export const resolveWorkbenchEnv = (
  env: NodeJS.ProcessEnv,
): ResolvedWorkbenchEnv => {
  if (env.WORKBENCH_RUNNER_MODE === "mock") {
    return {
      endpoint: "mock://test-intelligence",
      deployment: "mock-test-generation",
      apiKey: "mock-api-key",
      figmaToken: "mock-figma-token",
      ictRegisterRef: DEFAULT_LOCAL_ICT_REGISTER_REF,
      visualEndpoint: "mock://test-intelligence-visual",
      visualPrimaryDeployment: "mock-visual-primary",
      visualFallbackDeployment: "mock-visual-fallback",
      regionAttestedRegion: "eu-north-1",
      regionAttestationSovereignSource: true,
      regionAttestationSigningKey: "mock-region-attestation-signing-key",
      status: {
        featureGate: true,
        modelEndpoint: true,
        modelApiKey: true,
        modelDeployment: true,
        figmaToken: true,
        visualEndpoint: true,
        visualPrimaryDeployment: true,
        visualFallbackDeployment: true,
      },
    };
  }

  const featureGateOverride =
    truthy(readFirstEnv(env, ["TEST_INTELLIGENCE_ENABLED"])) ||
    truthy(readFirstEnv(env, ["FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE"]));
  const endpoint = readFirstEnv(env, [
    "TEST_INTELLIGENCE_MODEL_ENDPOINT",
    "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT",
  ]);
  const apiKey = readFirstEnv(env, [
    "TEST_INTELLIGENCE_LLM_API_KEY",
    "WORKSPACE_TEST_SPACE_LLM_API_KEY",
    "TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY",
  ]);
  const deployment =
    readFirstEnv(env, [
      "TEST_INTELLIGENCE_TESTCASE_MODEL_DEPLOYMENT",
      "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT",
    ]) ?? DEFAULT_TEST_GENERATION_DEPLOYMENT;
  const visualEndpoint =
    readFirstEnv(env, [
      "TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT",
      "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT",
    ]) ?? endpoint;
  const visualPrimaryDeployment =
    readFirstEnv(env, [
      "TEST_INTELLIGENCE_VISUAL_PRIMARY_DEPLOYMENT",
      "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
    ]) ?? DEFAULT_VISUAL_PRIMARY_DEPLOYMENT;
  const visualFallbackDeployment =
    readFirstEnv(env, [
      "TEST_INTELLIGENCE_VISUAL_FALLBACK_DEPLOYMENT",
      "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
    ]) ?? DEFAULT_VISUAL_FALLBACK_DEPLOYMENT;
  const figmaToken = readFirstEnv(env, [
    "FIGMA_ACCESS_TOKEN",
    "TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN",
  ]);
  const featureGate =
    featureGateOverride ||
    (endpoint !== undefined &&
      apiKey !== undefined &&
      figmaToken !== undefined);
  const ictRegisterRef =
    readFirstEnv(env, [
      "TEST_INTELLIGENCE_ICT_REGISTER_REF",
      "WORKSPACE_TEST_SPACE_ICT_REGISTER_REF",
    ]) ?? DEFAULT_LOCAL_ICT_REGISTER_REF;
  const logicJudgeDeployment = readFirstEnv(env, [
    "TEST_INTELLIGENCE_LOGIC_JUDGE_DEPLOYMENT",
    "WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT",
  ]);
  const a11yJudgeDeployment = readFirstEnv(env, [
    "TEST_INTELLIGENCE_A11Y_JUDGE_DEPLOYMENT",
    "WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT",
  ]);
  const coveragePlannerDeployment = readFirstEnv(env, [
    "TEST_INTELLIGENCE_COVERAGE_PLANNER_DEPLOYMENT",
    "WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT",
  ]);
  const riskRankerDeployment = readFirstEnv(env, [
    "TEST_INTELLIGENCE_RISK_RANKER_DEPLOYMENT",
    "WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT",
  ]);
  const baselineRegion =
    typeof SETTINGS_BASELINE.TEST_INTELLIGENCE_REGION_ATTESTED_REGION ===
    "string"
      ? SETTINGS_BASELINE.TEST_INTELLIGENCE_REGION_ATTESTED_REGION
      : undefined;
  const regionAttestedRegion = supportedRegion(
    readFirstEnv(env, [
      "TEST_INTELLIGENCE_REGION_ATTESTED_REGION",
      "WORKSPACE_TEST_SPACE_REGION_ATTESTED_REGION",
    ]) ?? baselineRegion,
  );
  const regionAttestationSovereignSource = truthy(
    readFirstEnv(env, [
      "TEST_INTELLIGENCE_REGION_ATTESTATION_SOVEREIGN_SOURCE",
      "WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SOVEREIGN_SOURCE",
    ]) ??
      (SETTINGS_BASELINE.TEST_INTELLIGENCE_REGION_ATTESTATION_SOVEREIGN_SOURCE
        ? "1"
        : "0"),
  );
  const regionAttestationSigningKey = readFirstEnv(env, [
    "TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY",
    "WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SIGNING_KEY",
  ]);
  const status: WorkbenchEnvStatus = {
    featureGate,
    modelEndpoint: endpoint !== undefined,
    modelApiKey: apiKey !== undefined,
    modelDeployment: deployment.length > 0,
    figmaToken: figmaToken !== undefined,
    visualEndpoint: visualEndpoint !== undefined,
    visualPrimaryDeployment: visualPrimaryDeployment.length > 0,
    visualFallbackDeployment: visualFallbackDeployment.length > 0,
  };
  const missing: string[] = [];
  if (!status.featureGate) {
    missing.push(
      "TEST_INTELLIGENCE_ENABLED or FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE",
    );
  }
  if (endpoint === undefined) {
    missing.push(
      "TEST_INTELLIGENCE_MODEL_ENDPOINT or WORKSPACE_TEST_SPACE_MODEL_ENDPOINT",
    );
  }
  if (apiKey === undefined) {
    missing.push(
      "TEST_INTELLIGENCE_LLM_API_KEY, TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY, or WORKSPACE_TEST_SPACE_LLM_API_KEY",
    );
  }
  if (figmaToken === undefined) {
    missing.push("FIGMA_ACCESS_TOKEN or TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN");
  }
  if (regionAttestedRegion === undefined) {
    missing.push(
      `TEST_INTELLIGENCE_REGION_ATTESTED_REGION (${SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS.join(", ")})`,
    );
  }
  if (regionAttestationSigningKey === undefined) {
    missing.push(
      "TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY or WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SIGNING_KEY",
    );
  }
  if (
    missing.length > 0 ||
    endpoint === undefined ||
    apiKey === undefined ||
    figmaToken === undefined ||
    regionAttestedRegion === undefined ||
    regionAttestationSigningKey === undefined
  ) {
    throw new WorkbenchRunValidationError({
      status: 503,
      code: "WORKBENCH_RUNNER_UNCONFIGURED",
      message: `Workbench runner is not configured. Missing: ${missing.join(", ")}.`,
    });
  }
  return {
    endpoint,
    deployment,
    apiKey,
    figmaToken,
    ictRegisterRef,
    visualEndpoint: visualEndpoint ?? endpoint,
    visualPrimaryDeployment,
    visualFallbackDeployment,
    regionAttestedRegion,
    regionAttestationSovereignSource,
    regionAttestationSigningKey,
    ...(logicJudgeDeployment !== undefined ? { logicJudgeDeployment } : {}),
    ...(a11yJudgeDeployment !== undefined ? { a11yJudgeDeployment } : {}),
    ...(coveragePlannerDeployment !== undefined
      ? { coveragePlannerDeployment }
      : {}),
    ...(riskRankerDeployment !== undefined ? { riskRankerDeployment } : {}),
    status,
  };
};

const parseConfig = (value: unknown): RunConfig => {
  if (typeof value !== "object" || value === null) {
    throw new WorkbenchRunValidationError({
      status: 400,
      code: "INVALID_RUN_CONFIG",
      message: "Request body must be a run configuration object.",
    });
  }
  const raw = value as Record<string, unknown>;
  return {
    figmaUrl: typeof raw.figmaUrl === "string" ? raw.figmaUrl.trim() : "",
    customContext:
      typeof raw.customContext === "string" ? raw.customContext.trim() : "",
    outputDir: typeof raw.outputDir === "string" ? raw.outputDir.trim() : "",
    outputRunSubdir:
      raw.outputRunSubdir === "timestamp" ||
      raw.outputRunSubdir === "job-id" ||
      raw.outputRunSubdir === "none"
        ? raw.outputRunSubdir
        : "job-id",
    visualSidecar: raw.visualSidecar !== false,
    allowPolicyBlocked: raw.allowPolicyBlocked === true,
    caCerts: typeof raw.caCerts === "string" ? raw.caCerts.trim() : "",
    jobIdOverride:
      typeof raw.jobIdOverride === "string" ? raw.jobIdOverride.trim() : "",
  };
};

interface WorkbenchRunPayload {
  config: RunConfig;
  settings: Partial<Record<SettingsKey, string | boolean>>;
}

const parsePayload = (body: unknown): WorkbenchRunPayload => {
  const config = parseConfig(body);
  const settings =
    typeof body === "object" && body !== null && "settings" in body
      ? readWorkbenchRequestSettings((body as { settings?: unknown }).settings)
      : {};
  return { config, settings };
};

export const prepareWorkbenchRun = async ({
  body,
  env,
  now = new Date(),
}: {
  body: unknown;
  env: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<PreparedWorkbenchRun> => {
  const parsed = parsePayload(body);
  const config = parsed.config;
  const persistedSettings = await readPersistedWorkbenchSettingsOverrides(env);
  const requestedEnv = mergeWorkbenchEnvWithSettings(
    mergeWorkbenchEnvWithSettings(env, persistedSettings),
    parsed.settings,
  );
  const issues: ValidationIssue[] = [];
  const figma = looksLikeFigmaDesignUrl(config.figmaUrl);
  if (!figma.ok) {
    issues.push({
      field: "figmaUrl",
      label: "Figma URL",
      message: figma.reason ?? "Invalid Figma URL",
    });
  }
  if (!config.outputDir) {
    issues.push({
      field: "outputDir",
      label: "Output directory",
      message: "Output directory is required",
    });
  }
  if (config.jobIdOverride && !SAFE_JOB_ID.test(config.jobIdOverride)) {
    issues.push({
      field: "jobIdOverride",
      label: "Job ID override",
      message:
        "Use 3-96 letters, numbers, dot, underscore or dash; path separators are not allowed.",
    });
  }
  if (issues.length > 0) {
    throw new WorkbenchRunValidationError({
      status: 400,
      code: "RUN_CONFIG_INVALID",
      message: "Run configuration is invalid.",
      issues,
    });
  }

  const repoRoot = resolveRepoRoot(requestedEnv);
  let caCertPath: string | undefined;
  const configuredCaCerts =
    config.caCerts || requestedEnv.NODE_EXTRA_CA_CERTS?.trim() || "";
  if (configuredCaCerts) {
    const candidate = resolveWorkspaceRelativePath(repoRoot, configuredCaCerts);
    if (candidate === null) {
      throw new WorkbenchRunValidationError({
        status: 400,
        code: "RUN_CONFIG_INVALID",
        message: "Run configuration is invalid.",
        issues: [
          {
            field: "caCerts",
            label: "NODE_EXTRA_CA_CERTS",
            message: "CA bundle path must be relative to the workspace.",
          },
        ],
      });
    }
    const info = await stat(candidate).catch(() => null);
    if (info === null || !info.isFile()) {
      throw new WorkbenchRunValidationError({
        status: 400,
        code: "RUN_CONFIG_INVALID",
        message: "Run configuration is invalid.",
        issues: [
          {
            field: "caCerts",
            label: "NODE_EXTRA_CA_CERTS",
            message: "CA bundle path must point to a readable file.",
          },
        ],
      });
    }
    caCertPath = candidate;
  }
  const outputRoot = path.resolve(repoRoot, config.outputDir);
  const allowedOutputRoots = resolveAllowedOutputRoots(repoRoot, requestedEnv);
  const mockRunnerMode = requestedEnv.WORKBENCH_RUNNER_MODE === "mock";
  if (!allowedOutputRoots.some((root) => isPathInside(outputRoot, root))) {
    throw new WorkbenchRunValidationError({
      status: 400,
      code: "OUTPUT_ROOT_NOT_ALLOWED",
      message:
        "Output directory must be inside the repository or WORKBENCH_OUTPUT_ROOTS.",
      issues: [
        {
          field: "outputDir",
          label: "Output directory",
          message: "Path is outside the allowed Workbench output roots.",
        },
      ],
    });
  }

  let customContextMarkdown: string | undefined;
  if (config.customContext) {
    const customContextPath = path.resolve(repoRoot, config.customContext);
    if (!isPathInside(customContextPath, repoRoot)) {
      throw new WorkbenchRunValidationError({
        status: 400,
        code: "CUSTOM_CONTEXT_NOT_ALLOWED",
        message: "Custom context path must stay inside the workspace.",
      });
    }
    const info = await stat(customContextPath).catch(() => null);
    if (info === null || !info.isFile()) {
      if (mockRunnerMode) {
        customContextMarkdown = undefined;
      } else {
        throw new WorkbenchRunValidationError({
          status: 400,
          code: "CUSTOM_CONTEXT_MISSING",
          message: "Custom context Markdown file does not exist.",
        });
      }
    } else if (info.size > MAX_CUSTOM_CONTEXT_BYTES) {
      throw new WorkbenchRunValidationError({
        status: 400,
        code: "CUSTOM_CONTEXT_TOO_LARGE",
        message: "Custom context Markdown exceeds the 256 KiB limit.",
      });
    } else {
      customContextMarkdown = await readFile(customContextPath, "utf8");
    }
  }

  const generatedAt = now.toISOString();
  const jobId =
    config.jobIdOverride || `ti-workbench-${Math.trunc(now.getTime())}`;
  const artifactDir = resolveRunOutputDir({
    outputRoot,
    outputRunSubdir: config.outputRunSubdir,
    jobId,
    generatedAt,
  });
  const resolvedEnv = resolveWorkbenchEnv(requestedEnv);

  return {
    config,
    jobId,
    generatedAt,
    repoRoot,
    outputRoot,
    allowedOutputRoots,
    artifactDir,
    ...(caCertPath !== undefined ? { caCertPath } : {}),
    ...(customContextMarkdown !== undefined ? { customContextMarkdown } : {}),
    env: resolvedEnv,
  };
};
