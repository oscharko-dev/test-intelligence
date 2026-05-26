import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Scoped to a single document pair. The standalone package emits one SBOM
// pair (`test-intelligence.cdx.json` + `test-intelligence.spdx.json`) per
// ADR-0006; multi-profile fixture sets do not apply.

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const scriptPath = path.resolve(packageRoot, "scripts/check-sbom-parity.mjs");

const createCycloneDxDocument = (
  name: string,
  version: string,
  dependencies: ReadonlyArray<readonly [string, string]>,
) => {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name,
        version,
        purl: `pkg:npm/${encodeURIComponent(name)}@${version}`,
      },
    },
    components: dependencies.map(([dependencyName, dependencyVersion]) => {
      const [group, ...nameParts] = dependencyName.startsWith("@")
        ? dependencyName.split("/")
        : [undefined, dependencyName];
      const normalizedName =
        nameParts.length > 0 ? nameParts.join("/") : dependencyName;

      return {
        type: "library",
        ...(group ? { group } : {}),
        name: normalizedName,
        version: dependencyVersion,
        purl: `pkg:npm/${encodeURIComponent(dependencyName)}@${dependencyVersion}`,
      };
    }),
  };
};

const createSpdxDocument = (
  name: string,
  version: string,
  dependencies: ReadonlyArray<readonly [string, string]>,
) => {
  return {
    SPDXID: "SPDXRef-DOCUMENT",
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    name: `${name}-${version}`,
    documentNamespace: `https://spdx.org/spdxdocs/${name}-${version}`,
    creationInfo: {
      created: "2026-01-01T00:00:00.000Z",
      creators: ["Tool: test"],
    },
    documentDescribes: [`SPDXRef-Package-${name}`],
    packages: [
      {
        SPDXID: `SPDXRef-Package-${name}`,
        name,
        versionInfo: version,
        externalRefs: [
          {
            referenceType: "purl",
            referenceLocator: `pkg:npm/${name}@${version}`,
          },
        ],
      },
      ...dependencies.map(([dependencyName, dependencyVersion]) => ({
        SPDXID: `SPDXRef-Package-${dependencyName}-${dependencyVersion}`,
        name: dependencyName,
        versionInfo: dependencyVersion,
        externalRefs: [
          {
            referenceType: "purl",
            referenceLocator: `pkg:npm/${dependencyName}@${dependencyVersion}`,
          },
        ],
      })),
    ],
  };
};

const writeJson = async (targetPath: string, value: unknown) => {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const runParityCheck = async (
  documents: Record<string, unknown>,
  args: string[] = [],
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "test-intelligence-sbom-parity-"),
  );

  try {
    for (const [relativePath, value] of Object.entries(documents).sort(
      ([first], [second]) => first.localeCompare(second),
    )) {
      await writeJson(path.join(tempRoot, relativePath), value);
    }

    return await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [scriptPath, "--directory", tempRoot, ...args],
        {
          cwd: packageRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (signal) {
          reject(new Error(`check-sbom-parity exited via signal '${signal}'.`));
          return;
        }
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
        });
      });
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

void test("SBOM parity check passes when CycloneDX and SPDX describe the same package set", async () => {
  const result = await runParityCheck({
    "test-intelligence.cdx.json": createCycloneDxDocument(
      "test-intelligence",
      "0.0.1",
      [
        ["@scope/allowed-parent", "1.2.0"],
        ["allowed-child", "2.0.0"],
      ],
    ),
    "test-intelligence.spdx.json": createSpdxDocument(
      "test-intelligence",
      "0.0.1",
      [
        ["@scope/allowed-parent", "1.2.0"],
        ["allowed-child", "2.0.0"],
      ],
    ),
  });

  assert.equal(
    result.code,
    0,
    `Expected success, got stderr:\n${result.stderr}`,
  );
  assert.match(
    result.stdout,
    /\[sbom-parity\] test-intelligence matched 3 packages\./,
  );
  assert.equal(result.stderr, "");
});

void test("SBOM parity check fails when SPDX misses a transitive dependency", async () => {
  const result = await runParityCheck({
    "test-intelligence.cdx.json": createCycloneDxDocument(
      "test-intelligence",
      "0.0.1",
      [
        ["@scope/allowed-parent", "1.2.0"],
        ["allowed-child", "2.0.0"],
      ],
    ),
    "test-intelligence.spdx.json": createSpdxDocument(
      "test-intelligence",
      "0.0.1",
      [["@scope/allowed-parent", "1.2.0"]],
    ),
  });

  assert.equal(
    result.code,
    1,
    `Expected mismatch failure, got stdout:\n${result.stdout}`,
  );
  assert.match(result.stderr, /\[sbom-parity\] Failed:/);
  assert.match(result.stderr, /test-intelligence mismatch/);
  assert.match(
    result.stderr,
    /missing from SPDX: pkg:npm\/allowed-child@2.0.0/,
  );
});

void test("SBOM parity check fails when CycloneDX misses a dependency present in SPDX", async () => {
  const result = await runParityCheck({
    "test-intelligence.cdx.json": createCycloneDxDocument(
      "test-intelligence",
      "0.0.1",
      [["@scope/allowed-parent", "1.2.0"]],
    ),
    "test-intelligence.spdx.json": createSpdxDocument(
      "test-intelligence",
      "0.0.1",
      [
        ["@scope/allowed-parent", "1.2.0"],
        ["sneaky-extra", "9.9.9"],
      ],
    ),
  });

  assert.equal(
    result.code,
    1,
    `Expected mismatch failure, got stdout:\n${result.stdout}`,
  );
  assert.match(
    result.stderr,
    /missing from CycloneDX: pkg:npm\/sneaky-extra@9.9.9/,
  );
});
