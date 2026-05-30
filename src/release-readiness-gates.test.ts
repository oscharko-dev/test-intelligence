import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const runReleaseReadiness = (skipGate: string) =>
  spawnSync(
    process.execPath,
    ["scripts/release-readiness.mjs", "--skip", skipGate],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
    },
  );

for (const gate of ["test:airgap-install", "test:workbench-airgap"]) {
  void test(`release-readiness rejects --skip for required gate ${gate}`, () => {
    const result = runReleaseReadiness(gate);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      new RegExp(`Required release gate\\(s\\) cannot be skipped: ${gate}`),
    );
  });
}
