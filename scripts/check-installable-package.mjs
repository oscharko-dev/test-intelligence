#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
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

const workbenchServerDir = path.join(
  repoRoot,
  "dist",
  "workbench",
  ".next",
  "server",
);
const serverFiles = (await collectFiles(workbenchServerDir)).filter((file) =>
  file.endsWith(".js"),
);
for (const file of serverFiles) {
  const content = await readFile(file, "utf8");
  if (
    content.includes("@oscharko-dev/ti-") ||
    content.includes("is-path-inside")
  ) {
    fail(
      `Workbench server bundle contains an unresolved workspace import in ${path.relative(repoRoot, file)}.`,
    );
  }
}

process.stdout.write("[installable-package] Package is installable.\n");
