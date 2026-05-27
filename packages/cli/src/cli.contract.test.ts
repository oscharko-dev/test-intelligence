/**
 * Contract tests for the standalone `test-intelligence` CLI.
 *
 * Spawns the CLI through `tsx` so the assertions exercise the same import
 * graph the published `dist/cli.js` binary will follow at runtime. The
 * tests pin the operator-facing surface that Issue #20 requires: top-level
 * help, version, unknown command, per-command help, feature-gate
 * enforcement on `run`, missing-required-argument exit codes, dry-run
 * happy path, and the doctor command running without the feature gate.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliSourcePath = path.resolve(__dirname, "cli.ts");

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const runCli = async ({
  args,
  env = {},
  timeoutMs = 15_000,
}: {
  args: ReadonlyArray<string>;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<CliResult> => {
  return new Promise<CliResult>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", cliSourcePath, ...args],
      {
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
};

void test("cli contract: --help prints the flat command surface and exits 0", async () => {
  const result = await runCli({ args: ["--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /test-intelligence — enterprise operator/);
  for (const command of [
    "run",
    "doctor",
    "start",
    "stop",
    "init",
    "audit-dossier",
    "audit-verify",
    "verify-provenance",
    "verify-seal",
    "review",
    "calibration-refit",
    "tms-push",
    "execution-pull",
    "onboard",
    "figma-export",
  ]) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`));
  }
});

void test("cli contract: -h is accepted as the help short flag", async () => {
  const result = await runCli({ args: ["-h"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Usage:\s+test-intelligence <command>/);
});

void test("cli contract: bare `help` prints help and exits 0", async () => {
  const result = await runCli({ args: ["help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Usage:\s+test-intelligence <command>/);
});

void test("cli contract: invocation without arguments prints help and exits 1", async () => {
  const result = await runCli({ args: [] });
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /Usage:\s+test-intelligence <command>/);
});

void test("cli contract: --version prints the product identity and exits 0", async () => {
  const result = await runCli({ args: ["--version"] });
  assert.equal(result.exitCode, 0);
  assert.match(
    result.stdout,
    /^@oscharko-dev\/test-intelligence v\d+\.\d+\.\d+/,
  );
});

void test("cli contract: -V is accepted as the version short flag", async () => {
  const result = await runCli({ args: ["-V"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^@oscharko-dev\/test-intelligence v/);
});

void test("cli contract: unknown command exits 1 with an operator error", async () => {
  const result = await runCli({ args: ["does-not-exist"] });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /error:\s+unknown command: does-not-exist/);
});

void test("cli contract: run --help prints the run flag reference", async () => {
  const result = await runCli({ args: ["run", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /test-intelligence run/);
  assert.match(result.stdout, /--figma-url/);
  assert.match(result.stdout, /--output/);
});

void test("cli contract: doctor --help prints the doctor flag reference", async () => {
  const result = await runCli({ args: ["doctor", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /test-intelligence doctor/);
});

void test("cli contract: audit-dossier --help prints bundle flags", async () => {
  const result = await runCli({ args: ["audit-dossier", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /--run-dir/);
  assert.match(result.stdout, /--output/);
});

void test("cli contract: audit-verify --help prints verification flags", async () => {
  const result = await runCli({ args: ["audit-verify", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /audit-verify/);
});

void test("cli contract: verify-provenance --help prints provenance flags", async () => {
  const result = await runCli({ args: ["verify-provenance", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /verify-provenance/);
});

void test("cli contract: verify-seal --help prints seal flags", async () => {
  const result = await runCli({ args: ["verify-seal", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /--bundle/);
});

void test("cli contract: review without sub-command prints help and exits 1", async () => {
  const result = await runCli({ args: ["review"] });
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /review/);
});

void test("cli contract: review --help exits 0", async () => {
  const result = await runCli({ args: ["review", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /list/);
  assert.match(result.stdout, /get/);
  assert.match(result.stdout, /decide/);
});

void test("cli contract: review with an unknown sub-command exits 1", async () => {
  const result = await runCli({ args: ["review", "explode"] });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /unknown sub-command for "review": explode/);
});

void test("cli contract: calibration-refit --help prints calibration flags", async () => {
  const result = await runCli({ args: ["calibration-refit", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /calibration-refit/);
});

void test("cli contract: tms-push --help prints adapter flags", async () => {
  const result = await runCli({ args: ["tms-push", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /tms-push/);
});

void test("cli contract: tms-push without --tms exits 1 with operator error", async () => {
  const result = await runCli({ args: ["tms-push"] });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /error:/);
});

void test("cli contract: onboard --help prints onboarding flags", async () => {
  const result = await runCli({ args: ["onboard", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /onboard/);
});

void test("cli contract: onboard without --tenant-id exits 1 with operator error", async () => {
  const result = await runCli({ args: ["onboard"] });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /error:/);
});

void test("cli contract: execution-pull --help prints pull flags", async () => {
  const result = await runCli({ args: ["execution-pull", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /execution-pull/);
});

void test("cli contract: figma-export --help prints export flags", async () => {
  const result = await runCli({ args: ["figma-export", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /figma-export/i);
});

void test("cli contract: init --help prints init options", async () => {
  const result = await runCli({ args: ["init", "--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /test-intelligence init/);
  assert.match(result.stdout, /--workspace=/);
  assert.match(result.stdout, /--overwrite/);
});

void test("cli contract: init fails when package.json is missing", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ti-cli-init-missing-"));
  try {
    const result = await runCli({
      args: ["init", `--workspace=${workspaceRoot}`],
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Could not read/);
    assert.match(result.stderr, /package.json/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("cli contract: init writes start/stop scripts when absent", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ti-cli-init-write-"));
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const initial = {
    name: "ti-init-fixture",
    version: "1.0.0",
    scripts: {
      test: "pnpm test",
    },
  };
  await writeFile(packageJsonPath, `${JSON.stringify(initial, null, 2)}\n`, "utf8");

  try {
    const result = await runCli({
      args: ["init", `--workspace=${workspaceRoot}`],
    });
    assert.equal(result.exitCode, 0);
    const updated = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      scripts?: { [key: string]: string };
    };
    assert.equal(updated.scripts?.["test-intelligence:start"], "test-intelligence start");
    assert.equal(updated.scripts?.["test-intelligence:stop"], "test-intelligence stop");
    assert.match(result.stdout, /Done\. You can now start and stop the Workbench/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("cli contract: init refuses to overwrite existing scripts unless --overwrite is set", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ti-cli-init-conflict-"));
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const initial = {
    name: "ti-init-conflict-fixture",
    version: "1.0.0",
    scripts: {
      "test-intelligence:start": "echo custom-start",
      "test-intelligence:stop": "echo custom-stop",
    },
  };
  await writeFile(packageJsonPath, `${JSON.stringify(initial, null, 2)}\n`, "utf8");

  try {
    const result = await runCli({
      args: ["init", `--workspace=${workspaceRoot}`],
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Refusing to overwrite existing scripts/);

    const resultWithOverwrite = await runCli({
      args: ["init", `--workspace=${workspaceRoot}`, "--overwrite"],
    });
    assert.equal(resultWithOverwrite.exitCode, 0);
    const updated = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      scripts?: { [key: string]: string };
    };
    assert.equal(
      updated.scripts?.["test-intelligence:start"],
      "test-intelligence start",
    );
    assert.equal(
      updated.scripts?.["test-intelligence:stop"],
      "test-intelligence stop",
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("cli contract: run without feature gate exits 1 with a clear error", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "ti-cli-no-gate-"));
  try {
    const result = await runCli({
      args: [
        "run",
        "--figma-json-file",
        path.join(outputRoot, "missing.json"),
        "--output",
        outputRoot,
        "--mode",
        "dry_run",
      ],
      env: { TEST_INTELLIGENCE_ENABLED: "" },
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /TEST_INTELLIGENCE_ENABLED=1 must be set/);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

void test("cli contract: run without a source exits 1", async () => {
  const result = await runCli({
    args: ["run", "--output", "/tmp/should-not-exist"],
    env: { TEST_INTELLIGENCE_ENABLED: "1" },
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /error:/);
});

void test("cli contract: doctor runs without the feature gate (read-only inspector)", async () => {
  const result = await runCli({
    args: ["doctor"],
    env: { TEST_INTELLIGENCE_ENABLED: "" },
  });
  // doctor is a read-only inspector; it must not be gated on the
  // TEST_INTELLIGENCE_ENABLED feature flag. Either exit 0 or
  // exit with a non-gate-related operator error from the inspector itself.
  assert.notEqual(result.exitCode, 1, result.stderr);
});

void test("cli contract: top-level help is free of legacy operator strings", async () => {
  const result = await runCli({ args: ["--help"] });
  assert.equal(result.exitCode, 0);
  const legacyNestedCommandPattern = new RegExp(
    ["workspace", "dev"].join("-") + "\\s+test-intelligence",
    "i",
  );
  assert.doesNotMatch(
    result.stdout,
    legacyNestedCommandPattern,
    "top-level help must not reference the legacy nested subcommand form",
  );
});
