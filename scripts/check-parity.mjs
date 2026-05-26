#!/usr/bin/env node
/**
 * Parity check orchestrator (Issue #26).
 *
 * Runs every per-scenario parity script in sequence and exits 0 iff every
 * scenario produces byte-identical output against the corresponding golden
 * fixture under `fixtures/parity/<scenario>/MANIFEST.json`.
 *
 * Usage:
 *   node --import tsx scripts/check-parity.mjs [--ci] [--scenario <name>]
 *
 * Flags:
 *   --ci                 GitHub-Actions-friendly output (machine-readable
 *                        summary at the end).
 *   --scenario <name>    Run only the named scenario. Defaults to all.
 *
 * Architecture. The orchestrator does NOT shell out to per-scenario scripts;
 * those exist as thin wrappers so an operator can invoke a single scenario
 * directly (`node --import tsx scripts/check-parity-contracts.mjs`) but the
 * orchestrator imports the same producers from `parity-scenarios.mjs` and
 * does the comparison in-process. This avoids 12 child-process spawns and
 * keeps the CI step well under the 30–60 s budget agreed in spec D-3.
 */

import process from "node:process";

import { compareScenario, printScenarioResult } from "./parity-shared.mjs";
import { SCENARIO_PRODUCERS } from "./parity-scenarios.mjs";

const parseArgs = (argv) => {
  const args = { ci: false, scenario: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ci") {
      args.ci = true;
    } else if (arg === "--scenario") {
      args.scenario = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`check-parity: unknown argument ${arg}`);
    }
  }
  return args;
};

const printHelp = () => {
  console.log(
    [
      "check-parity — Issue #26 parity gate orchestrator",
      "",
      "  --ci                 Machine-readable summary at the end.",
      "  --scenario <name>    Run only the named scenario.",
      "  --help, -h           Print this message.",
      "",
      "Scenarios:",
      ...Object.keys(SCENARIO_PRODUCERS).map((s) => `  ${s}`),
    ].join("\n"),
  );
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const scenarioNames =
    args.scenario === undefined
      ? Object.keys(SCENARIO_PRODUCERS)
      : [args.scenario];
  for (const name of scenarioNames) {
    if (SCENARIO_PRODUCERS[name] === undefined) {
      throw new Error(`check-parity: unknown scenario ${name}`);
    }
  }
  const results = [];
  for (const name of scenarioNames) {
    const entries = await SCENARIO_PRODUCERS[name]();
    const result = await compareScenario({
      scenarioName: name,
      entries,
    });
    printScenarioResult(result);
    results.push(result);
  }
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  if (args.ci) {
    console.log(
      `::notice title=Parity gate (#26)::scenarios=${results.length} passed=${passed} failed=${failed}`,
    );
  } else {
    console.log(
      `\ncheck-parity: ${passed}/${results.length} scenarios pass, ${failed} failed`,
    );
  }
  if (failed > 0) {
    if (args.ci) {
      console.log(
        `::error title=Parity gate FAILED::${failed} scenario(s) emitted bytes that diverge from the golden fixtures. Either the product regressed against the pinned fixture source, or an intentional behavior change must be reflected in the parity tooling and the golden fixtures regenerated via 'node --import tsx scripts/extract-parity-fixtures.mjs'.`,
      );
    }
    process.exitCode = 1;
  }
};

await main();
