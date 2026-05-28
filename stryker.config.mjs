/**
 * Stryker mutation-testing config for the standalone repository.
 *
 * Per issue #24 decision §6.2 (Option B), the mutation budget is focused on
 * two small, security-critical, deeply unit-tested modules:
 *
 *   - `src/error-sanitization.ts`                 (~236 LOC, pure error redaction)
 *   - `packages/server/src/request-security.ts`   (~293 LOC, request-security middleware)
 *
 * Full-source mutation runs would take ~6 hours of GitHub-hosted runner time
 * and produce noisy results on this codebase. The two scoped files are pure,
 * deeply unit-tested, and security-critical — they give a high-signal
 * mutation budget at a bounded cost (target <5 minutes per run).
 *
 * Test runner: `command` runner invoking `tsx --test` against the two
 * co-located test files. `node:test`-based; no jest/vitest layer needed.
 *
 * Operator gate: the nightly workflow runs only when the repository variable
 * `MUTATION_NIGHTLY_ENABLED=true`.
 */

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: "pnpm",
  testRunner: "command",
  commandRunner: {
    command:
      "tsx --test src/error-sanitization.test.ts packages/server/src/request-security.test.ts",
  },
  reporters: ["progress", "clear-text", "html"],
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  mutate: [
    "src/error-sanitization.ts",
    "packages/server/src/request-security.ts",
  ],
  // Concurrency: 2 fits the GitHub-hosted ubuntu-22.04 runner (2 vCPU) cleanly.
  concurrency: 2,
  timeoutMS: 60_000,
  coverageAnalysis: "off",
  thresholds: {
    high: 90,
    low: 80,
    break: 70,
  },
  tempDirName: "node_modules/.cache/stryker-tmp",
  cleanTempDir: true,
  // Disable in-place mutation; sandboxing avoids race conditions when running
  // under the command runner with shared module state.
  inPlace: false,
};

export default config;
