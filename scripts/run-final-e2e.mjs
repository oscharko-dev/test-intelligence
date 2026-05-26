#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const metaFile = path.join(
  repoRoot,
  ".test-intelligence",
  "local-runtime",
  "workbench.json",
);

const readRuntimeMeta = async () => {
  try {
    const raw = await readFile(metaFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const resolveBaseUrl = async () => {
  const fromEnv = process.env.WORKBENCH_BASE_URL?.trim();
  if (fromEnv) return fromEnv;

  const meta = await readRuntimeMeta();
  if (typeof meta?.url === "string" && meta.url.trim()) return meta.url.trim();
  if (Number.isInteger(meta?.port)) return `http://localhost:${meta.port}`;

  return "http://localhost:1983";
};

const run = async () => {
  const baseUrl = await resolveBaseUrl();
  const args = [
    "--dir",
    "apps/workbench",
    "exec",
    "playwright",
    "test",
    "tests/visual/workbench.final-e2e.spec.ts",
    "--config=playwright.config.ts",
  ];

  process.stdout.write(`Running final E2E tests against ${baseUrl}\n`);

  const result = spawnSync("pnpm", args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      WORKBENCH_BASE_URL: baseUrl,
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
