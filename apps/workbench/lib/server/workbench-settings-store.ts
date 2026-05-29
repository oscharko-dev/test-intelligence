import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  SETTINGS_BASELINE,
  SETTINGS_KEYS,
  type Settings,
  type SettingsKey,
  type SettingsValue,
} from "@/lib/settings-state";

const SETTINGS_FILE_VERSION = 1;
const MAX_IMPORT_ENV_BYTES = 128 * 1024;

export const WORKBENCH_IMPORT_ENV_TEMPLATE = `# Test Intelligence Workbench import.env
# Fill the required values, then import this file in the Workbench settings.
# Keep this file local. It may contain secrets after you fill it.

# Required: text-generation endpoint. For Azure Foundry/OpenAI-compatible
# deployments prefer the v1 base URL, for example:
# https://<account>.services.ai.azure.com/openai/v1
TEST_INTELLIGENCE_MODEL_ENDPOINT=

# Required: API key or bearer token for the text-generation endpoint.
TEST_INTELLIGENCE_LLM_API_KEY=

# Required: Figma access token for Figma URL ingestion.
TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN=

# Required: Figma credential mode for import governance.
# Supported now: personal_access_token and enterprise_service_token.
# oauth_access_token is schema-ready and fails closed until OAuth resolution is added.
TEST_INTELLIGENCE_FIGMA_CREDENTIAL_MODE=personal_access_token

# Required when visual sidecar is enabled. Prefer the matching v1 base URL.
TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT=

# Required deployment pins. Use the model/deployment names provided by your platform team.
TEST_INTELLIGENCE_TESTCASE_MODEL_DEPLOYMENT=gpt-oss-120b
TEST_INTELLIGENCE_LOGIC_JUDGE_DEPLOYMENT=gpt-oss-120b
TEST_INTELLIGENCE_VISUAL_PRIMARY_DEPLOYMENT=llama-4-maverick-vision
TEST_INTELLIGENCE_VISUAL_FALLBACK_DEPLOYMENT=phi-4-multimodal-instruct

# Optional workspace-local enterprise TLS trust bundle for Figma REST/image export calls.
NODE_EXTRA_CA_CERTS=

# Optional gateway metadata, if your platform exposes a separate gateway resource.
TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT=
TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION=2024-10-01-preview
TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY=

# Compliance/runtime pins.
TEST_INTELLIGENCE_REGION_ATTESTED_REGION=eu-north-1
TEST_INTELLIGENCE_REGION_ATTESTATION_SOVEREIGN_SOURCE=1
TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY=
TEST_INTELLIGENCE_ALLOW_POLICY_BLOCKED=0
`;

interface PersistedWorkbenchSettingsFile {
  readonly version: number;
  readonly settings: Partial<Record<SettingsKey, SettingsValue>>;
}

const resolveRepoRootFromEnv = (env: NodeJS.ProcessEnv): string => {
  const explicit = env.WORKBENCH_REPO_ROOT?.trim();
  if (explicit) return path.resolve(explicit);
  const cwd = process.cwd();
  return cwd.endsWith(path.join("apps", "workbench"))
    ? path.resolve(cwd, "../..")
    : path.resolve(cwd);
};

const settingsFilePath = (env: NodeJS.ProcessEnv): string =>
  path.join(
    resolveRepoRootFromEnv(env),
    ".test-intelligence",
    "local-runtime",
    "workbench-settings.json",
  );

const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/u;

const resolveWorkspaceLocalPath = (
  filePath: string,
  env: NodeJS.ProcessEnv,
): string => {
  const repoRoot = resolveRepoRootFromEnv(env);
  const trimmed = filePath.trim();
  if (
    trimmed.length === 0 ||
    path.isAbsolute(trimmed) ||
    WINDOWS_ABSOLUTE_PATH.test(trimmed) ||
    !/^[A-Za-z0-9._/-]+$/u.test(trimmed)
  ) {
    throw new Error(
      "Selected .env path must be relative to the Workbench workspace.",
    );
  }
  const normalized = path.normalize(trimmed);
  if (
    normalized === "." ||
    normalized.startsWith("..") ||
    path.isAbsolute(normalized) ||
    WINDOWS_ABSOLUTE_PATH.test(normalized)
  ) {
    throw new Error(
      "Selected .env path must be relative to the Workbench workspace.",
    );
  }
  return path.join(repoRoot, normalized);
};

const normalizeSettings = (value: unknown): Partial<Settings> => {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  const out: Partial<Settings> = {};
  for (const key of SETTINGS_KEYS) {
    const next = raw[key];
    const baseline = SETTINGS_BASELINE[key];
    if (typeof baseline === "boolean") {
      if (typeof next === "boolean") out[key] = next;
      continue;
    }
    if (typeof next === "string") out[key] = next.trim();
  }
  return out;
};

const settingsOverrides = (settings: Partial<Settings>): Partial<Settings> => {
  const out: Partial<Settings> = {};
  for (const key of SETTINGS_KEYS) {
    const value = settings[key];
    if (value === undefined) continue;
    if (value === SETTINGS_BASELINE[key]) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    out[key] = value;
  }
  return out;
};

const parseDotenv = (content: string): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed);
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
};

const readFirstEnv = (
  env: Record<string, string | undefined>,
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

const readBooleanEnv = (
  env: Record<string, string | undefined>,
  names: readonly string[],
): boolean | undefined => {
  const value = readFirstEnv(env, names)?.toLowerCase();
  if (value === undefined) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
};

const settingsFromEnv = (
  env: Record<string, string | undefined>,
): Partial<Settings> => {
  const values: Partial<Settings> = {};
  const setString = (key: SettingsKey, names: readonly string[]): void => {
    const value = readFirstEnv(env, names);
    if (value !== undefined) values[key] = value;
  };
  const setBoolean = (key: SettingsKey, names: readonly string[]): void => {
    const value = readBooleanEnv(env, names);
    if (value !== undefined) values[key] = value;
  };

  setString("TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT", [
    "TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT",
  ]);
  setString("TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION", [
    "TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION",
  ]);
  setString("TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY", [
    "TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY",
    "TEST_INTELLIGENCE_LLM_API_KEY",
    "WORKSPACE_TEST_SPACE_LLM_API_KEY",
  ]);
  setString("TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN", [
    "TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN",
    "FIGMA_ACCESS_TOKEN",
  ]);
  setString("TEST_INTELLIGENCE_FIGMA_CREDENTIAL_MODE", [
    "TEST_INTELLIGENCE_FIGMA_CREDENTIAL_MODE",
    "FIGMA_CREDENTIAL_MODE",
  ]);
  setString("TEST_INTELLIGENCE_MODEL_ENDPOINT", [
    "TEST_INTELLIGENCE_MODEL_ENDPOINT",
    "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT",
  ]);
  setString("TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT", [
    "TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT",
    "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT",
  ]);
  setString("TEST_INTELLIGENCE_TESTCASE_MODEL_DEPLOYMENT", [
    "TEST_INTELLIGENCE_TESTCASE_MODEL_DEPLOYMENT",
    "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT",
  ]);
  setString("TEST_INTELLIGENCE_LOGIC_JUDGE_DEPLOYMENT", [
    "TEST_INTELLIGENCE_LOGIC_JUDGE_DEPLOYMENT",
    "WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT",
  ]);
  setString("TEST_INTELLIGENCE_VISUAL_PRIMARY_DEPLOYMENT", [
    "TEST_INTELLIGENCE_VISUAL_PRIMARY_DEPLOYMENT",
    "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
  ]);
  setString("TEST_INTELLIGENCE_VISUAL_FALLBACK_DEPLOYMENT", [
    "TEST_INTELLIGENCE_VISUAL_FALLBACK_DEPLOYMENT",
    "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
  ]);
  setString("TEST_INTELLIGENCE_REGION_ATTESTED_REGION", [
    "TEST_INTELLIGENCE_REGION_ATTESTED_REGION",
    "WORKSPACE_TEST_SPACE_REGION_ATTESTED_REGION",
  ]);
  setBoolean("TEST_INTELLIGENCE_REGION_ATTESTATION_SOVEREIGN_SOURCE", [
    "TEST_INTELLIGENCE_REGION_ATTESTATION_SOVEREIGN_SOURCE",
    "WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SOVEREIGN_SOURCE",
  ]);
  setString("TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY", [
    "TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY",
    "WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SIGNING_KEY",
  ]);
  setBoolean("TEST_INTELLIGENCE_ALLOW_POLICY_BLOCKED", [
    "TEST_INTELLIGENCE_ALLOW_POLICY_BLOCKED",
  ]);
  setString("NODE_EXTRA_CA_CERTS", ["NODE_EXTRA_CA_CERTS"]);

  return values;
};

export const readPersistedWorkbenchSettingsOverrides = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<Partial<Settings>> => {
  try {
    const raw = await readFile(settingsFilePath(env), "utf8");
    const parsed = JSON.parse(raw) as PersistedWorkbenchSettingsFile;
    return settingsOverrides(normalizeSettings(parsed.settings));
  } catch {
    return {};
  }
};

export const readWorkbenchSettings = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<Settings> => ({
  ...SETTINGS_BASELINE,
  ...settingsFromEnv(env),
  ...(await readPersistedWorkbenchSettingsOverrides(env)),
});

export const writeWorkbenchSettings = async (
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Settings> => {
  const settings = { ...SETTINGS_BASELINE, ...normalizeSettings(value) };
  const filePath = settingsFilePath(env);
  const runtimeDir = path.dirname(filePath);
  const tmpFilePath = `${filePath}.tmp`;
  const payload: PersistedWorkbenchSettingsFile = {
    version: SETTINGS_FILE_VERSION,
    settings,
  };
  await mkdir(runtimeDir, { recursive: true });
  try {
    await writeFile(tmpFilePath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(tmpFilePath, 0o600).catch(() => undefined);
    await rename(tmpFilePath, filePath);
    await chmod(filePath, 0o600).catch(() => undefined);
  } catch (error) {
    await rm(tmpFilePath, { force: true });
    throw error;
  }
  return settings;
};

export const importWorkbenchSettingsFromEnvContent = async (
  content: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Settings> => {
  if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_ENV_BYTES) {
    throw new Error("Uploaded .env content is too large for Workbench import.");
  }
  const imported = settingsFromEnv(parseDotenv(content));
  const current = await readWorkbenchSettings(env);
  return writeWorkbenchSettings({ ...current, ...imported }, env);
};

export const importWorkbenchSettingsFromEnvPath = async (
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Settings> => {
  const resolvedPath = resolveWorkspaceLocalPath(filePath, env);
  const info = await stat(resolvedPath);
  if (!info.isFile()) {
    throw new Error("Selected .env path is not a file.");
  }
  if (info.size > MAX_IMPORT_ENV_BYTES) {
    throw new Error("Selected .env file is too large for Workbench import.");
  }
  return importWorkbenchSettingsFromEnvContent(
    await readFile(resolvedPath, "utf8"),
    env,
  );
};
