import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as importSettings } from "@/app/api/workbench/settings/import/route";
import {
  GET as readSettings,
  PUT as writeSettings,
} from "@/app/api/workbench/settings/route";

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
});
