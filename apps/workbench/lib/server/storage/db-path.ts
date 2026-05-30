/**
 * Pure path resolution and content-addressing helpers for the Workbench
 * storage boundary.
 *
 * Self-contained: imports only Node built-ins. Repo-root resolution mirrors
 * `resolveRepoRoot` in `lib/server/workbench-run-validation.ts` and the
 * `.test-intelligence` data convention used by the existing local stores. The
 * logic is re-implemented here (rather than imported) so the storage schema
 * stays decoupled from the run-validation module.
 */

import { createHash } from "node:crypto";
import path from "node:path";

import type { Sha256Hex } from "./types";

export interface WorkbenchStoragePaths {
  readonly databaseFile: string;
  readonly artifactRoot: string;
}

const DATA_ROOT_SEGMENT = ".test-intelligence";
const DATABASE_FILENAME = "workbench.db";
const ARTIFACT_ROOT_SEGMENT = "storage-artifacts";
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const APP_RELATIVE_SEGMENT = path.join("apps", "workbench");

/**
 * WHY: mirrors `resolveRepoRoot` in `workbench-run-validation.ts`. When
 * `WORKBENCH_REPO_ROOT` is set it is resolved to an absolute path; otherwise the
 * current working directory is used, stripping a trailing `apps/workbench`
 * segment so the data root resolves to the monorepo root in both layouts.
 */
const resolveRepoRoot = (env: NodeJS.ProcessEnv = process.env): string => {
  const explicit = env.WORKBENCH_REPO_ROOT?.trim();
  if (explicit) return path.resolve(explicit);
  const cwd = process.cwd();
  return cwd.endsWith(APP_RELATIVE_SEGMENT)
    ? path.resolve(cwd, "../..")
    : path.resolve(cwd);
};

export const resolveWorkbenchStoragePaths = (
  env: NodeJS.ProcessEnv = process.env,
): WorkbenchStoragePaths => {
  const repoRoot = resolveRepoRoot(env);
  const dataRoot = path.join(repoRoot, DATA_ROOT_SEGMENT);
  return {
    databaseFile: path.join(dataRoot, DATABASE_FILENAME),
    artifactRoot: path.join(dataRoot, ARTIFACT_ROOT_SEGMENT),
  };
};

const assertSha256Hex = (sha256Hex: Sha256Hex): void => {
  if (!SHA256_HEX_PATTERN.test(sha256Hex)) {
    throw new Error(
      "Artifact content hash must be 64 lowercase hexadecimal characters.",
    );
  }
};

/**
 * Sharded relative path for a content-addressed artifact: `<aa>/<bb>/<hash>.bin`.
 * Two-level fan-out keeps directory sizes bounded for large artifact stores.
 * Filenames are derived entirely from the validated hash, so there is no
 * path-traversal surface.
 */
export const artifactStorageRef = (sha256Hex: Sha256Hex): string => {
  assertSha256Hex(sha256Hex);
  const first = sha256Hex.slice(0, 2);
  const second = sha256Hex.slice(2, 4);
  return `${first}/${second}/${sha256Hex}.bin`;
};

export const artifactAbsolutePath = (
  paths: WorkbenchStoragePaths,
  sha256Hex: Sha256Hex,
): string =>
  path.join(paths.artifactRoot, ...artifactStorageRef(sha256Hex).split("/"));

/**
 * WHY: field name `sha256` aligns with the contracts package
 * `ExportArtifactRecord.sha256`. Returns the lowercase hex digest.
 */
export const sha256Hex = (data: string | Uint8Array): Sha256Hex =>
  createHash("sha256").update(data).digest("hex");
