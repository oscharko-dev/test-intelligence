#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const fail = (message) => {
  process.stderr.write(`[installable-package] ${message}\n`);
  process.exit(1);
};

const manifest = JSON.parse(
  await readFile(path.join(repoRoot, "package.json"), "utf8"),
);
const betterSqlite3Version = manifest.dependencies?.["better-sqlite3"];
if (typeof betterSqlite3Version !== "string" || betterSqlite3Version === "") {
  fail(
    "Published package must declare dependencies.better-sqlite3 for the bundled Workbench server.",
  );
}

const collectFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
};

const ensureDirectoryExists = async (dir, label) => {
  try {
    await access(dir);
  } catch {
    fail(`${label} is missing at ${path.relative(repoRoot, dir)}.`);
  }
};

const unresolvedRuntimeImportPattern =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](@oscharko-dev\/ti-[^"']+|is-path-inside)["']/;

for (const section of ["dependencies", "optionalDependencies"]) {
  const entries = Object.entries(manifest[section] ?? {});
  for (const [name, version] of entries) {
    if (typeof version === "string" && version.startsWith("workspace:")) {
      fail(
        `${section}.${name} must not use workspace: in the published package.`,
      );
    }
  }
}

const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (pack.status !== 0) {
  fail(pack.stderr || "npm pack --dry-run failed.");
}

const payload = JSON.parse(pack.stdout);
const files = new Set(payload[0]?.files?.map((entry) => entry.path) ?? []);
for (const required of [
  "dist/cli.js",
  "dist/index.js",
  "dist/workbench/.next/BUILD_ID",
  "dist/workbench/package.json",
]) {
  if (!files.has(required)) {
    fail(`npm pack output is missing ${required}.`);
  }
}

const workbenchManifest = JSON.parse(
  await readFile(
    path.join(repoRoot, "dist", "workbench", "package.json"),
    "utf8",
  ),
);
if (
  workbenchManifest.dependencies?.["better-sqlite3"] !== betterSqlite3Version
) {
  fail(
    "dist/workbench/package.json must carry the same better-sqlite3 runtime dependency as the published package.",
  );
}

const workbenchServerDir = path.join(
  repoRoot,
  "dist",
  "workbench",
  ".next",
  "server",
);
await ensureDirectoryExists(workbenchServerDir, "Workbench server bundle");
const serverFiles = (await collectFiles(workbenchServerDir)).filter((file) =>
  file.endsWith(".js"),
);
for (const file of serverFiles) {
  const content = await readFile(file, "utf8");
  const unresolvedImport = content.match(unresolvedRuntimeImportPattern)?.[1];
  if (unresolvedImport !== undefined) {
    fail(
      `Workbench server bundle contains unresolved runtime import '${unresolvedImport}' in ${path.relative(repoRoot, file)}.`,
    );
  }
}

process.stdout.write("[installable-package] Package is installable.\n");
