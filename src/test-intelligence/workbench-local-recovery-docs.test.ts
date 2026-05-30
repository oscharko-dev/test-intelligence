import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

void test("troubleshooting documents Workbench local recovery evidence", async () => {
  const doc = await readFile(path.join(repoRoot, "TROUBLESHOOTING.md"), "utf8");
  for (const requiredText of [
    "Recover Local Persistence",
    ".test-intelligence/backups/",
    "workbench.db",
    "run-state/",
    "WorkbenchStorageError:MIGRATION_FAILED",
    "test:airgap-install",
    "test:workbench-airgap",
  ]) {
    assert.match(doc, new RegExp(requiredText.replaceAll(".", "\\.")));
  }
});
