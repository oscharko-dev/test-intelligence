/**
 * Air-gap persistence round-trip (Issue #55, AC#2).
 *
 * Runs UNDER `tsx` so it can import the real Workbench storage modules directly.
 * It proves that the local SQLite persistence layer functions with NO network
 * access, using the already-installed/prebuilt native `better-sqlite3` binary:
 *
 *   1. Hard-blocks network and subprocess access before storage imports. Any
 *      hidden egress or spawned helper fails the run.
 *   2. Bootstraps the storage into a fresh temp data root (WORKBENCH_REPO_ROOT).
 *      Loading the adapter resolves the native binary offline.
 *   3. Persists a run row + artifact metadata, closes, re-bootstraps from the
 *      same on-disk root, and reads them back — proving durability.
 *   4. Cleans up the temp root and exits 0 on success, non-zero on any failure.
 *
 * WHY a sibling .mts driven by `scripts/verify-workbench-airgap.mjs`: the storage
 * modules are TypeScript with relative internal imports (no `@/` alias in the
 * runtime chain), so `tsx` can load `bootstrap.ts` by file path with no bundler.
 */

import "./workbench-airgap-network-block.mjs";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FAILURE = "[workbench-airgap] FAILED";
const SUCCESS = "[workbench-airgap] ok";
const TENANT_SCOPE = "airgap/local/check";

const main = async (): Promise<void> => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), "ti-wb-airgap-"));
  process.env.WORKBENCH_REPO_ROOT = dataRoot;
  process.env.NODE_ENV = "test";

  try {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const bootstrapModulePath = path.join(
      scriptDir,
      "..",
      "apps",
      "workbench",
      "lib",
      "server",
      "storage",
      "bootstrap.ts",
    );
    const dbPathModulePath = path.join(
      scriptDir,
      "..",
      "apps",
      "workbench",
      "lib",
      "server",
      "storage",
      "db-path.ts",
    );
    const { bootstrapWorkbenchStorage } = (await import(
      bootstrapModulePath
    )) as {
      bootstrapWorkbenchStorage: (options?: { env?: NodeJS.ProcessEnv }) => {
        runs: {
          create: (input: {
            tenantScope: string;
            status: string;
            label?: string;
          }) => { id: string };
          get: (
            id: string,
            tenantScope: string,
          ) => { id: string; label?: string } | undefined;
        };
        artifacts: {
          create: (input: {
            runId: string;
            tenantScope: string;
            name: string;
            kind: string;
            content: { sha256: string; byteSize: number; storageRef: string };
            customerFacing: boolean;
          }) => { id: string };
          list: (filter: { runId: string; tenantScope: string }) => readonly {
            name: string;
            content: { sha256: string };
          }[];
        };
        close: () => void;
      };
    };
    const { artifactStorageRef } = (await import(dbPathModulePath)) as {
      artifactStorageRef: (sha256Hex: string) => string;
    };

    const env = { ...process.env, WORKBENCH_REPO_ROOT: dataRoot };
    const first = bootstrapWorkbenchStorage({ env });
    const run = first.runs.create({
      tenantScope: TENANT_SCOPE,
      status: "sealed",
      label: "airgap-roundtrip",
    });
    const sha256 = "c".repeat(64);
    first.artifacts.create({
      runId: run.id,
      tenantScope: TENANT_SCOPE,
      name: "airgap-evidence.json",
      kind: "json",
      content: { sha256, byteSize: 11, storageRef: artifactStorageRef(sha256) },
      customerFacing: false,
    });
    first.close();

    // Reopen from the SAME on-disk root: durability proof.
    const second = bootstrapWorkbenchStorage({ env });
    const restoredRun = second.runs.get(run.id, TENANT_SCOPE);
    const restoredArtifacts = second.artifacts.list({
      runId: run.id,
      tenantScope: TENANT_SCOPE,
    });
    second.close();

    if (restoredRun?.label !== "airgap-roundtrip") {
      throw new Error("run row did not survive close/reopen.");
    }
    if (
      restoredArtifacts.length !== 1 ||
      restoredArtifacts[0]?.name !== "airgap-evidence.json" ||
      restoredArtifacts[0]?.content.sha256 !== sha256
    ) {
      throw new Error("artifact metadata did not survive close/reopen.");
    }

    process.stdout.write(
      `${SUCCESS}: better-sqlite3 loaded offline; run + artifact metadata persisted and re-read.\n`,
    );
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${FAILURE}: ${message}\n`);
  process.exit(1);
});
