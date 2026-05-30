#!/usr/bin/env node

/**
 * Release-readiness aggregator for `@oscharko-dev/test-intelligence`.
 *
 * Runs every Wave-A-through-D gate sequentially and emits a single
 * canonical JSON report to `artifacts/release-readiness/report.json`.
 * Exit code 0 iff every required gate passed.
 *
 * Standalone release gate for the public Test Intelligence package.
 * The gate set is intentionally narrow: one npm artifact, no generated
 * templates, and only checks that are required for this repository.
 *
 * Required gates (block the report on failure):
 *
 *   typecheck, lint, test, build, check:publint, check:attw,
 *   check:package-shape, check:installable-package, test:airgap-install,
 *   test:workbench-airgap, check:license-policy, check:lockfile-hosts,
 *   check:no-telemetry, check:supply-chain-iocs, sbom:cyclonedx, sbom:spdx,
 *   check:sbom-parity.
 *
 * Optional gates (recorded as `skipped` when the corresponding
 * environment is unavailable, never block):
 *
 *   check:npm-sbom-smoke (`npm sbom` may be absent on older npm),
 *   check:scorecard-threshold (requires GITHUB_REPOSITORY in CI).
 *
 * Reproducible-build verification is intentionally NOT part of this
 * aggregate — it runs in the release-gate.yml workflow exclusively
 * (two consecutive full builds; too heavy for the local lane).
 *
 * Usage:
 *   node scripts/release-readiness.mjs [--report <path>] [--skip <gateId>[,<gateId>]]
 *
 * Defaults:
 *   --report   artifacts/release-readiness/report.json
 *   --skip     (none)
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const DEFAULT_REPORT_PATH = "artifacts/release-readiness/report.json";

const REQUIRED_GATES = Object.freeze([
  { id: "typecheck", command: ["pnpm", "run", "typecheck"] },
  { id: "lint", command: ["pnpm", "run", "lint"] },
  { id: "test", command: ["pnpm", "run", "test"] },
  { id: "build", command: ["pnpm", "run", "build"] },
  { id: "check:publint", command: ["pnpm", "run", "check:publint"] },
  { id: "check:attw", command: ["pnpm", "run", "check:attw"] },
  {
    id: "check:package-shape",
    command: ["pnpm", "run", "check:package-shape"],
  },
  {
    id: "check:installable-package",
    command: ["pnpm", "run", "check:installable-package"],
  },
  {
    id: "test:airgap-install",
    command: ["pnpm", "run", "test:airgap-install"],
  },
  {
    id: "test:workbench-airgap",
    command: ["pnpm", "run", "test:workbench-airgap"],
  },
  {
    id: "check:license-policy",
    command: ["pnpm", "run", "check:license-policy"],
  },
  {
    id: "check:lockfile-hosts",
    command: ["pnpm", "run", "check:lockfile-hosts"],
  },
  {
    id: "check:no-telemetry",
    command: ["pnpm", "run", "check:no-telemetry"],
  },
  {
    id: "check:supply-chain-iocs",
    command: ["pnpm", "run", "check:supply-chain-iocs"],
  },
  { id: "sbom:cyclonedx", command: ["pnpm", "run", "sbom:cyclonedx"] },
  { id: "sbom:spdx", command: ["pnpm", "run", "sbom:spdx"] },
  { id: "check:sbom-parity", command: ["pnpm", "run", "check:sbom-parity"] },
]);

const OPTIONAL_GATES = Object.freeze([
  {
    id: "check:npm-sbom-smoke",
    command: ["pnpm", "run", "check:npm-sbom-smoke"],
    skipWhen: () => false,
    skipReason: null,
  },
  {
    id: "check:scorecard-threshold",
    command: ["pnpm", "run", "check:scorecard-threshold"],
    skipWhen: () => !process.env.GITHUB_REPOSITORY,
    skipReason:
      "GITHUB_REPOSITORY is not set; scorecard threshold only runs in CI on dev.",
  },
]);

const REQUIRED_GATE_IDS = new Set(REQUIRED_GATES.map((gate) => gate.id));
const OPTIONAL_GATE_IDS = new Set(OPTIONAL_GATES.map((gate) => gate.id));

const parseArgs = () => {
  const args = process.argv.slice(2);
  let reportPath = DEFAULT_REPORT_PATH;
  const skipSet = new Set();

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current) continue;
    if (current === "--report") {
      const next = args[index + 1];
      if (!next) throw new Error("Missing value for --report.");
      reportPath = next;
      index += 1;
      continue;
    }
    if (current.startsWith("--report=")) {
      reportPath = current.slice("--report=".length);
      continue;
    }
    if (current === "--skip") {
      const next = args[index + 1];
      if (!next) throw new Error("Missing value for --skip.");
      for (const gateId of next.split(",")) {
        const trimmed = gateId.trim();
        if (trimmed) skipSet.add(trimmed);
      }
      index += 1;
      continue;
    }
    if (current.startsWith("--skip=")) {
      for (const gateId of current.slice("--skip=".length).split(",")) {
        const trimmed = gateId.trim();
        if (trimmed) skipSet.add(trimmed);
      }
      continue;
    }
    throw new Error(`Unknown flag: ${current}`);
  }

  return {
    reportPath: path.resolve(repoRoot, reportPath),
    skipSet,
  };
};

const runGate = (gate) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const [command, ...args] = gate.command;
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      resolve({
        id: gate.id,
        status: "failed",
        durationMs: Date.now() - startedAt,
        exitCode: 1,
        error: error.message,
      });
    });
    child.once("close", (exitCode) => {
      resolve({
        id: gate.id,
        status: exitCode === 0 ? "passed" : "failed",
        durationMs: Date.now() - startedAt,
        exitCode: exitCode ?? 1,
        error: null,
      });
    });
  });

const main = async () => {
  const { reportPath, skipSet } = parseArgs();
  const skippedUnknownGates = [...skipSet].filter(
    (gateId) =>
      !REQUIRED_GATE_IDS.has(gateId) && !OPTIONAL_GATE_IDS.has(gateId),
  );
  if (skippedUnknownGates.length > 0) {
    throw new Error(
      `Unknown release gate(s) in --skip: ${skippedUnknownGates.sort().join(", ")}`,
    );
  }
  const skippedRequiredGates = [...skipSet].filter((gateId) =>
    REQUIRED_GATE_IDS.has(gateId),
  );
  if (skippedRequiredGates.length > 0) {
    throw new Error(
      `Required release gate(s) cannot be skipped: ${skippedRequiredGates.sort().join(", ")}`,
    );
  }

  const startedAt = new Date().toISOString();
  const results = [];

  console.log("[release-readiness] Required gates:");
  for (const gate of REQUIRED_GATES) {
    console.log(`[release-readiness]   ${gate.id} ...`);
    const result = await runGate(gate);
    results.push({ ...result, required: true });
    console.log(
      `[release-readiness]   ${gate.id} -> ${result.status} (${result.durationMs}ms)`,
    );
  }

  console.log("[release-readiness] Optional gates:");
  for (const gate of OPTIONAL_GATES) {
    if (skipSet.has(gate.id)) {
      console.log(`[release-readiness]   ${gate.id} ... SKIPPED (--skip)`);
      results.push({
        id: gate.id,
        status: "skipped",
        durationMs: 0,
        exitCode: 0,
        error: null,
        required: false,
        skipReason: "operator-requested via --skip",
      });
      continue;
    }
    if (gate.skipWhen()) {
      console.log(
        `[release-readiness]   ${gate.id} ... SKIPPED (${gate.skipReason})`,
      );
      results.push({
        id: gate.id,
        status: "skipped",
        durationMs: 0,
        exitCode: 0,
        error: null,
        required: false,
        skipReason: gate.skipReason,
      });
      continue;
    }
    console.log(`[release-readiness]   ${gate.id} ...`);
    const result = await runGate(gate);
    results.push({ ...result, required: false });
    console.log(
      `[release-readiness]   ${gate.id} -> ${result.status} (${result.durationMs}ms)`,
    );
  }

  const requiredFailures = results.filter(
    (entry) => entry.required && entry.status !== "passed",
  );
  const passed = requiredFailures.length === 0;
  const requiredPassed = results.filter(
    (entry) => entry.required && entry.status === "passed",
  ).length;

  const report = {
    schemaVersion: "1.0.0",
    generatedAt: startedAt,
    package: "@oscharko-dev/test-intelligence",
    passed,
    gates: results,
    summary: {
      total: results.length,
      passed: results.filter((entry) => entry.status === "passed").length,
      failed: results.filter((entry) => entry.status === "failed").length,
      skipped: results.filter((entry) => entry.status === "skipped").length,
    },
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `[release-readiness] ${passed ? "PASS" : "FAIL"} — required ${requiredPassed}/${REQUIRED_GATES.length} passed; report ${reportPath}`,
  );

  process.exit(passed ? 0 : 1);
};

main().catch((error) => {
  console.error(
    "[release-readiness] Failed:",
    error instanceof Error ? error.stack : error,
  );
  process.exit(1);
});
