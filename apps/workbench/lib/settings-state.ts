import type { ValidationIssue } from "./types";

export type SettingsKey =
  | "TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT"
  | "TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION"
  | "TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY"
  | "TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN"
  | "TEST_INTELLIGENCE_MODEL_ENDPOINT"
  | "TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT"
  | "TEST_INTELLIGENCE_TESTCASE_MODEL_DEPLOYMENT"
  | "TEST_INTELLIGENCE_LOGIC_JUDGE_DEPLOYMENT"
  | "TEST_INTELLIGENCE_VISUAL_PRIMARY_DEPLOYMENT"
  | "TEST_INTELLIGENCE_VISUAL_FALLBACK_DEPLOYMENT"
  | "TEST_INTELLIGENCE_REGION_ATTESTED_REGION"
  | "TEST_INTELLIGENCE_REGION_ATTESTATION_SOVEREIGN_SOURCE"
  | "TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY"
  | "TEST_INTELLIGENCE_ALLOW_POLICY_BLOCKED"
  | "NODE_EXTRA_CA_CERTS";

export type SettingsValue = string | boolean;

export type Settings = Record<SettingsKey, SettingsValue>;

export const SETTINGS_BASELINE: Settings = {
  TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT:
    "https://ws-llm-gw.eu-north-1.azure.svc/openai",
  TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION: "2024-10-01-preview",
  TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY: "",
  TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN: "",
  TEST_INTELLIGENCE_MODEL_ENDPOINT:
    "https://ws-foundry.eu-north-1.ai.azure.com",
  TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT:
    "https://ws-foundry-vision.eu-north-1.ai.azure.com",
  TEST_INTELLIGENCE_TESTCASE_MODEL_DEPLOYMENT: "gpt-oss-120b",
  TEST_INTELLIGENCE_LOGIC_JUDGE_DEPLOYMENT: "gpt-oss-120b",
  TEST_INTELLIGENCE_VISUAL_PRIMARY_DEPLOYMENT: "llama-4-maverick-vision",
  TEST_INTELLIGENCE_VISUAL_FALLBACK_DEPLOYMENT: "phi-4-multimodal-instruct",
  TEST_INTELLIGENCE_REGION_ATTESTED_REGION: "eu-north-1",
  TEST_INTELLIGENCE_REGION_ATTESTATION_SOVEREIGN_SOURCE: true,
  TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY: "",
  TEST_INTELLIGENCE_ALLOW_POLICY_BLOCKED: false,
  NODE_EXTRA_CA_CERTS: "",
};

export const REQUIRED_SETTINGS: readonly SettingsKey[] = [
  "TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT",
  "TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION",
  "TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY",
  "TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN",
  "TEST_INTELLIGENCE_MODEL_ENDPOINT",
  "TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT",
  "TEST_INTELLIGENCE_TESTCASE_MODEL_DEPLOYMENT",
  "TEST_INTELLIGENCE_LOGIC_JUDGE_DEPLOYMENT",
  "TEST_INTELLIGENCE_VISUAL_PRIMARY_DEPLOYMENT",
  "TEST_INTELLIGENCE_VISUAL_FALLBACK_DEPLOYMENT",
  "TEST_INTELLIGENCE_REGION_ATTESTED_REGION",
  "TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY",
];

export const SETTINGS_KEYS = Object.keys(SETTINGS_BASELINE) as SettingsKey[];

const URL_FIELDS: readonly SettingsKey[] = [
  "TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT",
  "TEST_INTELLIGENCE_MODEL_ENDPOINT",
  "TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT",
];

const PATH_FIELDS: readonly SettingsKey[] = ["NODE_EXTRA_CA_CERTS"];
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
const SAFE_WORKSPACE_RELATIVE_PATH = /^[A-Za-z0-9._/-]+$/u;

function isWorkspaceRelativePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (
    trimmed.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH.test(trimmed) ||
    !SAFE_WORKSPACE_RELATIVE_PATH.test(trimmed)
  ) {
    return false;
  }
  const segments = trimmed.split("/");
  return segments.every((segment) => segment !== "." && segment !== "..");
}

export type SettingsAction =
  | { type: "set"; key: SettingsKey; value: SettingsValue }
  | { type: "hydrate"; values: Partial<Settings> }
  | { type: "discard" }
  | { type: "commit" };

export function settingsReducer(
  state: Settings,
  action: SettingsAction,
): Settings {
  switch (action.type) {
    case "set":
      return { ...state, [action.key]: action.value };
    case "hydrate":
      return { ...SETTINGS_BASELINE, ...action.values };
    case "discard":
      return { ...SETTINGS_BASELINE };
    case "commit":
      return { ...state };
  }
}

export function prettyEnv(env: string): string {
  return env.replace(/^TEST_INTELLIGENCE_/, "").toLowerCase();
}

export function validateSettings(values: Settings): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const key of REQUIRED_SETTINGS) {
    const v = values[key];
    if (v === undefined || v === null || v === "" || v === false) {
      issues.push({
        field: key,
        label: prettyEnv(key),
        message: "Required field is empty",
      });
    }
  }
  for (const key of URL_FIELDS) {
    const v = values[key];
    if (typeof v !== "string" || v.length === 0) continue;
    try {
      const u = new URL(v);
      if (!/^https?:$/.test(u.protocol)) {
        issues.push({
          field: key,
          label: prettyEnv(key),
          message: "URL protocol must be http or https",
        });
      }
    } catch {
      issues.push({
        field: key,
        label: prettyEnv(key),
        message: "URL is malformed",
      });
    }
  }
  for (const key of PATH_FIELDS) {
    const v = values[key];
    if (typeof v !== "string" || v.trim().length === 0) continue;
    const trimmed = v.trim();
    if (!isWorkspaceRelativePath(trimmed)) {
      issues.push({
        field: key,
        label: prettyEnv(key),
        message: "Expected a workspace-relative path",
      });
    }
  }
  return issues;
}

export interface SettingsDiff {
  key: SettingsKey;
  from: SettingsValue;
  to: SettingsValue;
}

export function diffSettings(
  current: Settings,
  baseline: Settings,
): SettingsDiff[] {
  const out: SettingsDiff[] = [];
  for (const key of Object.keys(current) as SettingsKey[]) {
    if (current[key] !== baseline[key]) {
      out.push({ key, from: baseline[key], to: current[key] });
    }
  }
  return out;
}

export function exportEnv(values: Settings): string {
  return (
    Object.entries(values)
      .map(([k, v]) => {
        if (typeof v === "boolean") return `${k}=${v ? 1 : 0}`;
        return `${k}=${v}`;
      })
      .join("\n") + "\n"
  );
}

export function formatDiffValue(key: SettingsKey, v: SettingsValue): string {
  if (v === "") return "<empty>";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (/API_KEY|SIGNING_KEY/.test(key)) {
    return v.slice(0, 4) + "…" + v.slice(-3);
  }
  return v;
}

export function isSettingsDirty(state: Settings): boolean {
  return (Object.keys(SETTINGS_BASELINE) as SettingsKey[]).some(
    (k) => state[k] !== SETTINGS_BASELINE[k],
  );
}

export function extractSettingsOverrides(values: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const key of Object.keys(values) as SettingsKey[]) {
    if (values[key] !== SETTINGS_BASELINE[key]) {
      out[key] = values[key];
    }
  }
  return out;
}

export interface SettingsFieldSpec {
  env: SettingsKey;
  label: string;
  kind: "text" | "url" | "secret" | "switch";
  required?: boolean;
  placeholder?: string;
  helper?: string;
}

export interface SettingsGroupSpec {
  id: string;
  title: string;
  description: string;
  fields: SettingsFieldSpec[];
}

export const SETTINGS_GROUPS: readonly SettingsGroupSpec[] = [
  {
    id: "llm-gateway",
    title: "LLM gateway",
    description:
      "Required for run/figma-export routes. The Azure OpenAI resource the runtime calls for generation and judging.",
    fields: [
      {
        env: "TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT",
        label: "Gateway endpoint",
        kind: "url",
        required: true,
        placeholder: "https://<resource>.openai.azure.com",
      },
      {
        env: "TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION",
        label: "API version",
        kind: "text",
        required: true,
        placeholder: "2024-10-01-preview",
      },
      {
        env: "TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY",
        label: "Bearer / API key",
        kind: "secret",
        required: true,
        placeholder: "sk-…",
      },
      {
        env: "TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN",
        label: "Figma API token",
        kind: "secret",
        required: true,
        placeholder: "figd_…",
      },
    ],
  },
  {
    id: "foundry",
    title: "Foundry account",
    description:
      "Azure AI Foundry account endpoints used by the test-case and visual paths. Separate from the gateway endpoint above.",
    fields: [
      {
        env: "TEST_INTELLIGENCE_MODEL_ENDPOINT",
        label: "Text model endpoint",
        kind: "url",
        required: true,
        placeholder: "https://<account>.ai.azure.com",
      },
      {
        env: "TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT",
        label: "Visual model endpoint",
        kind: "url",
        required: true,
        placeholder: "https://<account>-vision.ai.azure.com",
      },
    ],
  },
  {
    id: "deployments",
    title: "Deployment pins",
    description:
      "Pinned deployment names. Each pin is wired to a specific role in the pipeline; do not change without an attested rollout.",
    fields: [
      {
        env: "TEST_INTELLIGENCE_TESTCASE_MODEL_DEPLOYMENT",
        label: "Test-case generator",
        kind: "text",
        placeholder: "gpt-oss-120b",
      },
      {
        env: "TEST_INTELLIGENCE_LOGIC_JUDGE_DEPLOYMENT",
        label: "Logic judge",
        kind: "text",
        placeholder: "gpt-oss-120b",
      },
      {
        env: "TEST_INTELLIGENCE_VISUAL_PRIMARY_DEPLOYMENT",
        label: "Visual — primary",
        kind: "text",
        placeholder: "llama-4-maverick-vision",
      },
      {
        env: "TEST_INTELLIGENCE_VISUAL_FALLBACK_DEPLOYMENT",
        label: "Visual — fallback",
        kind: "text",
        placeholder: "phi-4-multimodal-instruct",
      },
    ],
  },
  {
    id: "region",
    title: "Region attestation",
    description:
      "Sovereign-region pin and attestation source. The gateway will refuse the run if its inferred region disagrees with this value.",
    fields: [
      {
        env: "TEST_INTELLIGENCE_REGION_ATTESTED_REGION",
        label: "Attested region",
        kind: "text",
        placeholder: "eu-north-1",
      },
      {
        env: "TEST_INTELLIGENCE_REGION_ATTESTATION_SOVEREIGN_SOURCE",
        label: "Sovereign source",
        kind: "switch",
        helper:
          "1 — attestation comes from a sovereign source. 0 — degraded; emit warn-tagged evidence.",
      },
      {
        env: "TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY",
        label: "Signing key",
        kind: "secret",
        required: true,
        placeholder: "operator-managed HMAC signing key",
        helper:
          "Required to sign region-attestation evidence artifacts. Keep this operator-managed and tenant-local.",
      },
    ],
  },
  {
    id: "runtime-trust",
    title: "Runtime trust",
    description:
      "Optional enterprise TLS trust configuration used for Figma REST and image export calls.",
    fields: [
      {
        env: "NODE_EXTRA_CA_CERTS",
        label: "CA bundle path",
        kind: "text",
        placeholder: ".test-intelligence/trust/company-ca.pem",
        helper:
          "Optional workspace-local PEM bundle path for corporate TLS interception.",
      },
    ],
  },
  {
    id: "policy",
    title: "Policy",
    description:
      "Global override. Mirrors --allow-policy-blocked. When ON, the runtime will still emit artifacts even if the policy gate rejects.",
    fields: [
      {
        env: "TEST_INTELLIGENCE_ALLOW_POLICY_BLOCKED",
        label: "Allow policy-blocked artifacts",
        kind: "switch",
        helper:
          "Cleared after every release-gate run unless an attested rationale is filed.",
      },
    ],
  },
];
