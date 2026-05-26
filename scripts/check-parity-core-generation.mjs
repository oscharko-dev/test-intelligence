#!/usr/bin/env node
/**
 * Per-scenario parity wrapper (Issue #26).
 *
 * Forwards to the orchestrator with `--scenario core-generation`. Lets an operator
 * triage a single scenario without running all twelve. The actual comparison
 * logic lives in `scripts/parity-shared.mjs` + `scripts/parity-scenarios.mjs`;
 * this file is a stable, discoverable entry point per the per-scenario script
 * architecture agreed in spec D-1.
 */

import { compareScenario, printScenarioResult } from "./parity-shared.mjs";
import { SCENARIO_PRODUCERS } from "./parity-scenarios.mjs";

const SCENARIO_NAME = "core-generation";

const main = async () => {
  const producer = SCENARIO_PRODUCERS[SCENARIO_NAME];
  if (producer === undefined) {
    throw new Error(`unknown parity scenario ${SCENARIO_NAME}`);
  }
  const entries = await producer();
  const result = await compareScenario({
    scenarioName: SCENARIO_NAME,
    entries,
  });
  printScenarioResult(result);
  if (!result.pass) {
    process.exitCode = 1;
  }
};

await main();
