#!/usr/bin/env node

/**
 * SBOM parity gate.
 *
 * Verifies that the CycloneDX and SPDX SBOMs for
 * `@oscharko-dev/test-intelligence` describe the same set of packages
 * (by package URL / purl). A mismatch indicates one generator drifted from
 * the other and the published supply-chain artefacts disagree about what
 * shipped — a hard fail for regulated downstream consumers.
 *
 * Scoped to a single document pair (the standalone package has one npm
 * artifact per ADR-0006).
 *
 * Usage:
 *   node scripts/check-sbom-parity.mjs [--directory <dir>] [<dir>]
 *
 * Defaults:
 *   <dir>      artifacts/sbom
 *   Expected:  test-intelligence.cdx.json + test-intelligence.spdx.json
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_EXPECTED_DOCUMENT = {
  label: "test-intelligence",
  cyclonedxFileName: "test-intelligence.cdx.json",
  spdxFileName: "test-intelligence.spdx.json",
};

export const parseArgs = (args) => {
  let directory = "artifacts/sbom";

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current) continue;
    if (current === "--directory") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("Missing value for --directory.");
      }
      directory = next;
      index += 1;
      continue;
    }
    if (current.startsWith("--directory=")) {
      directory = current.slice("--directory=".length);
      continue;
    }
    if (current.startsWith("--")) {
      throw new Error(`Unknown flag: ${current}`);
    }
    directory = current;
  }

  return {
    directory: path.resolve(repoRoot, directory),
    expectedDocuments: [DEFAULT_EXPECTED_DOCUMENT],
  };
};

const normalizePackageKey = (value) => {
  const decodedValue = decodeURIComponent(value);
  const queryIndex = decodedValue.indexOf("?");
  const fragmentIndex = decodedValue.indexOf("#");
  const endIndexCandidates = [queryIndex, fragmentIndex].filter(
    (index) => index >= 0,
  );
  const endIndex =
    endIndexCandidates.length > 0
      ? Math.min(...endIndexCandidates)
      : decodedValue.length;
  return decodedValue.slice(0, endIndex);
};

const toPackageKey = (name, version, group) => {
  const normalizedName =
    typeof group === "string" && group.length > 0 ? `${group}/${name}` : name;
  return normalizePackageKey(`${normalizedName}@${version}`);
};

export const collectCycloneDxPackageKeys = (document) => {
  const packageKeys = new Set();
  const components = [];

  if (document?.metadata?.component) {
    components.push(document.metadata.component);
  }
  if (Array.isArray(document?.components)) {
    components.push(...document.components);
  }

  for (const component of components) {
    if (
      !component ||
      typeof component !== "object" ||
      typeof component.name !== "string" ||
      typeof component.version !== "string"
    ) {
      continue;
    }
    if (typeof component.purl === "string" && component.purl.length > 0) {
      packageKeys.add(normalizePackageKey(component.purl));
      continue;
    }
    packageKeys.add(
      toPackageKey(component.name, component.version, component.group),
    );
  }

  return packageKeys;
};

export const collectSpdxPackageKeys = (document) => {
  const packageKeys = new Set();
  const packages = Array.isArray(document?.packages) ? document.packages : [];

  for (const packageEntry of packages) {
    if (
      !packageEntry ||
      typeof packageEntry !== "object" ||
      typeof packageEntry.name !== "string" ||
      typeof packageEntry.versionInfo !== "string"
    ) {
      continue;
    }
    const purlRef = Array.isArray(packageEntry.externalRefs)
      ? packageEntry.externalRefs.find(
          (reference) =>
            reference &&
            typeof reference === "object" &&
            reference.referenceType === "purl" &&
            typeof reference.referenceLocator === "string",
        )
      : null;
    if (purlRef) {
      packageKeys.add(normalizePackageKey(purlRef.referenceLocator));
      continue;
    }
    packageKeys.add(toPackageKey(packageEntry.name, packageEntry.versionInfo));
  }

  return packageKeys;
};

const diffSets = (expected, actual) => {
  return [...expected]
    .filter((value) => !actual.has(value))
    .sort((first, second) => first.localeCompare(second));
};

const verifyDocumentPair = async ({
  directory,
  label,
  cyclonedxFileName,
  spdxFileName,
}) => {
  const cyclonedxPath = path.resolve(directory, cyclonedxFileName);
  const spdxPath = path.resolve(directory, spdxFileName);
  const cyclonedxDocument = JSON.parse(await readFile(cyclonedxPath, "utf8"));
  const spdxDocument = JSON.parse(await readFile(spdxPath, "utf8"));

  const cyclonedxPackages = collectCycloneDxPackageKeys(cyclonedxDocument);
  const spdxPackages = collectSpdxPackageKeys(spdxDocument);
  const missingFromSpdx = diffSets(cyclonedxPackages, spdxPackages);
  const missingFromCycloneDx = diffSets(spdxPackages, cyclonedxPackages);

  if (missingFromSpdx.length > 0 || missingFromCycloneDx.length > 0) {
    const details = [
      missingFromSpdx.length > 0
        ? `missing from SPDX: ${missingFromSpdx.join(", ")}`
        : null,
      missingFromCycloneDx.length > 0
        ? `missing from CycloneDX: ${missingFromCycloneDx.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(`[sbom-parity] ${label} mismatch. ${details}`);
  }

  console.log(`[sbom-parity] ${label} matched ${spdxPackages.size} packages.`);
};

const main = async () => {
  const { directory, expectedDocuments } = parseArgs(process.argv.slice(2));
  for (const documentDefinition of expectedDocuments) {
    await verifyDocumentPair({
      directory,
      ...documentDefinition,
    });
  }
};

const isCliEntry = () => {
  const entryPath = process.argv[1];
  return (
    typeof entryPath === "string" &&
    path.resolve(entryPath) === fileURLToPath(import.meta.url)
  );
};

if (isCliEntry()) {
  main().catch((error) => {
    console.error("[sbom-parity] Failed:", error);
    process.exit(1);
  });
}
