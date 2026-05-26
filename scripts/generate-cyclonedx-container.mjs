#!/usr/bin/env node
/**
 * Container-image SBOM emitter (Issue #30).
 *
 * Wraps `syft` to produce a CycloneDX 1.5 software bill of materials for
 * a built container image. The companion `scripts/generate-cyclonedx.mjs`
 * is intentionally left to emit the *npm-graph* SBOM only — the parity
 * gate in `scripts/check-sbom-parity.mjs` (Issue #25) is scoped to that
 * artefact and would invert if we extended the existing script.
 *
 * The OCI image layers — bookworm-slim base, glibc, ca-certificates,
 * etc. — are the operator's threat surface, not the npm-graph's. This
 * SBOM is what enterprise procurement reviews and Trivy upload to GHCR
 * code scanning will reference.
 *
 * Usage:
 *
 *   node scripts/generate-cyclonedx-container.mjs \
 *     --image <image-ref> \
 *     [--output <path>]
 *
 * Default output: dist/sbom/test-intelligence-container.cdx.json
 *
 * Requires `syft` on PATH. The CI workflow installs it via
 * `anchore/sbom-action`.
 */

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const DEFAULT_OUTPUT = join(
  "dist",
  "sbom",
  "test-intelligence-container.cdx.json",
);

const parseArgs = (argv) => {
  let image;
  let output = DEFAULT_OUTPUT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--image") {
      image = argv[++i];
    } else if (arg?.startsWith("--image=")) {
      image = arg.slice("--image=".length);
    } else if (arg === "--output") {
      output = argv[++i];
    } else if (arg?.startsWith("--output=")) {
      output = arg.slice("--output=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!image) {
    throw new Error("Missing required --image <image-ref>");
  }
  return { image, output };
};

const requireSyft = () => {
  const probe = spawnSync("syft", ["version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    throw new Error(
      "syft is not installed or not on PATH. Install it via anchore/sbom-action in CI, or `brew install syft` locally.",
    );
  }
};

const expectedPackageName = async () => {
  const pkg = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  return String(pkg.name);
};

const assertSbomIdentifiesTestIntelligence = (sbom, expectedName) => {
  // The image is built from the test-intelligence repo; syft will include
  // the package node when its package.json is COPYed into /opt/.../package.json.
  // Fail closed on legacy product branding in generated container SBOMs.
  const serialized = JSON.stringify(sbom);
  const legacyBrandPattern = new RegExp(["workspace", "dev"].join("-"), "i");
  if (legacyBrandPattern.test(serialized)) {
    throw new Error(
      "Container SBOM contains legacy product branding; image must identify as test-intelligence only.",
    );
  }
  // Soft assertion: the package node SHOULD appear. We log a warning but
  // do not fail — syft's npm scanner depends on a package-lock or
  // node_modules layout that may not always include the meta-package.
  if (!serialized.includes(expectedName)) {
    process.stderr.write(
      `[container-sbom] warning: expected package '${expectedName}' not found in SBOM components.\n`,
    );
  }
};

const main = async () => {
  const { image, output } = parseArgs(process.argv.slice(2));
  requireSyft();

  const outputPath = resolve(packageRoot, output);
  await mkdir(dirname(outputPath), { recursive: true });

  const result = spawnSync(
    "syft",
    [image, "-o", `cyclonedx-json=${outputPath}`],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`syft exited with status ${result.status ?? "unknown"}.`);
  }

  const sbom = JSON.parse(await readFile(outputPath, "utf8"));
  const expectedName = await expectedPackageName();
  assertSbomIdentifiesTestIntelligence(sbom, expectedName);

  // Re-write with a deterministic 2-space indent so the artefact is diffable.
  await writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");

  process.stdout.write(`[container-sbom] wrote ${output} (image=${image})\n`);
};

main().catch((error) => {
  process.stderr.write(`[container-sbom] failed: ${error.message}\n`);
  process.exit(1);
});
