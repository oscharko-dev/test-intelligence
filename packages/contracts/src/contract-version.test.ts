/**
 * Contract drift test for the reduced Test-Intelligence-only contract surface.
 *
 * Re-baseline per ADR-0011. Removing a required runtime export from
 * `packages/contracts/src/index.ts` breaks downstream evidence and migration
 * consumers that import it by name (for example, evidence packages seal
 * `CONTRACT_VERSION` at generation time). Adding an unexpected export risks
 * re-introducing a legacy carry-along symbol. This test fails closed on
 * accidental drift in either direction.
 *
 * The frozen export set lives in `contract-version-frozen.json` next to this
 * file. Re-baselining is intentional: any commit that changes the frozen JSON
 * must include the phrase `"re-baseline per ADR-XXXX"` in its commit message
 * so the ADR linkage is traceable in `git log`, per ADR-0011's protocol.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as contracts from "./index.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const frozenJsonPath = join(moduleDir, "contract-version-frozen.json");
const EXPECTED_CONTRACT_RUNTIME_EXPORTS: readonly string[] = JSON.parse(
  readFileSync(frozenJsonPath, "utf8"),
) as readonly string[];

void test("contract surface matches the frozen ADR-0011 baseline", () => {
  const actual = Object.keys(contracts as Record<string, unknown>).sort();
  const expected = [...EXPECTED_CONTRACT_RUNTIME_EXPORTS].sort();

  const missing = expected.filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expected.includes(name));

  assert.deepEqual(
    { missing, unexpected },
    { missing: [], unexpected: [] },
    `Contract surface drift detected.\n` +
      `  Missing exports (removed but expected by ADR-0011): ${JSON.stringify(missing)}\n` +
      `  Unexpected exports (present but not in ADR-0011 baseline): ${JSON.stringify(unexpected)}\n` +
      `Re-baseline contract-version-frozen.json with an explicit "re-baseline per ADR-XXXX" commit if the change is intended.`,
  );
});

void test("frozen baseline has the expected ADR-0011 cardinality", () => {
  assert.equal(
    EXPECTED_CONTRACT_RUNTIME_EXPORTS.length,
    427,
    "ADR-0011 reduced the runtime surface to 423 exports, and Issue #29 adds four Figma Snapshot Vault schema-version constants.",
  );
});
