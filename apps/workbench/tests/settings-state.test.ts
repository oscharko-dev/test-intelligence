import { describe, expect, it } from "vitest";
import {
  REQUIRED_SETTINGS,
  SETTINGS_BASELINE,
  diffSettings,
  exportEnv,
  formatDiffValue,
  isSettingsDirty,
  prettyEnv,
  settingsReducer,
  validateSettings,
} from "@/lib/settings-state";

describe("settingsReducer", () => {
  it("set updates exactly one key", () => {
    const next = settingsReducer(SETTINGS_BASELINE, {
      type: "set",
      key: "TEST_INTELLIGENCE_REGION_ATTESTED_REGION",
      value: "us-east-1",
    });
    expect(next.TEST_INTELLIGENCE_REGION_ATTESTED_REGION).toBe("us-east-1");
    expect(next.TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION).toBe(
      SETTINGS_BASELINE.TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION,
    );
  });

  it("discard restores baseline", () => {
    const dirtied = settingsReducer(SETTINGS_BASELINE, {
      type: "set",
      key: "TEST_INTELLIGENCE_REGION_ATTESTED_REGION",
      value: "us-east-1",
    });
    expect(settingsReducer(dirtied, { type: "discard" })).toEqual(
      SETTINGS_BASELINE,
    );
  });

  it("commit returns a copy of the state", () => {
    const out = settingsReducer(SETTINGS_BASELINE, { type: "commit" });
    expect(out).toEqual(SETTINGS_BASELINE);
    expect(out).not.toBe(SETTINGS_BASELINE);
  });
});

describe("validateSettings", () => {
  it("flags the baseline's empty API key — operator must provide one", () => {
    expect(SETTINGS_BASELINE.TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY).toBe("");
    const issues = validateSettings(SETTINGS_BASELINE);
    expect(
      issues.some((i) => i.field === "TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY"),
    ).toBe(true);
  });

  it("returns no issues once required fields are filled in", () => {
    const filled = settingsReducer(SETTINGS_BASELINE, {
      type: "set",
      key: "TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY",
      value: "sk-test-fill-not-a-real-key",
    });
    expect(validateSettings(filled)).toEqual([]);
  });

  it("flags malformed url fields", () => {
    const broken = settingsReducer(SETTINGS_BASELINE, {
      type: "set",
      key: "TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT",
      value: "not a url",
    });
    const issues = validateSettings(broken);
    expect(
      issues.some((i) => i.field === "TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT"),
    ).toBe(true);
  });

  it("flags non-http(s) urls", () => {
    const broken = settingsReducer(SETTINGS_BASELINE, {
      type: "set",
      key: "TEST_INTELLIGENCE_MODEL_ENDPOINT",
      value: "ftp://example.com/foo",
    });
    const issues = validateSettings(broken);
    expect(
      issues.some(
        (i) =>
          i.field === "TEST_INTELLIGENCE_MODEL_ENDPOINT" &&
          i.message.includes("protocol"),
      ),
    ).toBe(true);
  });
});

describe("diffSettings", () => {
  it("reports zero diff against baseline", () => {
    expect(diffSettings(SETTINGS_BASELINE, SETTINGS_BASELINE)).toEqual([]);
  });

  it("reports a single diff for one change", () => {
    const next = settingsReducer(SETTINGS_BASELINE, {
      type: "set",
      key: "TEST_INTELLIGENCE_REGION_ATTESTED_REGION",
      value: "us-east-1",
    });
    const diff = diffSettings(next, SETTINGS_BASELINE);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.key).toBe("TEST_INTELLIGENCE_REGION_ATTESTED_REGION");
    expect(diff[0]?.to).toBe("us-east-1");
  });
});

describe("exportEnv", () => {
  it("emits KEY=value lines with boolean coercion to 1/0", () => {
    const env = exportEnv(SETTINGS_BASELINE);
    expect(env).toContain(
      "TEST_INTELLIGENCE_REGION_ATTESTATION_SOVEREIGN_SOURCE=1",
    );
    expect(env).toContain("TEST_INTELLIGENCE_ALLOW_POLICY_BLOCKED=0");
    expect(env.endsWith("\n")).toBe(true);
  });

  it("preserves the full baseline key set", () => {
    const env = exportEnv(SETTINGS_BASELINE);
    for (const key of Object.keys(SETTINGS_BASELINE)) {
      expect(env).toContain(`${key}=`);
    }
  });
});

describe("formatDiffValue", () => {
  it("masks api keys", () => {
    const out = formatDiffValue(
      "TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY",
      "sk-foundry-abcdef",
    );
    expect(out).not.toBe("sk-foundry-abcdef");
    expect(out).toContain("…");
  });

  it("coerces booleans", () => {
    expect(
      formatDiffValue("TEST_INTELLIGENCE_ALLOW_POLICY_BLOCKED", true),
    ).toBe("1");
    expect(
      formatDiffValue("TEST_INTELLIGENCE_ALLOW_POLICY_BLOCKED", false),
    ).toBe("0");
  });

  it("returns <empty> for empty string", () => {
    expect(
      formatDiffValue("TEST_INTELLIGENCE_REGION_ATTESTED_REGION", ""),
    ).toBe("<empty>");
  });
});

describe("prettyEnv / isSettingsDirty", () => {
  it("prettyEnv strips the workspace prefix and lowercases", () => {
    expect(prettyEnv("TEST_INTELLIGENCE_REGION_ATTESTED_REGION")).toBe(
      "region_attested_region",
    );
  });

  it("isSettingsDirty is false for baseline, true otherwise", () => {
    expect(isSettingsDirty(SETTINGS_BASELINE)).toBe(false);
    const next = settingsReducer(SETTINGS_BASELINE, {
      type: "set",
      key: "TEST_INTELLIGENCE_REGION_ATTESTED_REGION",
      value: "us-east-1",
    });
    expect(isSettingsDirty(next)).toBe(true);
  });

  it("REQUIRED_SETTINGS includes all gateway-essential keys", () => {
    expect(REQUIRED_SETTINGS).toContain(
      "TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY",
    );
  });
});
