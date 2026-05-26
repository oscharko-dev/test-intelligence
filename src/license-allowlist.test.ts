import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// The standalone `scripts/check-license-policy.mjs` walks a single
// `node_modules` tree rooted at the package root: no templates, no profiles.
// These tests exercise the standalone shape directly via the module's
// exported helpers (`scanInstalledLicenses`, `runLicensePolicy`).

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const scriptPath = path.resolve(
  packageRoot,
  "scripts/check-license-policy.mjs",
);

interface LicensePolicyModule {
  readonly APPROVED_LICENSES: ReadonlySet<string>;
  readonly normalizeLicense: (value: unknown) => string;
  readonly scanInstalledLicenses: (options: {
    nodeModulesPath?: string;
  }) => Promise<
    ReadonlyArray<{ name: string; version: string; license: string }>
  >;
  readonly runLicensePolicy: (options: {
    nodeModulesPath?: string;
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
  }) => Promise<number>;
}

const scriptModule = (await import(
  pathToFileURL(scriptPath).href
)) as unknown as LicensePolicyModule;
const {
  APPROVED_LICENSES,
  normalizeLicense,
  scanInstalledLicenses,
  runLicensePolicy,
} = scriptModule;

const createPackageJson = ({
  name,
  version = "1.0.0",
  license = "MIT" as string | undefined,
  dependencies,
}: {
  name: string;
  version?: string;
  license?: string | undefined;
  dependencies?: Record<string, string>;
}): string => {
  return `${JSON.stringify(
    {
      name,
      version,
      private: true,
      type: "module",
      ...(license !== undefined ? { license } : {}),
      ...(dependencies ? { dependencies } : {}),
    },
    null,
    2,
  )}\n`;
};

const writeInstallTree = async (
  nodeModulesRoot: string,
  installTree: Record<string, string>,
): Promise<void> => {
  await mkdir(nodeModulesRoot, { recursive: true });
  const entries = Object.entries(installTree).sort(([first], [second]) =>
    first.localeCompare(second),
  );
  for (const [relativePath, content] of entries) {
    const filePath = path.join(nodeModulesRoot, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
};

const captureOutput = (): {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  stdoutLines: string[];
  stderrLines: string[];
} => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    stdout: (line: string) => {
      stdoutLines.push(line);
    },
    stderr: (line: string) => {
      stderrLines.push(line);
    },
    stdoutLines,
    stderrLines,
  };
};

void test("APPROVED_LICENSES is a non-empty allowlist of permissive SPDX identifiers", () => {
  assert.ok(APPROVED_LICENSES.size > 0, "APPROVED_LICENSES must not be empty");
  for (const license of [
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "CC0-1.0",
    "MPL-2.0",
  ]) {
    assert.ok(
      APPROVED_LICENSES.has(license),
      `Expected ${license} to be in APPROVED_LICENSES`,
    );
  }
  for (const denied of ["GPL-3.0-only", "AGPL-3.0-or-later", "SSPL-1.0"]) {
    assert.ok(
      !APPROVED_LICENSES.has(denied),
      `Expected ${denied} to NOT be in APPROVED_LICENSES`,
    );
  }
});

void test("normalizeLicense returns UNLICENSED for missing or non-string license fields", () => {
  assert.equal(normalizeLicense(undefined), "UNLICENSED");
  assert.equal(normalizeLicense(null), "UNLICENSED");
  assert.equal(normalizeLicense(""), "UNLICENSED");
  assert.equal(normalizeLicense("   "), "UNLICENSED");
  assert.equal(normalizeLicense(42), "UNLICENSED");
  assert.equal(normalizeLicense({ type: "MIT" }), "UNLICENSED");
  assert.equal(normalizeLicense("MIT"), "MIT");
  assert.equal(normalizeLicense("  Apache-2.0  "), "Apache-2.0");
});

void test("scanInstalledLicenses walks a flat node_modules tree and reports each package", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "test-intelligence-license-allowlist-"),
  );
  try {
    const nodeModulesPath = path.join(tempRoot, "node_modules");
    await writeInstallTree(nodeModulesPath, {
      "allowed-parent/package.json": createPackageJson({
        name: "allowed-parent",
        license: "MIT",
      }),
      "allowed-child/package.json": createPackageJson({
        name: "allowed-child",
        license: "ISC",
      }),
    });

    const packages = await scanInstalledLicenses({ nodeModulesPath });
    const byName = [...packages].sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(byName, [
      { name: "allowed-child", version: "1.0.0", license: "ISC" },
      { name: "allowed-parent", version: "1.0.0", license: "MIT" },
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

void test("runLicensePolicy passes when every installed package has an approved license", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "test-intelligence-license-allowlist-"),
  );
  try {
    const nodeModulesPath = path.join(tempRoot, "node_modules");
    await writeInstallTree(nodeModulesPath, {
      "allowed-parent/package.json": createPackageJson({
        name: "allowed-parent",
        license: "MIT",
      }),
      "allowed-child/package.json": createPackageJson({
        name: "allowed-child",
        license: "ISC",
      }),
    });

    const sink = captureOutput();
    const code = await runLicensePolicy({
      nodeModulesPath,
      stdout: sink.stdout,
      stderr: sink.stderr,
    });
    assert.equal(
      code,
      0,
      `Expected pass, got stderr:\n${sink.stderrLines.join("\n")}`,
    );
    assert.equal(sink.stderrLines.length, 0);
    assert.ok(
      sink.stdoutLines.some((line) =>
        /\[license-policy\] Passed: 2 packages/.test(line),
      ),
      `Expected passing summary in stdout: ${sink.stdoutLines.join("\n")}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

void test("runLicensePolicy fails closed when any installed package has a disallowed license", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "test-intelligence-license-allowlist-"),
  );
  try {
    const nodeModulesPath = path.join(tempRoot, "node_modules");
    await writeInstallTree(nodeModulesPath, {
      "allowed-parent/package.json": createPackageJson({
        name: "allowed-parent",
        license: "MIT",
      }),
      "disallowed-child/package.json": createPackageJson({
        name: "disallowed-child",
        license: "GPL-3.0-only",
      }),
    });

    const sink = captureOutput();
    const code = await runLicensePolicy({
      nodeModulesPath,
      stdout: sink.stdout,
      stderr: sink.stderr,
    });
    assert.equal(
      code,
      1,
      `Expected failure, got stdout:\n${sink.stdoutLines.join("\n")}`,
    );
    assert.ok(
      sink.stderrLines.some((line) =>
        /disallowed-child@1\.0\.0: GPL-3\.0-only/.test(line),
      ),
      `Expected GPL violation in stderr: ${sink.stderrLines.join("\n")}`,
    );
    assert.ok(
      sink.stderrLines.some((line) => /Allowed licenses:/.test(line)),
      `Expected allowlist hint in stderr: ${sink.stderrLines.join("\n")}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

void test("runLicensePolicy fails closed when node_modules is missing", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "test-intelligence-license-allowlist-"),
  );
  try {
    const sink = captureOutput();
    const code = await runLicensePolicy({
      nodeModulesPath: path.join(tempRoot, "node_modules"),
      stdout: sink.stdout,
      stderr: sink.stderr,
    });
    assert.equal(
      code,
      1,
      `Expected failure, got stdout:\n${sink.stdoutLines.join("\n")}`,
    );
    assert.ok(
      sink.stderrLines.some((line) => /node_modules is missing/.test(line)),
      `Expected node_modules-missing message in stderr: ${sink.stderrLines.join("\n")}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
