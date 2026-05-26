import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  runPackageShape,
  validatePackageShape,
} from "./check-package-shape.mjs";

let tmpDir;

before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "ti-pkg-shape-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const writeManifest = async (name, manifest) => {
  const dir = path.join(tmpDir, name);
  await mkdir(dir, { recursive: true });
  const manifestPath = path.join(dir, "package.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { dir, manifestPath };
};

const touch = async (dir, relativePath) => {
  const fullPath = path.join(dir, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, "");
};

void describe("validatePackageShape", () => {
  void it("returns ok when every files[] entry and exports target exists", async () => {
    const { dir, manifestPath } = await writeManifest("ok", {
      name: "@x/y",
      version: "0.0.1",
      license: "Apache-2.0",
      main: "./dist/index.cjs",
      module: "./dist/index.js",
      types: "./dist/index.d.ts",
      files: ["dist", "README.md", "LICENSE"],
      bin: { tool: "./dist/cli.js" },
      exports: {
        ".": {
          import: { types: "./dist/index.d.ts", default: "./dist/index.js" },
          require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
        },
      },
    });
    await touch(dir, "dist/index.js");
    await touch(dir, "dist/index.cjs");
    await touch(dir, "dist/index.d.ts");
    await touch(dir, "dist/index.d.cts");
    await touch(dir, "dist/cli.js");
    await touch(dir, "README.md");
    await touch(dir, "LICENSE");
    const result = await validatePackageShape({ manifestPath });
    assert.equal(result.ok, true, JSON.stringify(result.violations));
  });

  void it("fails when a files[] entry is missing", async () => {
    const { manifestPath } = await writeManifest("missing-files", {
      name: "@x/y",
      version: "0.0.1",
      files: ["dist", "MISSING.md"],
    });
    const result = await validatePackageShape({ manifestPath });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => /MISSING\.md/.test(v)));
  });

  void it("fails when an exports target is missing", async () => {
    const { dir, manifestPath } = await writeManifest("missing-exports", {
      name: "@x/y",
      version: "0.0.1",
      files: ["dist"],
      exports: {
        ".": { import: { default: "./dist/index.js" } },
      },
    });
    await mkdir(path.join(dir, "dist"), { recursive: true });
    const result = await validatePackageShape({ manifestPath });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => /dist\/index\.js/.test(v)));
  });

  void it("fails when bin target is missing", async () => {
    const { dir, manifestPath } = await writeManifest("missing-bin", {
      name: "@x/y",
      version: "0.0.1",
      files: ["dist"],
      bin: "./dist/cli.js",
    });
    await mkdir(path.join(dir, "dist"), { recursive: true });
    const result = await validatePackageShape({ manifestPath });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => /cli\.js/.test(v)));
  });

  void it("fails when main/module/types do not match an export target", async () => {
    const { dir, manifestPath } = await writeManifest("inconsistent", {
      name: "@x/y",
      version: "0.0.1",
      main: "./dist/wrong.cjs",
      files: ["dist"],
      exports: {
        ".": { require: { default: "./dist/index.cjs" } },
      },
    });
    await mkdir(path.join(dir, "dist"), { recursive: true });
    await touch(dir, "dist/index.cjs");
    await touch(dir, "dist/wrong.cjs");
    const result = await validatePackageShape({ manifestPath });
    assert.equal(result.ok, false);
    assert.ok(
      result.violations.some((v) =>
        /main.*does not appear in.*exports/.test(v),
      ),
    );
  });

  void it("requires name, version, license, and Apache-2.0-or-MIT license", async () => {
    const { manifestPath } = await writeManifest("no-license", {
      name: "@x/y",
      version: "0.0.1",
      files: [],
    });
    const result = await validatePackageShape({ manifestPath });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => /license/.test(v)));
  });
});

void describe("runPackageShape (CLI)", () => {
  void it("returns 0 on valid manifest", async () => {
    const { dir, manifestPath } = await writeManifest("cli-ok", {
      name: "@x/y",
      version: "0.0.1",
      license: "Apache-2.0",
      main: "./dist/index.cjs",
      files: ["dist"],
      exports: { ".": { require: { default: "./dist/index.cjs" } } },
    });
    await mkdir(path.join(dir, "dist"), { recursive: true });
    await touch(dir, "dist/index.cjs");
    let outBuf = "";
    const exit = await runPackageShape({
      manifestPath,
      stdout: (line) => {
        outBuf += `${line}\n`;
      },
      stderr: () => {},
    });
    assert.equal(exit, 0, outBuf);
  });

  void it("returns 1 on violation", async () => {
    const { manifestPath } = await writeManifest("cli-bad", {
      name: "@x/y",
      version: "0.0.1",
      files: ["MISSING.md"],
    });
    let errBuf = "";
    const exit = await runPackageShape({
      manifestPath,
      stdout: () => {},
      stderr: (line) => {
        errBuf += `${line}\n`;
      },
    });
    assert.equal(exit, 1);
    assert.match(errBuf, /MISSING\.md/);
  });
});
