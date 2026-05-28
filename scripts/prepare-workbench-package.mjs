#!/usr/bin/env node
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workbenchRoot = path.join(repoRoot, "apps", "workbench");
const sourceNextDir = path.join(workbenchRoot, ".next");
const targetRoot = path.join(repoRoot, "dist", "workbench");
const targetNextDir = path.join(targetRoot, ".next");

const pathExists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

const requirePath = async (target, hint) => {
  if (!(await pathExists(target))) {
    throw new Error(`${hint} is missing: ${target}`);
  }
};

const shouldCopyNextFile = (source) => {
  const relative = path.relative(sourceNextDir, source);
  if (relative === "") return true;
  const [topLevel] = relative.split(path.sep);
  return !new Set([
    "cache",
    "diagnostics",
    "trace",
    "trace-build",
    "types",
  ]).has(topLevel);
};

await requirePath(
  path.join(sourceNextDir, "BUILD_ID"),
  "Workbench production build",
);

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });

await cp(sourceNextDir, targetNextDir, {
  recursive: true,
  filter: shouldCopyNextFile,
});

const publicDir = path.join(workbenchRoot, "public");
if (await pathExists(publicDir)) {
  await cp(publicDir, path.join(targetRoot, "public"), { recursive: true });
}

await cp(
  path.join(workbenchRoot, "next.config.mjs"),
  path.join(targetRoot, "next.config.mjs"),
);

const sourceManifest = JSON.parse(
  await readFile(path.join(workbenchRoot, "package.json"), "utf8"),
);
const runtimeManifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  private: true,
  type: "module",
};
await writeFile(
  path.join(targetRoot, "package.json"),
  `${JSON.stringify(runtimeManifest, null, 2)}\n`,
  "utf8",
);

process.stdout.write(
  `[prepare-workbench-package] Prepared ${path.relative(repoRoot, targetRoot)}.\n`,
);
