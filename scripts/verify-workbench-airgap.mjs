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
 * installs hard network kill-switches before touching anything, so a hidden
 * egress fails the run.
 *
 * Exits 0 on success, non-zero on any failure.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const roundTrip = resolve(scriptDir, "workbench-airgap-roundtrip.mts");

// `--import tsx` registers the TS loader for the .mts round-trip. Networking is
// blocked inside the round-trip itself, so no env flag is required here.
const child = spawn(process.execPath, ["--import", "tsx", roundTrip], {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env },
});

child.once("error", (error) => {
  process.stderr.write(
    `[workbench-airgap] failed to launch round-trip: ${error.message}\n`,
  );
  process.exit(1);
});

child.once("exit", (code) => {
  process.exit(code ?? 1);
});
