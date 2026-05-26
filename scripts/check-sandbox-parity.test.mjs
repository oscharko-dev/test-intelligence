/**
 * Guard tests for `scripts/check-sandbox-parity.mjs`.
 *
 * The script inlines a copy of
 * `packages/production-runner/src/production-runner.ts:rehydrateReplayCachedGeneratedTestCases`
 * because exporting that helper would change the production source shape
 * and create a new intentional delta.
 * To stop the inline copy from drifting silently, this test asserts that
 * the production-runner source still contains a transformation with the
 * same observable behavior — the four substituted audit fields, the
 * `cacheHit: true` flag, the `sourceJobId` overwrite, and the spread of
 * the stored `list`.
 *
 * If the production-runner rehydration logic changes, this test fails
 * and forces an explicit update to the inline copy in the parity script.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  rehydrateReplayCachedGeneratedTestCases,
  LEGACY_REFERENCE_PINNED_SHA,
} from "./check-sandbox-parity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..");

void test("LEGACY_REFERENCE_PINNED_SHA matches the parity gate's pinned reference", () => {
  assert.equal(
    LEGACY_REFERENCE_PINNED_SHA,
    "006dabdf0abe30b9cac2b742a7238c6625d8e8c1",
  );
});

void test("canonicalJson sorts keys recursively and produces minified bytes (matches packages/security/src/content-hash.ts)", () => {
  const bytes = canonicalJson({ b: 2, a: { d: 4, c: [3, 1] } });
  assert.equal(bytes.toString("utf8"), '{"a":{"c":[3,1],"d":4},"b":2}');
});

void test("rehydrate preserves stored test-case ids", () => {
  const stored = {
    jobId: "captured-job",
    schemaVersion: "1.3.0",
    testCases: [
      {
        id: "tc-abc123",
        audit: {
          jobId: "captured-job",
          generatedAt: "2026-01-01T00:00:00.000Z",
          cacheHit: false,
          cacheKey: "captured-cache-key",
          inputHash: "captured-input",
          promptHash: "captured-prompt",
          schemaHash: "captured-schema",
          contractVersion: "1.39.0",
        },
        title: "preserved title",
      },
    ],
  };
  const out = rehydrateReplayCachedGeneratedTestCases({
    list: stored,
    jobId: "new-job",
    generatedAt: "2026-05-23T00:00:00.000Z",
    hashes: {
      cacheKey: "new-cache-key",
      inputHash: "new-input",
      promptHash: "new-prompt",
      schemaHash: "new-schema",
    },
  });
  assert.equal(out.testCases.length, 1);
  assert.equal(out.testCases[0].id, "tc-abc123");
  assert.equal(out.testCases[0].title, "preserved title");
  assert.equal(out.jobId, "new-job");
  assert.equal(out.testCases[0].sourceJobId, "new-job");
  assert.equal(out.testCases[0].audit.jobId, "new-job");
  assert.equal(out.testCases[0].audit.generatedAt, "2026-05-23T00:00:00.000Z");
  assert.equal(out.testCases[0].audit.cacheHit, true);
  assert.equal(out.testCases[0].audit.cacheKey, "new-cache-key");
  assert.equal(out.testCases[0].audit.inputHash, "new-input");
  assert.equal(out.testCases[0].audit.promptHash, "new-prompt");
  assert.equal(out.testCases[0].audit.schemaHash, "new-schema");
  // Non-substituted audit field is preserved.
  assert.equal(out.testCases[0].audit.contractVersion, "1.39.0");
});

void test("source-search guard: production-runner.ts still contains the rehydration transformation the script inlines", async () => {
  const source = await readFile(
    path.join(
      REPO_ROOT,
      "packages",
      "production-runner",
      "src",
      "production-runner.ts",
    ),
    "utf8",
  );
  // The script's inline copy MUST stay in lockstep with production-runner.
  // Assert the production-runner source contains the canonical signature
  // of the transformation (the function name + the substituted audit
  // fields + the cacheHit flag + the sourceJobId line).
  assert.ok(
    /const rehydrateReplayCachedGeneratedTestCases\s*=/u.test(source),
    "production-runner.ts must declare const rehydrateReplayCachedGeneratedTestCases",
  );
  const requiredFragments = [
    "cacheHit: true",
    "sourceJobId: input.jobId",
    "cacheKey: input.hashes.cacheKey",
    "inputHash: input.hashes.inputHash",
    "promptHash: input.hashes.promptHash",
    "schemaHash: input.hashes.schemaHash",
    "jobId: input.jobId",
    "generatedAt: input.generatedAt",
  ];
  for (const fragment of requiredFragments) {
    assert.ok(
      source.includes(fragment),
      `production-runner.ts must contain '${fragment}'; if the rehydration logic changed, update the inline copy in scripts/check-sandbox-parity.mjs and this guard test together`,
    );
  }
});
