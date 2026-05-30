#!/usr/bin/env node
/**
 * Workbench air-gap persistence verification (Issue #55, AC#2).
 *
 * Proves the local SQLite persistence layer works with NO network access using
 * the already-installed/prebuilt native `better-sqlite3` binary. This is the
 * dev/operator-install airgap path (see the AIRGAP FEASIBILITY note in the PR):
 * it does not pack a published npm artifact — it exercises the storage layer
 * exactly as a `pnpm install`-ed operator checkout would run it offline.
 *
 * It spawns the TypeScript round-trip (`workbench-airgap-roundtrip.mts`) under
 * `tsx`, which can import the real storage modules directly. The round-trip
 * is preloaded after a network/subprocess kill-switch, so loader-time and
 * storage-time egress fail the run.
 *
 * Exits 0 on success, non-zero on any failure.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const roundTrip = resolve(scriptDir, "workbench-airgap-roundtrip.mts");
const networkBlock = resolve(scriptDir, "workbench-airgap-network-block.mjs");

// Keep the child deterministic: no inherited Node preloads or module lookup
// overrides may run before the airgap kill-switch.
const childEnv = { ...process.env };
for (const key of ["NODE_OPTIONS", "NODE_PATH", "npm_config_node_options"]) {
  delete childEnv[key];
}

const child = spawn(
  process.execPath,
  ["--import", networkBlock, "--import", "tsx", roundTrip],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: childEnv,
  },
);

child.once("error", (error) => {
  process.stderr.write(
    `[workbench-airgap] failed to launch round-trip: ${error.message}\n`,
  );
  process.exit(1);
});

child.once("exit", (code) => {
  process.exit(code ?? 1);
});
