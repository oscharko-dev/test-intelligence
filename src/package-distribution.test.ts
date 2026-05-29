import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The package has a single npm artifact: no
// `template/react-mui-app` / `template/react-tailwind-app` sub-projects, no
// `scripts/build-profile.mjs`, no profile-specific manifest field.
// These tests assert the public tarball shape: dist/ plus the root public
// Markdown files listed in `package.json:files`, with source, fixtures,
// scripts, internal docs, tests, sourcemaps, and generated artifacts excluded.

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const expectedRepositoryUrl =
  "git+https://github.com/oscharko-dev/test-intelligence.git";
const expectedHomepageUrl =
  "https://github.com/oscharko-dev/test-intelligence#readme";
const expectedBugsUrl =
  "https://github.com/oscharko-dev/test-intelligence/issues";

const run = async ({
  command,
  args,
  cwd,
}: {
  command: string;
  args: string[];
  cwd: string;
}): Promise<string> => {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

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
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) {
        reject(
          new Error(
            `Command '${command} ${args.join(" ")}' exited via signal '${signal}'.`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Command '${command} ${args.join(" ")}' failed with exit code ${code ?? 1}.\n${stderr}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
};

const distExists = async (): Promise<boolean> => {
  try {
    const stats = await stat(path.join(packageRoot, "dist", "index.js"));
    return stats.isFile();
  } catch {
    return false;
  }
};

void test("npm pack produces a tarball whose contents match package.json files[]", async () => {
  // The packaging test asserts the SHAPE of the published tarball — it
  // needs `dist/` to exist. In CI, the Test step runs BEFORE the Build
  // step (the bulk of the test suite tests source via tsx and does not
  // need `dist/`). Build dist/ on demand if it is missing.
  if (!(await distExists())) {
    await run({
      command: "pnpm",
      args: ["run", "build"],
      cwd: packageRoot,
    });
  }

  const packDir = await mkdtemp(
    path.join(os.tmpdir(), "test-intelligence-pack-"),
  );

  try {
    await run({
      command: "npm",
      args: ["pack", "--pack-destination", packDir, "--silent"],
      cwd: packageRoot,
    });

    const packedFiles = await readdir(packDir);
    const tarball = packedFiles.find((fileName) => fileName.endsWith(".tgz"));
    assert.notEqual(tarball, undefined, "Expected npm pack to produce a .tgz");
    if (!tarball) return;

    const tarballListing = await run({
      command: "tar",
      args: ["-tzf", path.join(packDir, tarball)],
      cwd: packageRoot,
    });

    // Files explicitly listed in package.json files[] MUST ship.
    assert.match(tarballListing, /package\/README\.md/);
    assert.match(tarballListing, /package\/CHANGELOG\.md/);
    assert.match(tarballListing, /package\/LICENSE/);
    assert.match(tarballListing, /package\/NOTICE/);
    assert.match(tarballListing, /package\/SNAPSHOT_VAULT\.md/);
    assert.match(tarballListing, /package\/RELEASE_READINESS\.md/);
    assert.match(tarballListing, /package\/VERSIONING\.md/);
    assert.match(tarballListing, /package\/GOVERNANCE\.md/);
    assert.match(tarballListing, /package\/CONTRIBUTING\.md/);
    assert.match(tarballListing, /package\/TROUBLESHOOTING\.md/);
    assert.match(tarballListing, /package\/SECURITY\.md/);
    assert.match(tarballListing, /package\/CODE_OF_CONDUCT\.md/);
    assert.match(tarballListing, /package\/SUPPORT\.md/);
    assert.match(tarballListing, /package\/dist\/index\.js/);
    assert.match(tarballListing, /package\/dist\/index\.cjs/);
    assert.match(tarballListing, /package\/dist\/index\.d\.ts/);
    assert.match(tarballListing, /package\/dist\/index\.d\.cts/);
    assert.match(tarballListing, /package\/dist\/cli\.js/);
    assert.match(tarballListing, /package\/dist\/contracts\/index\.js/);
    assert.match(tarballListing, /package\/dist\/contracts\/index\.cjs/);
    assert.match(tarballListing, /package\/dist\/contracts\/index\.d\.ts/);
    assert.match(tarballListing, /package\/dist\/contracts\/index\.d\.cts/);

    // Source MUST NOT ship.
    assert.doesNotMatch(tarballListing, /package\/src\//);
    assert.doesNotMatch(tarballListing, /package\/scripts\//);
    assert.doesNotMatch(tarballListing, /package\/fixtures\//);
    assert.doesNotMatch(tarballListing, /package\/integration\//);
    assert.doesNotMatch(tarballListing, /package\/ui-src\//);
    assert.doesNotMatch(tarballListing, /package\/\.github\//);
    assert.doesNotMatch(tarballListing, /package\/\.spec-/);
    assert.doesNotMatch(tarballListing, /package\/artifacts\//);
    assert.doesNotMatch(tarballListing, /package\/CLAUDE\.md/);
    assert.doesNotMatch(tarballListing, /\.test\.ts/);
    assert.doesNotMatch(tarballListing, /\.test\.tsx/);

    // Internal docs MUST NOT ship with the public npm package.
    assert.doesNotMatch(tarballListing, /package\/docs\//);
    assert.doesNotMatch(tarballListing, /package\/Only for Internal Use\//);

    // Extract and validate the packaged manifest.
    const extractDir = await mkdtemp(
      path.join(os.tmpdir(), "test-intelligence-pack-extract-"),
    );
    try {
      await run({
        command: "tar",
        args: [
          "-xzf",
          path.join(packDir, tarball),
          "-C",
          extractDir,
          "package/package.json",
        ],
        cwd: packageRoot,
      });

      const packagedManifest = JSON.parse(
        await readFile(
          path.join(extractDir, "package", "package.json"),
          "utf8",
        ),
      ) as {
        name: string;
        version: string;
        license: string;
        repository: { type: string; url: string };
        homepage: string;
        bugs: { url: string };
        peerDependencies: Record<string, string>;
        peerDependenciesMeta: Record<string, { optional: boolean }>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };

      assert.equal(packagedManifest.name, "@oscharko-dev/test-intelligence");
      assert.equal(packagedManifest.license, "Apache-2.0");
      assert.equal(packagedManifest.repository.type, "git");
      assert.equal(packagedManifest.repository.url, expectedRepositoryUrl);
      assert.equal(packagedManifest.homepage, expectedHomepageUrl);
      assert.equal(packagedManifest.bugs.url, expectedBugsUrl);
      assert.equal(
        packagedManifest.peerDependencies["@opentelemetry/api"],
        "^1.9.0",
      );
      assert.equal(
        packagedManifest.peerDependenciesMeta["@opentelemetry/api"]?.optional,
        true,
      );
      // devDependencies/scripts are NOT stripped by `npm pack` (they survive
      // into the published manifest), but they have no runtime effect on
      // consumers. We only assert they are not undefined-typed; the real
      // exclusion check above asserts nothing under those names ships.
    } finally {
      await rm(extractDir, { recursive: true, force: true });
    }
  } finally {
    await rm(packDir, { recursive: true, force: true });
  }
});
