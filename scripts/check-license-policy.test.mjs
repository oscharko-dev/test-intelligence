import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  APPROVED_LICENSES,
  normalizeLicense,
  scanInstalledLicenses,
  runLicensePolicy,
} from "./check-license-policy.mjs";

let tmpDir;

before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "ti-license-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const writePkg = async (rel, manifest) => {
  const dir = path.join(tmpDir, rel);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(manifest, null, 2),
  );
};

void describe("APPROVED_LICENSES", () => {
  void it("matches the curated license allowlist", () => {
    assert.deepEqual([...APPROVED_LICENSES].sort(), [
      "(MIT OR CC0-1.0)",
      "0BSD",
      "Apache-2.0",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "BlueOak-1.0.0",
      "CC-BY-4.0",
      "CC0-1.0",
      "ISC",
      "MIT",
      "MIT-0",
      "MPL-2.0",
      "Python-2.0",
    ]);
  });
});

void describe("normalizeLicense", () => {
  void it("returns UNLICENSED for non-strings", () => {
    assert.equal(normalizeLicense(undefined), "UNLICENSED");
    assert.equal(normalizeLicense(null), "UNLICENSED");
    assert.equal(normalizeLicense(42), "UNLICENSED");
  });

  void it("returns UNLICENSED for empty/whitespace strings", () => {
    assert.equal(normalizeLicense(""), "UNLICENSED");
    assert.equal(normalizeLicense("   "), "UNLICENSED");
  });

  void it("returns the trimmed string otherwise", () => {
    assert.equal(normalizeLicense("  MIT  "), "MIT");
  });
});

void describe("scanInstalledLicenses", () => {
  void it("walks the node_modules tree (incl. scoped packages)", async () => {
    const nm = path.join(tmpDir, "scan-tree", "node_modules");
    await writePkg("scan-tree/node_modules/foo", {
      name: "foo",
      version: "1.0.0",
      license: "MIT",
    });
    await writePkg("scan-tree/node_modules/@scope/bar", {
      name: "@scope/bar",
      version: "2.0.0",
      license: "Apache-2.0",
    });
    await writePkg("scan-tree/node_modules/foo/node_modules/nested", {
      name: "nested",
      version: "0.1.0",
      license: "ISC",
    });
    const packages = await scanInstalledLicenses({ nodeModulesPath: nm });
    const names = packages.map((p) => `${p.name}@${p.version}`).sort();
    assert.deepEqual(names, ["@scope/bar@2.0.0", "foo@1.0.0", "nested@0.1.0"]);
  });

  void it("returns an empty array when node_modules is absent", async () => {
    const result = await scanInstalledLicenses({
      nodeModulesPath: path.join(tmpDir, "does-not-exist", "node_modules"),
    });
    assert.deepEqual(result, []);
  });
});

void describe("runLicensePolicy", () => {
  void it("returns 0 when every license is on the allowlist", async () => {
    const nm = path.join(tmpDir, "all-good", "node_modules");
    await writePkg("all-good/node_modules/a", {
      name: "a",
      version: "1.0.0",
      license: "MIT",
    });
    await writePkg("all-good/node_modules/b", {
      name: "b",
      version: "1.0.0",
      license: "Apache-2.0",
    });
    let outBuf = "";
    const exit = await runLicensePolicy({
      nodeModulesPath: nm,
      stdout: (line) => {
        outBuf += `${line}\n`;
      },
      stderr: () => {},
    });
    assert.equal(exit, 0, outBuf);
  });

  void it("returns 1 when a disallowed license is found (GPL)", async () => {
    const nm = path.join(tmpDir, "has-gpl", "node_modules");
    await writePkg("has-gpl/node_modules/evil", {
      name: "evil",
      version: "1.0.0",
      license: "GPL-3.0-only",
    });
    let errBuf = "";
    const exit = await runLicensePolicy({
      nodeModulesPath: nm,
      stdout: () => {},
      stderr: (line) => {
        errBuf += `${line}\n`;
      },
    });
    assert.equal(exit, 1);
    assert.match(errBuf, /evil@1\.0\.0/);
    assert.match(errBuf, /GPL-3\.0-only/);
  });

  void it("treats UNLICENSED as disallowed", async () => {
    const nm = path.join(tmpDir, "no-license", "node_modules");
    await writePkg("no-license/node_modules/mystery", {
      name: "mystery",
      version: "1.0.0",
    });
    let errBuf = "";
    const exit = await runLicensePolicy({
      nodeModulesPath: nm,
      stdout: () => {},
      stderr: (line) => {
        errBuf += `${line}\n`;
      },
    });
    assert.equal(exit, 1);
    assert.match(errBuf, /UNLICENSED/);
  });

  void it("returns 1 when node_modules is missing (fail-closed)", async () => {
    let errBuf = "";
    const exit = await runLicensePolicy({
      nodeModulesPath: path.join(tmpDir, "missing", "node_modules"),
      stdout: () => {},
      stderr: (line) => {
        errBuf += `${line}\n`;
      },
    });
    assert.equal(exit, 1);
    assert.match(errBuf, /node_modules is missing|not found/);
  });
});
