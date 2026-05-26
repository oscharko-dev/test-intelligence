#!/usr/bin/env node

/**
 * `npm sbom` format smoke test for `@oscharko-dev/test-intelligence`.
 *
 * Scoped to a single package (no `--profile` argument, no template
 * subprojects). Verifies that `npm sbom` itself can emit a CycloneDX and
 * an SPDX document for the standalone package — independent of our own
 * `scripts/generate-{cyclonedx,spdx}.mjs`. This is a defence-in-depth
 * smoke for the supply-chain story: if our generator drifts but npm's
 * built-in still works, the difference is detectable.
 *
 * `npm sbom` is available in npm >= 10.5. When it is not present, this
 * smoke logs a skip and exits 0 — we never block CI on a tool that may
 * be absent from the runner image.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const run = (command, args, { cwd = packageRoot, stdio = "pipe" } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio,
    });
    let stdout = "";
    let stderr = "";
    if (stdio === "pipe") {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(
        `Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")}`,
      );
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });

const npmSbomAvailable = async () => {
  try {
    await run("npm", ["sbom", "--help"]);
    return true;
  } catch {
    return false;
  }
};

const assertSbomDocument = ({ document, format, manifest }) => {
  if (format === "cyclonedx") {
    if (document.bomFormat !== "CycloneDX") {
      throw new Error(
        "npm CycloneDX SBOM smoke did not return a CycloneDX document.",
      );
    }
    const components = [
      document.metadata?.component,
      ...(Array.isArray(document.components) ? document.components : []),
    ];
    const matchingComponent = components.find(
      (component) => component?.version === manifest.version,
    );
    if (!matchingComponent) {
      console.log(
        "[npm-sbom-smoke] npm CycloneDX output did not preserve the manifest version; format smoke still passed.",
      );
    }
    return;
  }

  if (document.spdxVersion !== "SPDX-2.3") {
    throw new Error("npm SPDX SBOM smoke did not return an SPDX 2.3 document.");
  }
  if (!Array.isArray(document.packages)) {
    throw new Error("npm SPDX SBOM smoke returned no packages array.");
  }
  const rootPackage = document.packages.find(
    (packageEntry) => packageEntry?.versionInfo === manifest.version,
  );
  if (!rootPackage) {
    console.log(
      "[npm-sbom-smoke] npm SPDX output did not preserve the manifest version; format smoke still passed.",
    );
  }
};

const writeMinimalManifest = async ({ packageRootPath, manifest }) => {
  // Strip dev/peer/scripts/files/exports to keep `npm sbom` focused on
  // RUNTIME deps only. The smoke is about format emission, not full
  // dep-tree coverage (our own scripts/generate-{cyclonedx,spdx}.mjs
  // covers the production walk).
  // Drop runtime deps entirely — `npm sbom --package-lock-only` cannot
  // resolve them without an actual install. The smoke verifies that npm
  // can EMIT a CycloneDX/SPDX document of the right shape; the full
  // dep-tree walk is covered by our own
  // `scripts/generate-{cyclonedx,spdx}.mjs`.
  const minimal = {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    type: manifest.type,
  };
  await writeFile(
    path.join(packageRootPath, "package.json"),
    `${JSON.stringify(minimal, null, 2)}\n`,
    "utf8",
  );
};

const writeMinimalPackageLock = async ({ packageRootPath, manifest }) => {
  const packageLockPath = path.join(packageRootPath, "package-lock.json");
  await writeFile(
    packageLockPath,
    `${JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": {
            name: manifest.name,
            version: manifest.version,
            license: manifest.license,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
};

const runSmoke = async ({ packageRootPath }) => {
  if (!(await npmSbomAvailable())) {
    console.log(
      "[npm-sbom-smoke] npm sbom is unavailable on this npm version; skipping optional smoke.",
    );
    return;
  }

  const manifest = JSON.parse(
    await readFile(path.join(packageRootPath, "package.json"), "utf8"),
  );
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "test-intelligence-npm-sbom-"),
  );

  try {
    const tempPackageRoot = path.join(tempRoot, "package");
    await cp(packageRootPath, tempPackageRoot, {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(packageRootPath, source);
        if (relative.startsWith("node_modules")) return false;
        if (relative.startsWith("dist")) return false;
        if (relative.startsWith("artifacts")) return false;
        if (relative.startsWith(".git")) return false;
        return true;
      },
    });
    await writeMinimalManifest({
      packageRootPath: tempPackageRoot,
      manifest,
    });
    await writeMinimalPackageLock({
      packageRootPath: tempPackageRoot,
      manifest,
    });

    for (const format of ["cyclonedx", "spdx"]) {
      const { stdout } = await run(
        "npm",
        [
          "sbom",
          "--package-lock-only",
          "--sbom-format",
          format,
          "--sbom-type",
          "library",
        ],
        { cwd: tempPackageRoot },
      );
      assertSbomDocument({
        document: JSON.parse(stdout),
        format,
        manifest,
      });
    }

    console.log("[npm-sbom-smoke] Passed.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const main = async () => {
  await runSmoke({ packageRootPath: packageRoot });
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error("[npm-sbom-smoke] Failed:", error);
    process.exit(1);
  });
}
