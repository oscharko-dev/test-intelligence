#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Command-line entry point for `@oscharko-dev/test-intelligence`.
 *
 * Dispatches the flat operator command surface that the standalone product
 * exposes. Each command owns its argument parser, sink, and exit-code
 * semantics; this module is a thin router that selects the handler, prints
 * help, and converts handler-thrown operator errors into a sanitized
 * `error: <message>` line on stderr with exit code 1.
 */

import { getPackageIdentity } from "./index.js";
import { CalibrationRefitOperatorError } from "@oscharko-dev/ti-eval";
import {
  parseTestIntelligenceCalibrationRefitArgs,
  runTestIntelligenceCalibrationRefitCommand,
  TEST_INTELLIGENCE_CALIBRATION_REFIT_HELP,
} from "./test-intelligence-calibration-refit-cli.js";
import {
  parseTestIntelligenceExecutionPullArgs,
  runTestIntelligenceExecutionPullCommand,
  TEST_INTELLIGENCE_EXECUTION_PULL_HELP,
  TestIntelligenceExecutionPullOperatorError,
} from "./test-intelligence-execution-pull-cli.js";
import { runFigmaExportCli } from "./test-intelligence-figma-export-cli.js";
import {
  parseTestIntelligenceOnboardArgs,
  runTestIntelligenceOnboardCommand,
  TEST_INTELLIGENCE_ONBOARD_HELP,
  TestIntelligenceOnboardOperatorError,
} from "./test-intelligence-onboard-cli.js";
import {
  parseTestIntelligenceReviewDecideArgs,
  parseTestIntelligenceReviewGetArgs,
  parseTestIntelligenceReviewListArgs,
  runTestIntelligenceReviewDecideCommand,
  runTestIntelligenceReviewGetCommand,
  runTestIntelligenceReviewListCommand,
  TEST_INTELLIGENCE_REVIEW_HELP,
  TestIntelligenceReviewOperatorError,
} from "./test-intelligence-review-cli.js";
import {
  parseTestIntelligenceAuditDossierArgs,
  parseTestIntelligenceAuditVerifyArgs,
  parseTestIntelligenceDoctorArgs,
  parseTestIntelligenceRunArgs,
  parseTestIntelligenceVerifyProvenanceArgs,
  parseTestIntelligenceVerifySealArgs,
  runTestIntelligenceAuditDossierCommand,
  runTestIntelligenceAuditVerifyCommand,
  runTestIntelligenceCommand,
  runTestIntelligenceDoctorCommand,
  runTestIntelligenceVerifyProvenanceCommand,
  runTestIntelligenceVerifySealCommand,
  TEST_INTELLIGENCE_AUDIT_DOSSIER_HELP,
  TEST_INTELLIGENCE_AUDIT_VERIFY_HELP,
  TEST_INTELLIGENCE_DOCTOR_HELP,
  TEST_INTELLIGENCE_RUN_HELP,
  TEST_INTELLIGENCE_VERIFY_PROVENANCE_HELP,
  TEST_INTELLIGENCE_VERIFY_SEAL_HELP,
  TestIntelligenceRunOperatorError,
} from "./test-intelligence-run-cli.js";
import {
  parseTestIntelligenceTmsPushArgs,
  runTestIntelligenceTmsPushCommand,
  TEST_INTELLIGENCE_TMS_PUSH_HELP,
  TestIntelligenceTmsPushOperatorError,
} from "./test-intelligence-tms-push-cli.js";
import {
  runWorkbenchInitCommand,
  runWorkbenchStartCommand,
  runWorkbenchStopCommand,
  TEST_INTELLIGENCE_WORKBENCH_INIT_HELP,
  TEST_INTELLIGENCE_WORKBENCH_START_HELP,
  TEST_INTELLIGENCE_WORKBENCH_STOP_HELP,
} from "./workbench-app-cli.js";

interface CommandSink {
  readonly stdout: (chunk: string) => void;
  readonly stderr: (chunk: string) => void;
}

const DEFAULT_SINK: CommandSink = {
  stdout: (chunk) => process.stdout.write(chunk),
  stderr: (chunk) => process.stderr.write(chunk),
};

/**
 * Top-level help text shown for `test-intelligence --help`, `-h`, `help`,
 * and when invoked with no arguments. Lists every command in stable groups
 * so operators can scan it without secondary lookups.
 */
export const TEST_INTELLIGENCE_TOP_LEVEL_HELP: string = `test-intelligence — enterprise operator command-line for the Test Intelligence product.

Usage:
  test-intelligence <command> [options]

Generation:
  run                Drive the figma_to_qc_test_cases production runner end-to-end.
  doctor             Inspect the local Test Intelligence topology and configuration.
  figma-export       Snapshot a Figma file into the canonical export schema.

Workbench:
  start              Start the local Workbench UI from the installed package.
  stop               Stop the managed local Workbench UI process.
  init               Add Workbench start/stop scripts to a host package.json.

Human oversight (DSGVO Art. 22 / EU AI Act Art. 14):
  review list|get|decide
                     Inspect and capture decisions on the human-review queue.

Self-improving calibration:
  calibration-refit  Propose and apply a calibration refit from gold data.

Integrations:
  tms-push           Push canonicalized test cases into ALM / qTest / Polarion / Xray.
  execution-pull     Pull execution evidence back into the calibration corpus.
  onboard            Provision or doctor a tenant onboarding directory.

Evidence verification:
  audit-dossier      Generate a signed audit-dossier bundle from a run directory.
  audit-verify       Verify the integrity and signature of an audit-dossier bundle.
  verify-provenance  Verify provenance.jsonld against the artifacts of a run directory.
  verify-seal        Independently verify a production-runner reproducibility seal.

General:
  --help, -h, help   Show this help text.
  --version, -V      Print the product identity and release stage.

Run "test-intelligence <command> --help" for command-specific options.
`;

const printVersion = (sink: CommandSink): void => {
  const identity = getPackageIdentity();
  sink.stdout(`${identity.name} v${identity.version} (${identity.stage})\n`);
};

const printTopLevelHelp = (sink: CommandSink): void => {
  sink.stdout(TEST_INTELLIGENCE_TOP_LEVEL_HELP);
};

const isHelpFlag = (token: string | undefined): boolean =>
  token === "--help" || token === "-h" || token === "help";

const writeOperatorError = (sink: CommandSink, message: string): void => {
  sink.stderr(`error: ${message}\n`);
};

const runRun = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(`${TEST_INTELLIGENCE_RUN_HELP}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseTestIntelligenceRunArgs(args);
  } catch (err) {
    if (err instanceof TestIntelligenceRunOperatorError) {
      writeOperatorError(sink, err.message);
      return 1;
    }
    throw err;
  }
  return runTestIntelligenceCommand(parsed, sink);
};

const runDoctor = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(`${TEST_INTELLIGENCE_DOCTOR_HELP}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseTestIntelligenceDoctorArgs(args);
  } catch (err) {
    if (err instanceof TestIntelligenceRunOperatorError) {
      writeOperatorError(sink, err.message);
      return 1;
    }
    throw err;
  }
  return runTestIntelligenceDoctorCommand(parsed, sink);
};

const runAuditDossier = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(`${TEST_INTELLIGENCE_AUDIT_DOSSIER_HELP}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseTestIntelligenceAuditDossierArgs(args);
  } catch (err) {
    if (err instanceof TestIntelligenceRunOperatorError) {
      writeOperatorError(sink, err.message);
      return 1;
    }
    throw err;
  }
  return runTestIntelligenceAuditDossierCommand(parsed, sink);
};

const runAuditVerify = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(`${TEST_INTELLIGENCE_AUDIT_VERIFY_HELP}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseTestIntelligenceAuditVerifyArgs(args);
  } catch (err) {
    if (err instanceof TestIntelligenceRunOperatorError) {
      writeOperatorError(sink, err.message);
      return 1;
    }
    throw err;
  }
  return runTestIntelligenceAuditVerifyCommand(parsed, sink);
};

const runVerifyProvenance = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(`${TEST_INTELLIGENCE_VERIFY_PROVENANCE_HELP}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseTestIntelligenceVerifyProvenanceArgs(args);
  } catch (err) {
    if (err instanceof TestIntelligenceRunOperatorError) {
      writeOperatorError(sink, err.message);
      return 1;
    }
    throw err;
  }
  return runTestIntelligenceVerifyProvenanceCommand(parsed, sink);
};

const runVerifySeal = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(`${TEST_INTELLIGENCE_VERIFY_SEAL_HELP}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseTestIntelligenceVerifySealArgs(args);
  } catch (err) {
    if (err instanceof TestIntelligenceRunOperatorError) {
      writeOperatorError(sink, err.message);
      return 1;
    }
    throw err;
  }
  return runTestIntelligenceVerifySealCommand(parsed, sink);
};

const runReview = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  const sub = args[0];
  if (sub === undefined || isHelpFlag(sub)) {
    sink.stdout(`${TEST_INTELLIGENCE_REVIEW_HELP}\n`);
    return sub === undefined ? 1 : 0;
  }
  const rest = args.slice(1);
  if (sub === "list") {
    let parsed;
    try {
      parsed = parseTestIntelligenceReviewListArgs(rest);
    } catch (err) {
      if (err instanceof TestIntelligenceReviewOperatorError) {
        writeOperatorError(sink, err.message);
        return 1;
      }
      throw err;
    }
    return runTestIntelligenceReviewListCommand(parsed, sink);
  }
  if (sub === "get") {
    let parsed;
    try {
      parsed = parseTestIntelligenceReviewGetArgs(rest);
    } catch (err) {
      if (err instanceof TestIntelligenceReviewOperatorError) {
        writeOperatorError(sink, err.message);
        return 1;
      }
      throw err;
    }
    return runTestIntelligenceReviewGetCommand(parsed, sink);
  }
  if (sub === "decide") {
    let parsed;
    try {
      parsed = parseTestIntelligenceReviewDecideArgs(rest);
    } catch (err) {
      if (err instanceof TestIntelligenceReviewOperatorError) {
        writeOperatorError(sink, err.message);
        return 1;
      }
      throw err;
    }
    return runTestIntelligenceReviewDecideCommand(parsed, sink);
  }
  writeOperatorError(
    sink,
    `unknown sub-command for "review": ${sub}\n` +
      "usage: test-intelligence review <list|get|decide> [options]",
  );
  return 1;
};

const runCalibrationRefit = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(`${TEST_INTELLIGENCE_CALIBRATION_REFIT_HELP}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseTestIntelligenceCalibrationRefitArgs(args);
  } catch (err) {
    if (err instanceof CalibrationRefitOperatorError) {
      writeOperatorError(sink, err.message);
      return 1;
    }
    throw err;
  }
  return runTestIntelligenceCalibrationRefitCommand(parsed, sink);
};

const runTmsPush = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(`${TEST_INTELLIGENCE_TMS_PUSH_HELP}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseTestIntelligenceTmsPushArgs(args);
  } catch (err) {
    if (err instanceof TestIntelligenceTmsPushOperatorError) {
      writeOperatorError(sink, err.message);
      return 1;
    }
    throw err;
  }
  return runTestIntelligenceTmsPushCommand({ options: parsed, sink });
};

const runOnboard = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(`${TEST_INTELLIGENCE_ONBOARD_HELP}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseTestIntelligenceOnboardArgs(args);
  } catch (err) {
    if (err instanceof TestIntelligenceOnboardOperatorError) {
      writeOperatorError(sink, err.message);
      return 1;
    }
    throw err;
  }
  return runTestIntelligenceOnboardCommand(parsed, sink);
};

const runExecutionPull = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(`${TEST_INTELLIGENCE_EXECUTION_PULL_HELP}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseTestIntelligenceExecutionPullArgs(args);
  } catch (err) {
    if (err instanceof TestIntelligenceExecutionPullOperatorError) {
      writeOperatorError(sink, err.message);
      return 1;
    }
    throw err;
  }
  return runTestIntelligenceExecutionPullCommand({ options: parsed, sink });
};

const runFigmaExport = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => runFigmaExportCli(args, sink);

const runWorkbenchStart = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(TEST_INTELLIGENCE_WORKBENCH_START_HELP);
    return 0;
  }
  return runWorkbenchStartCommand(args, sink);
};

const runWorkbenchStop = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(TEST_INTELLIGENCE_WORKBENCH_STOP_HELP);
    return 0;
  }
  return runWorkbenchStopCommand(args, sink);
};

const runWorkbenchInit = async (
  args: ReadonlyArray<string>,
  sink: CommandSink,
): Promise<number> => {
  if (isHelpFlag(args[0])) {
    sink.stdout(`${TEST_INTELLIGENCE_WORKBENCH_INIT_HELP}\n`);
    return 0;
  }
  return runWorkbenchInitCommand(args, sink);
};

/**
 * Dispatch a single CLI invocation to the matching command handler.
 *
 * Returns the exit code the host process should adopt. Operator errors are
 * caught per-command and converted to exit code 1; other errors propagate to
 * the caller so that crashes surface a stack trace under
 * `--unhandled-rejection` mode.
 */
export const runCli = async (
  argv: ReadonlyArray<string>,
  sink: CommandSink = DEFAULT_SINK,
): Promise<number> => {
  const command = argv[0];
  if (command === undefined || isHelpFlag(command)) {
    printTopLevelHelp(sink);
    return command === undefined ? 1 : 0;
  }
  if (command === "--version" || command === "-V") {
    printVersion(sink);
    return 0;
  }

  const rest = argv.slice(1);
  switch (command) {
    case "run":
      return runRun(rest, sink);
    case "doctor":
      return runDoctor(rest, sink);
    case "audit-dossier":
      return runAuditDossier(rest, sink);
    case "audit-verify":
      return runAuditVerify(rest, sink);
    case "verify-provenance":
      return runVerifyProvenance(rest, sink);
    case "verify-seal":
      return runVerifySeal(rest, sink);
    case "review":
      return runReview(rest, sink);
    case "calibration-refit":
      return runCalibrationRefit(rest, sink);
    case "tms-push":
      return runTmsPush(rest, sink);
    case "onboard":
      return runOnboard(rest, sink);
    case "execution-pull":
      return runExecutionPull(rest, sink);
    case "figma-export":
      return runFigmaExport(rest, sink);
    case "start":
      return runWorkbenchStart(rest, sink);
    case "stop":
      return runWorkbenchStop(rest, sink);
    case "init":
      return runWorkbenchInit(rest, sink);
    default:
      writeOperatorError(
        sink,
        `unknown command: ${command}\n` +
          'run "test-intelligence --help" for the available commands',
      );
      return 1;
  }
};

const isCliEntry = (): boolean => {
  const argv1 = process.argv[1];
  if (argv1 === undefined) {
    return false;
  }
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const entryPath = realpathSync(argv1);
    return pathToFileURL(modulePath).href === pathToFileURL(entryPath).href;
  } catch {
    return false;
  }
};

if (isCliEntry()) {
  void runCli(process.argv.slice(2)).then(
    (code) => {
      process.exit(code);
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${message}\n`);
      process.exit(1);
    },
  );
}
