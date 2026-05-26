#!/usr/bin/env node

/**
 * License-policy gate.
 *
 * Walks the installed `node_modules/` tree (including the pnpm `.pnpm`
 * store when present) and fails closed if any package's license is not
 * in the `APPROVED_LICENSES` allowlist. The standalone package itself
 * is licensed Apache-2.0; transitively we accept the standard FSF-compatible
 * permissive licenses plus a small set of public-domain equivalents.
 *
 * Scoped to a single-package walker; the standalone repo has no template
 * sub-projects or per-profile manifests.
 */

import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const DEFAULT_NODE_MODULES_PATH = path.resolve(packageRoot, "node_modules");

// Curated package license allowlist. Do not edit without review.
const APPROVED_LICENSES_LIST = Object.freeze([
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

export const APPROVED_LICENSES = new Set(APPROVED_LICENSES_LIST);

// Per-package exceptions: transitive devDeps with non-allowlisted SPDX
// expressions that are still FSF-permissive on every disjunct of the
// expression. Listed here (instead of widening APPROVED_LICENSES) so the
// general allowlist stays tight and each exception is auditable.
//
// Triage:
//   - @andrewbranch/untar.js@1.x: source LICENSE is MIT; the package.json
//     `license` field is empty. Pulled in by @arethetypeswrong/cli (#25).
//   - expand-template@2.x: "(MIT OR WTFPL)" — MIT branch is fine; WTFPL
//     is FSF-free though not on our allowlist. Pulled in by prebuild-install
//     transitively via a native devDep.
//   - rc@1.x: "(BSD-2-Clause OR MIT OR Apache-2.0)" — every disjunct is
//     already on our allowlist; the OR-form just isn't matched literally.
//   - spdx-exceptions@2.x: "CC-BY-3.0" — Creative Commons 3.0,
//     FSF-compatible; pulled in by license-validation transitively.
const PACKAGE_LICENSE_EXCEPTIONS = new Map([
  ["@andrewbranch/untar.js", new Set(["UNLICENSED"])],
  ["expand-template", new Set(["(MIT OR WTFPL)"])],
  ["rc", new Set(["(BSD-2-Clause OR MIT OR Apache-2.0)"])],
  ["spdx-exceptions", new Set(["CC-BY-3.0"])],
]);

export const isLicenseApproved = (packageName, license) => {
  if (APPROVED_LICENSES.has(license)) return true;
  const allowedForPackage = PACKAGE_LICENSE_EXCEPTIONS.get(packageName);
  return allowedForPackage?.has(license) === true;
};

export const normalizeLicense = (value) => {
  if (typeof value !== "string") return "UNLICENSED";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "UNLICENSED";
};

const formatAllowedLicenses = () => APPROVED_LICENSES_LIST.join(", ");

const statPath = async (target) => {
  try {
    return await lstat(target);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
};

const loadPackageJson = async (packageJsonPath) =>
  JSON.parse(await readFile(packageJsonPath, "utf8"));

const collectPackageEntries = async (nodeModulesPath) => {
  const entries = await readdir(nodeModulesPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    if (entry.name === ".bin" || entry.name.startsWith(".")) continue;

    const entryPath = path.join(nodeModulesPath, entry.name);
    if (entry.name.startsWith("@")) {
      const scopeEntries = await readdir(entryPath, { withFileTypes: true });
      for (const scopeEntry of scopeEntries) {
        if (!scopeEntry.isDirectory() && !scopeEntry.isSymbolicLink()) continue;
        result.push(path.join(entryPath, scopeEntry.name));
      }
      continue;
    }

    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    result.push(entryPath);
  }

  return result;
};

const collectFromTree = async (nodeModulesPath) => {
  const pending = [nodeModulesPath];
  const visitedNm = new Set();
  const visitedPkg = new Set();
  const packages = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    const stats = await statPath(current);
    if (!stats) continue;

    const realNm = await realpath(current);
    if (visitedNm.has(realNm)) continue;
    visitedNm.add(realNm);

    const entries = await collectPackageEntries(realNm);
    for (const entryPath of entries) {
      const realPkg = await realpath(entryPath);
      if (visitedPkg.has(realPkg)) continue;
      visitedPkg.add(realPkg);

      const pjPath = path.join(realPkg, "package.json");
      if (!(await statPath(pjPath))) continue;

      const pj = await loadPackageJson(pjPath);
      packages.push({
        name: String(pj.name),
        version: String(pj.version),
        license: normalizeLicense(pj.license),
      });

      pending.push(path.join(realPkg, "node_modules"));
    }
  }

  return packages;
};

const collectFromPnpmStore = async (storePath) => {
  const seen = new Set();
  const packages = [];
  const storeEntries = await readdir(storePath, { withFileTypes: true });

  for (const storeEntry of storeEntries) {
    if (!storeEntry.isDirectory() || storeEntry.name.startsWith(".")) continue;

    const storeNm = path.join(storePath, storeEntry.name, "node_modules");
    if (!(await statPath(storeNm))) continue;

    const entries = await collectPackageEntries(storeNm);
    for (const entryPath of entries) {
      const pjPath = path.join(entryPath, "package.json");
      if (!(await statPath(pjPath))) continue;

      const pj = await loadPackageJson(pjPath);
      const key = `${String(pj.name)}@${String(pj.version)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      packages.push({
        name: String(pj.name),
        version: String(pj.version),
        license: normalizeLicense(pj.license),
      });
    }
  }

  return packages;
};

export const scanInstalledLicenses = async ({
  nodeModulesPath = DEFAULT_NODE_MODULES_PATH,
} = {}) => {
  if (!(await statPath(nodeModulesPath))) return [];
  const pnpmStorePath = path.join(nodeModulesPath, ".pnpm");
  if (await statPath(pnpmStorePath)) {
    return collectFromPnpmStore(pnpmStorePath);
  }
  return collectFromTree(nodeModulesPath);
};

export const runLicensePolicy = async ({
  nodeModulesPath = DEFAULT_NODE_MODULES_PATH,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  try {
    if (!(await statPath(nodeModulesPath))) {
      stderr(
        `[license-policy] node_modules is missing at '${nodeModulesPath}'. Run 'pnpm install --frozen-lockfile' first.`,
      );
      return 1;
    }

    const packages = await scanInstalledLicenses({ nodeModulesPath });
    const disallowed = packages
      .filter((p) => !isLicenseApproved(p.name, p.license))
      .sort((a, b) =>
        a.name.localeCompare(b.name) !== 0
          ? a.name.localeCompare(b.name)
          : a.version.localeCompare(b.version),
      );

    if (disallowed.length > 0) {
      stderr(
        `[license-policy] ${disallowed.length} package(s) have disallowed licenses:`,
      );
      for (const p of disallowed) {
        stderr(` - ${p.name}@${p.version}: ${p.license}`);
      }
      stderr(`[license-policy] Allowed licenses: ${formatAllowedLicenses()}`);
      return 1;
    }

    const uniqueLicenses = [...new Set(packages.map((p) => p.license))].sort();
    stdout(
      `[license-policy] Passed: ${packages.length} packages; licenses observed: ${uniqueLicenses.join(", ") || "(none)"}`,
    );
    return 0;
  } catch (error) {
    stderr(
      `[license-policy] Failed: ${error instanceof Error ? error.message : error}`,
    );
    return 1;
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
  const exitCode = await runLicensePolicy();
  process.exit(exitCode);
}
