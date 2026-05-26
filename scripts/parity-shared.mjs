// Shared helpers for the parity gate scripts (Issue #26).
//
// Every per-scenario script in `scripts/check-parity-*.mjs` and the orchestrator
// `scripts/check-parity.mjs` use these utilities to (1) hash files identically,
// (2) read/write the per-scenario MANIFEST.json with the documented shape, and
// (3) emit deterministic JSON.
//
// No real signing keys, no PII, no customer data — synthetic inputs only. See
// `fixtures/parity/README.md`.

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..");
export const PARITY_FIXTURES_ROOT = path.join(REPO_ROOT, "fixtures", "parity");
export const LEGACY_REFERENCE_PINNED_SHA =
  "006dabdf0abe30b9cac2b742a7238c6625d8e8c1";

/**
 * Hash a byte buffer with SHA-256 and return the lower-case hex digest.
 */
export const sha256Hex = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Serialize a JavaScript value to a deterministic UTF-8 JSON byte buffer.
 *
 * Convention: 2-space indent, recursive key sort, trailing newline.
 * Recursive sort means that a fresh re-emission with the same content
 * always produces byte-identical output even if a Map/object literal
 * introduces a key in a different insertion order.
 */
export const canonicalJson = (value) => {
  const sortKeys = (input) => {
    if (Array.isArray(input)) {
      return input.map(sortKeys);
    }
    if (input !== null && typeof input === "object") {
      const sorted = {};
      for (const key of Object.keys(input).sort()) {
        sorted[key] = sortKeys(input[key]);
      }
      return sorted;
    }
    return input;
  };
  return Buffer.from(`${JSON.stringify(sortKeys(value), null, 2)}\n`, "utf8");
};

/**
 * Write a file as bytes and return its SHA-256 hex digest. Creates parents
 * lazily.
 */
export const writeFixtureFile = async (absolutePath, bytes) => {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return sha256Hex(bytes);
};

/**
 * Re-emit a JSON value to a temp byte buffer and return its SHA-256 digest
 * alongside the canonical bytes. Useful for comparing against a stored hash
 * without touching disk.
 */
export const hashJson = (value) => {
  const bytes = canonicalJson(value);
  return { bytes, sha256: sha256Hex(bytes) };
};

/**
 * Build the standard per-scenario MANIFEST.json byte buffer.
 */
export const buildScenarioManifest = ({
  scenario,
  extractedAt,
  wdSourceSha,
  files,
}) => {
  const entries = {};
  for (const fileName of Object.keys(files).sort()) {
    entries[fileName] = `sha256:${files[fileName]}`;
  }
  return canonicalJson({
    scenario,
    extractedAt,
    wdSourceSha,
    fileCount: Object.keys(entries).length,
    files: entries,
  });
};

/**
 * Read a scenario MANIFEST.json from disk and parse it.
 */
export const readScenarioManifest = async (scenarioName) => {
  const manifestPath = path.join(
    PARITY_FIXTURES_ROOT,
    scenarioName,
    "MANIFEST.json",
  );
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw);
};

/**
 * Compare a freshly-emitted byte buffer to its golden hash and return a
 * descriptor object.
 */
export const compareToGolden = ({
  scenario,
  fileName,
  actualBytes,
  expectedHash,
}) => {
  const actualHash = sha256Hex(actualBytes);
  const normalizedExpected = expectedHash.startsWith("sha256:")
    ? expectedHash.slice("sha256:".length)
    : expectedHash;
  return {
    scenario,
    fileName,
    pass: actualHash === normalizedExpected,
    actualHash,
    expectedHash: normalizedExpected,
    actualBytes,
  };
};

/**
 * Render a single comparison failure into a readable diff for the CI log.
 * For JSON files we dump the actual content and the byte-for-byte size delta;
 * for binary files we dump hex prefixes only.
 */
export const renderFailure = (cmp, { goldenBytes } = {}) => {
  const lines = [
    `FAIL: ${cmp.scenario}/${cmp.fileName}`,
    `  expected SHA-256: ${cmp.expectedHash}`,
    `  actual   SHA-256: ${cmp.actualHash}`,
    `  actual size     : ${cmp.actualBytes.length} bytes`,
  ];
  if (goldenBytes !== undefined) {
    lines.push(`  golden size     : ${goldenBytes.length} bytes`);
    if (cmp.fileName.endsWith(".json") || cmp.fileName.endsWith(".txt")) {
      const actualText = cmp.actualBytes.toString("utf8");
      const goldenText = goldenBytes.toString("utf8");
      const actualLines = actualText.split("\n");
      const goldenLines = goldenText.split("\n");
      const limit = Math.min(actualLines.length, goldenLines.length);
      for (let i = 0; i < limit; i += 1) {
        if (actualLines[i] !== goldenLines[i]) {
          lines.push(`  first diff at line ${i + 1}:`);
          lines.push(`    - golden: ${JSON.stringify(goldenLines[i])}`);
          lines.push(`    + actual: ${JSON.stringify(actualLines[i])}`);
          break;
        }
      }
      if (actualLines.length !== goldenLines.length) {
        lines.push(
          `  line-count delta: golden=${goldenLines.length} actual=${actualLines.length}`,
        );
      }
    } else {
      lines.push(
        `  golden head (hex 32B): ${goldenBytes.subarray(0, 32).toString("hex")}`,
      );
      lines.push(
        `  actual head (hex 32B): ${cmp.actualBytes.subarray(0, 32).toString("hex")}`,
      );
    }
  }
  return lines.join("\n");
};

/**
 * Compare a list of `{fileName, actualBytes}` entries against a scenario's
 * golden manifest. Returns a result object with pass/fail and per-file
 * detail. Reads each golden file to provide diff context on mismatch.
 */
export const compareScenario = async ({ scenarioName, entries }) => {
  const manifest = await readScenarioManifest(scenarioName);
  const goldenFileNames = Object.keys(manifest.files).sort();
  const actualFileNames = entries.map((entry) => entry.fileName).sort();
  const results = [];
  let pass = true;
  // Count mismatch
  if (goldenFileNames.length !== actualFileNames.length) {
    pass = false;
    results.push({
      kind: "count-mismatch",
      goldenFileCount: goldenFileNames.length,
      actualFileCount: actualFileNames.length,
      goldenFiles: goldenFileNames,
      actualFiles: actualFileNames,
    });
  }
  // Per-file compare
  for (const entry of entries) {
    const expectedHash = manifest.files[entry.fileName];
    if (expectedHash === undefined) {
      pass = false;
      results.push({
        kind: "unexpected-file",
        scenario: scenarioName,
        fileName: entry.fileName,
      });
      continue;
    }
    const cmp = compareToGolden({
      scenario: scenarioName,
      fileName: entry.fileName,
      actualBytes: entry.bytes,
      expectedHash,
    });
    if (!cmp.pass) {
      const goldenBytes = await readFile(
        path.join(PARITY_FIXTURES_ROOT, scenarioName, entry.fileName),
      );
      results.push({
        kind: "byte-mismatch",
        cmp,
        rendered: renderFailure(cmp, { goldenBytes }),
      });
      pass = false;
    } else {
      results.push({
        kind: "match",
        scenario: scenarioName,
        fileName: entry.fileName,
      });
    }
  }
  // Missing files
  const actualFileNameSet = new Set(actualFileNames);
  for (const goldenName of goldenFileNames) {
    if (!actualFileNameSet.has(goldenName)) {
      pass = false;
      results.push({
        kind: "missing-file",
        scenario: scenarioName,
        fileName: goldenName,
      });
    }
  }
  return { scenarioName, pass, manifest, results };
};

/**
 * Pretty-print a scenario result to the console.
 */
export const printScenarioResult = (result) => {
  const tag = result.pass ? "PASS" : "FAIL";
  const matched = result.results.filter((r) => r.kind === "match").length;
  const total = result.manifest.fileCount;
  console.log(
    `[${tag}] scenario=${result.scenarioName} files=${matched}/${total}`,
  );
  if (!result.pass) {
    for (const r of result.results) {
      if (r.kind === "byte-mismatch") {
        console.log(r.rendered);
      } else if (r.kind === "count-mismatch") {
        console.log(
          `  count-mismatch: golden=${r.goldenFileCount} actual=${r.actualFileCount}`,
        );
        console.log(`    golden files: ${r.goldenFiles.join(", ")}`);
        console.log(`    actual files: ${r.actualFiles.join(", ")}`);
      } else if (r.kind === "missing-file") {
        console.log(`  missing actual file: ${r.fileName}`);
      } else if (r.kind === "unexpected-file") {
        console.log(`  unexpected actual file: ${r.fileName}`);
      }
    }
  }
};

/**
 * Walk a directory tree and return absolute file paths (excluding directories).
 */
export const walkFiles = async (root) => {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = await readdir(cur, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out.sort();
};

/**
 * Validate that a legacy-reference checkout path passed to
 * extract-parity-fixtures.mjs is (a) NOT the standalone repo, (b) at the
 * pinned SHA.
 */
export const assertLegacyCheckoutValid = async (legacyCheckoutPath) => {
  const resolvedLegacy = path.resolve(legacyCheckoutPath);
  const resolvedRepo = path.resolve(REPO_ROOT);
  if (resolvedLegacy === resolvedRepo) {
    throw new Error(
      `extract-parity-fixtures: refusing to extract from the standalone repo itself (${resolvedLegacy}). Pass a legacy-reference checkout path.`,
    );
  }
  const headFilePath = path.join(resolvedLegacy, ".git", "HEAD");
  const headRaw = await readFile(headFilePath, "utf8");
  let resolvedSha = headRaw.trim();
  if (resolvedSha.startsWith("ref:")) {
    const refPath = resolvedSha.slice("ref:".length).trim();
    const sha = await readFile(
      path.join(resolvedLegacy, ".git", refPath),
      "utf8",
    );
    resolvedSha = sha.trim();
  }
  if (resolvedSha !== LEGACY_REFERENCE_PINNED_SHA) {
    throw new Error(
      `extract-parity-fixtures: legacy checkout at ${resolvedLegacy} is at ${resolvedSha}, not the pinned SHA ${LEGACY_REFERENCE_PINNED_SHA}.`,
    );
  }
  return resolvedLegacy;
};

/**
 * Helper used by extract-parity-fixtures.mjs to confirm double-extraction
 * reproducibility. Given a producer fn that returns `{bytes}` for each file,
 * call it twice and assert byte-identity between the runs.
 */
export const assertReproducible = async (scenario, producer) => {
  const runA = await producer();
  const runB = await producer();
  if (runA.length !== runB.length) {
    throw new Error(
      `scenario ${scenario}: double-extraction produced different file counts (${runA.length} vs ${runB.length})`,
    );
  }
  for (let i = 0; i < runA.length; i += 1) {
    const a = runA[i];
    const b = runB.find((entry) => entry.fileName === a.fileName);
    if (b === undefined) {
      throw new Error(
        `scenario ${scenario}: file ${a.fileName} not present in second run`,
      );
    }
    if (!a.bytes.equals(b.bytes)) {
      throw new Error(
        `scenario ${scenario}: file ${a.fileName} bytes differ between consecutive extraction runs (non-determinism)`,
      );
    }
  }
  return runA;
};

/**
 * Read a file from disk; return Buffer.
 */
export const readBytes = async (absolutePath) => readFile(absolutePath);

/**
 * Stat-or-undefined.
 */
export const tryStat = async (absolutePath) => {
  try {
    return await stat(absolutePath);
  } catch {
    return undefined;
  }
};
