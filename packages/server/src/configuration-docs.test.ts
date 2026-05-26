/**
 * Configuration environment drift guard.
 *
 * Every env-var name referenced by `packages/server/src/constants.ts`
 * and `packages/contracts/src/index.ts` (for the feature gate names) MUST
 * appear in `.env.example`. The test fails loudly when an env var is added
 * in source but not represented in the sample operator configuration.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ENABLE_HSTS_ENV } from "./constants.js";

const TEST_INTELLIGENCE_ENV = "TEST_INTELLIGENCE_ENABLED" as const;
const TEST_INTELLIGENCE_MULTISOURCE_ENV =
  "TEST_INTELLIGENCE_MULTISOURCE_ENABLED" as const;
const TEST_INTELLIGENCE_LOG_LEVEL_ENV = "TEST_INTELLIGENCE_LOG_LEVEL" as const;

// Resolve repo root from this file's location so the path is stable no
// matter which directory `tsx --test` is invoked from (root vs. package).
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const ENV_EXAMPLE_PATH = resolve(REPO_ROOT, ".env.example");

const DOCUMENTED_ENV_VARS = [
  TEST_INTELLIGENCE_ENV,
  TEST_INTELLIGENCE_MULTISOURCE_ENV,
  ENABLE_HSTS_ENV,
  TEST_INTELLIGENCE_LOG_LEVEL_ENV,
  "TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT",
  "TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION",
  "TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY",
] as const;

void describe("configuration environment drift guard", () => {
  void test(".env.example mentions every supported env var", async () => {
    const text = await readFile(ENV_EXAMPLE_PATH, "utf8");
    for (const varName of DOCUMENTED_ENV_VARS) {
      assert.ok(text.includes(varName), `.env.example is missing ${varName}.`);
    }
  });
});
