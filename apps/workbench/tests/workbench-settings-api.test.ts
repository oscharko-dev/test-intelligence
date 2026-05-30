import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as importSettings } from "@/app/api/workbench/settings/import/route";
import {
  GET as readSettings,
  PUT as writeSettings,
} from "@/app/api/workbench/settings/route";
import { readWorkbenchSettings } from "@/lib/server/workbench-settings-store";
import { REDACTED_SECRET_VALUE } from "@/lib/settings-state";

const tempWorkspace = (): Promise<string> =>
  mkdtemp(path.join(os.tmpdir(), "ti-workbench-settings-api-"));

const jsonRequest = (body: unknown): Request =>
  new Request("http://localhost/api/workbench/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const expectSensitiveResponseHeaders = (response: Response): void => {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("workbench settings API", () => {
  test("prevents caching on settings reads and writes", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);

    const readResponse = await readSettings();
    expectSensitiveResponseHeaders(readResponse);

    const writeResponse = await writeSettings(
      jsonRequest({
        settings: {
          TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY: "secret-from-ui",
        },
      }) as Parameters<typeof writeSettings>[0],
    );
    expectSensitiveResponseHeaders(writeResponse);
  });

  test("prevents caching on imported settings responses", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);

    const response = await importSettings(
      jsonRequest({
        content: [
          "TEST_INTELLIGENCE_MODEL_ENDPOINT=https://import.test/openai/v1",
          "TEST_INTELLIGENCE_LLM_API_KEY=import-secret",
        ].join("\n"),
      }) as Parameters<typeof importSettings>[0],
    );

    expectSensitiveResponseHeaders(response);
  });

  test("redacts persisted secret values from reads and writes", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);

    const writeResponse = await writeSettings(
      jsonRequest({
        settings: {
          TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY: "secret-from-ui",
          TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN: "figma-secret-from-ui",
          TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY:
            "signing-secret-from-ui",
        },
      }) as Parameters<typeof writeSettings>[0],
    );
    const writePayload = (await writeResponse.json()) as {
      settings: Record<string, unknown>;
    };

    expect(JSON.stringify(writePayload)).not.toContain("secret-from-ui");
    expect(writePayload.settings.TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY).toBe(
      REDACTED_SECRET_VALUE,
    );
    expect(writePayload.settings.TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN).toBe(
      REDACTED_SECRET_VALUE,
    );
    expect(
      writePayload.settings.TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY,
    ).toBe(REDACTED_SECRET_VALUE);

    const readResponse = await readSettings();
    const readPayload = (await readResponse.json()) as {
      settings: Record<string, unknown>;
    };
    expect(JSON.stringify(readPayload)).not.toContain("secret-from-ui");
    expect(readPayload.settings.TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY).toBe(
      REDACTED_SECRET_VALUE,
    );
  });

  test("preserves existing secrets when clients save redacted placeholders", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);

    await writeSettings(
      jsonRequest({
        settings: {
          TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY: "secret-to-preserve",
        },
      }) as Parameters<typeof writeSettings>[0],
    );

    const readResponse = await readSettings();
    const readPayload = (await readResponse.json()) as {
      settings: Record<string, unknown>;
    };
    const saveResponse = await writeSettings(
      jsonRequest({
        settings: {
          ...readPayload.settings,
          TEST_INTELLIGENCE_MODEL_ENDPOINT: "https://changed.test/openai/v1",
        },
      }) as Parameters<typeof writeSettings>[0],
    );
    const savePayload = (await saveResponse.json()) as {
      settings: Record<string, unknown>;
    };

    const effective = await readWorkbenchSettings();
    expect(effective.TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY).toBe(
      "secret-to-preserve",
    );
    expect(effective.TEST_INTELLIGENCE_MODEL_ENDPOINT).toBe(
      "https://changed.test/openai/v1",
    );
    expect(savePayload.settings.TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY).toBe(
      REDACTED_SECRET_VALUE,
    );
  });

  test("redacts imported .env secrets while persisting them for server use", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);

    const response = await importSettings(
      jsonRequest({
        content: [
          "TEST_INTELLIGENCE_LLM_API_KEY=imported-secret-key",
          "TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN=imported-figma-secret",
          "TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY=imported-signing-secret",
        ].join("\n"),
      }) as Parameters<typeof importSettings>[0],
    );
    const payload = (await response.json()) as {
      settings: Record<string, unknown>;
    };

    expect(JSON.stringify(payload)).not.toContain("imported-secret");
    expect(payload.settings.TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY).toBe(
      REDACTED_SECRET_VALUE,
    );
    const effective = await readWorkbenchSettings();
    expect(effective.TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY).toBe(
      "imported-secret-key",
    );
  });
});
