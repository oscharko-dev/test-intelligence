#!/usr/bin/env node

/**
 * Package-shape gate.
 *
 * Validates that the standalone package's `package.json` is internally
 * consistent and that every referenced file exists on disk:
 *
 *   - `name`, `version`, and `license` fields are present.
 *   - `license` is one of MIT or Apache-2.0 (the standalone package is
 *     Apache-2.0; MIT is whitelisted to avoid spurious failures if the
 *     license is ever explicitly relaxed).
 *   - Every entry in `files[]` resolves (file or directory).
 *   - Every leaf string under `exports` resolves to an existing file.
 *   - `main`, `module`, `types` (if present) each appear as the target of
 *     at least one `exports` leaf — i.e. legacy entry-point fields stay
 *     consistent with the modern `exports` table.
 *   - Every `bin` target resolves to an existing file.
 *
 * Run AFTER `pnpm build` so the `dist/` tree exists.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const DEFAULT_MANIFEST_PATH = path.resolve(packageRoot, "package.json");
const ALLOWED_LICENSES = new Set(["Apache-2.0", "MIT"]);

const pathExists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

const collectExportTargets = (node, out) => {
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) {
      collectExportTargets(value, out);
    }
  }
};

const collectBinTargets = (bin) => {
  if (typeof bin === "string") return [bin];
  if (bin && typeof bin === "object")
    return Object.values(bin).filter((v) => typeof v === "string");
  return [];
};

export const validatePackageShape = async ({
  manifestPath = DEFAULT_MANIFEST_PATH,
} = {}) => {
  const violations = [];
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const rootDir = path.dirname(manifestPath);

  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    violations.push("`name` is missing or empty.");
  }
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    violations.push("`version` is missing or empty.");
  }
  if (typeof manifest.license !== "string" || manifest.license.length === 0) {
    violations.push("`license` is missing or empty.");
  } else if (!ALLOWED_LICENSES.has(manifest.license)) {
    violations.push(
      `\`license\` is '${manifest.license}'; expected one of ${[...ALLOWED_LICENSES].join(", ")}.`,
    );
  }

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const entry of files) {
    if (typeof entry !== "string") {
      violations.push(
        `files[] contains non-string entry: ${JSON.stringify(entry)}`,
      );
      continue;
    }
    const target = path.resolve(rootDir, entry);
    if (!(await pathExists(target))) {
      violations.push(`files[] entry '${entry}' does not exist on disk.`);
    }
  }

  const exportTargets = [];
  collectExportTargets(manifest.exports, exportTargets);
  const exportTargetSet = new Set(exportTargets);

  for (const entry of exportTargets) {
    const target = path.resolve(rootDir, entry);
    if (!(await pathExists(target))) {
      violations.push(`exports target '${entry}' does not exist on disk.`);
    }
  }

  for (const legacyField of /** @type {const} */ ([
    "main",
    "module",
    "types",
  ])) {
    const value = manifest[legacyField];
    if (typeof value !== "string") continue;
    const target = path.resolve(rootDir, value);
    if (!(await pathExists(target))) {
      violations.push(
        `${legacyField} target '${value}' does not exist on disk.`,
      );
    }
    if (exportTargets.length > 0 && !exportTargetSet.has(value)) {
      violations.push(
        `${legacyField} '${value}' does not appear in the exports table; legacy entry-point fields must mirror an exports leaf.`,
      );
    }
  }

  for (const target of collectBinTargets(manifest.bin)) {
    const fullPath = path.resolve(rootDir, target);
    if (!(await pathExists(fullPath))) {
      violations.push(`bin target '${target}' does not exist on disk.`);
    }
  }

  return { ok: violations.length === 0, violations };
};

export const runPackageShape = async ({
  manifestPath = DEFAULT_MANIFEST_PATH,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  try {
    const { ok, violations } = await validatePackageShape({ manifestPath });
    if (!ok) {
      stderr("[package-shape] Violations:");
      for (const v of violations) stderr(` - ${v}`);
      return 1;
    }
    stdout(
      `[package-shape] Passed for ${path.relative(process.cwd(), manifestPath)}.`,
    );
    return 0;
  } catch (error) {
    stderr(
      `[package-shape] Failed: ${error instanceof Error ? error.message : error}`,
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
  const exitCode = await runPackageShape();
  process.exit(exitCode);
}
