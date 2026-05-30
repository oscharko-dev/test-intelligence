import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const networkBlock = path.join(scriptDir, "workbench-airgap-network-block.mjs");

const runBlockedProbe = (expression) =>
  spawnSync(
    process.execPath,
    [
      "--import",
      networkBlock,
      "--input-type=module",
      "-e",
      `import { ${expression.importName} } from "node:child_process"; ${expression.importName}("true");`,
    ],
    {
      encoding: "utf8",
    },
  );

void describe("Workbench airgap network block", () => {
  for (const importName of ["spawnSync", "execSync", "execFileSync"]) {
    void it(`blocks child_process.${importName}`, () => {
      const result = runBlockedProbe({ importName });
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /Network and subprocess access are forbidden in the Workbench airgap verifier/u,
      );
    });
  }
});
