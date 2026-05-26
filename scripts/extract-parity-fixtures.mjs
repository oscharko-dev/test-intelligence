#!/usr/bin/env node
/**
 * Extract the deterministic golden parity fixtures (Issue #26).
 *
 * Usage:
 *   node --import tsx scripts/extract-parity-fixtures.mjs [--legacy-checkout <path>]
 *
 * The legacy-reference checkout path is optional because every in-scope
 * parity scenario currently consumes the standalone-product source as its
 * source of truth: the scenarios snapshot constants, schemas, and pure
 * function outputs that the standalone exposes. The `--legacy-checkout` flag
 * is accepted and validated so future source comparisons have a stable,
 * validated input path.
 *
 * Reproducibility guard. Each scenario producer is invoked twice; the bytes
 * must match between the two runs. Any drift fails the extraction loudly so
 * a non-deterministic scenario cannot silently land in the gate.
 *
 * Writes:
 *   fixtures/parity/<scenario>/<artifact>
 *   fixtures/parity/<scenario>/MANIFEST.json
 *   fixtures/parity/MANIFEST.json
 */

import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  PARITY_FIXTURES_ROOT,
  LEGACY_REFERENCE_PINNED_SHA,
  assertLegacyCheckoutValid,
  assertReproducible,
  buildScenarioManifest,
  canonicalJson,
  sha256Hex,
  writeFixtureFile,
} from "./parity-shared.mjs";
import { SCENARIO_PRODUCERS } from "./parity-scenarios.mjs";

const FIXED_EXTRACTED_AT = "2026-05-23T00:00:00.000Z";

const parseArgs = (argv) => {
  const args = { legacyCheckout: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--legacy-checkout") {
      args.legacyCheckout = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`extract-parity-fixtures: unknown argument ${arg}`);
    }
  }
  return args;
};

const printHelp = () => {
  console.log(
    [
      "extract-parity-fixtures — capture deterministic golden parity fixtures (Issue #26)",
      "",
      "  --legacy-checkout <path>",
      "                        Optional. Path to a read-only legacy-reference checkout at",
      `                        the pinned SHA ${LEGACY_REFERENCE_PINNED_SHA}. Currently validated but`,
      "                        not consumed by any scenario — reserved for future widening.",
      "  --help, -h            Print this message.",
    ].join("\n"),
  );
};

const extractScenario = async (scenarioName, producer) => {
  const entries = await assertReproducible(scenarioName, async () => {
    return producer();
  });
  const scenarioDir = path.join(PARITY_FIXTURES_ROOT, scenarioName);
  await rm(scenarioDir, { recursive: true, force: true });
  await mkdir(scenarioDir, { recursive: true });
  const fileHashes = {};
  for (const entry of entries) {
    const hash = await writeFixtureFile(
      path.join(scenarioDir, entry.fileName),
      entry.bytes,
    );
    fileHashes[entry.fileName] = hash;
  }
  const manifestBytes = buildScenarioManifest({
    scenario: scenarioName,
    extractedAt: FIXED_EXTRACTED_AT,
    wdSourceSha: LEGACY_REFERENCE_PINNED_SHA,
    files: fileHashes,
  });
  await writeFile(path.join(scenarioDir, "MANIFEST.json"), manifestBytes);
  return {
    scenarioName,
    manifestHash: sha256Hex(manifestBytes),
    fileCount: entries.length,
  };
};

const writeTopLevelManifest = async (scenarioSummaries) => {
  const scenarios = {};
  for (const summary of scenarioSummaries.sort((a, b) =>
    a.scenarioName.localeCompare(b.scenarioName),
  )) {
    scenarios[summary.scenarioName] = {
      manifestSha256: `sha256:${summary.manifestHash}`,
      fileCount: summary.fileCount,
    };
  }
  const bytes = canonicalJson({
    extractedAt: FIXED_EXTRACTED_AT,
    wdSourceSha: LEGACY_REFERENCE_PINNED_SHA,
    scenarioCount: scenarioSummaries.length,
    scenarios,
  });
  await writeFile(path.join(PARITY_FIXTURES_ROOT, "MANIFEST.json"), bytes);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.legacyCheckout !== undefined) {
    const resolved = await assertLegacyCheckoutValid(args.legacyCheckout);
    console.log(
      `extract-parity-fixtures: legacy checkout validated at ${resolved}`,
    );
  }
  await mkdir(PARITY_FIXTURES_ROOT, { recursive: true });
  const summaries = [];
  for (const [scenarioName, producer] of Object.entries(SCENARIO_PRODUCERS)) {
    process.stdout.write(`extracting ${scenarioName} ... `);
    const summary = await extractScenario(scenarioName, producer);
    summaries.push(summary);
    console.log(
      `OK (${summary.fileCount} files, manifest=${summary.manifestHash.slice(0, 12)})`,
    );
  }
  await writeTopLevelManifest(summaries);
  console.log(
    `extract-parity-fixtures: ${summaries.length} scenarios extracted into ${path.relative(process.cwd(), PARITY_FIXTURES_ROOT)}/`,
  );
};

await main();
