/**
 * Filesystem-walk helpers for the legacy artifact indexer (Issue #54).
 *
 * Split from the main indexer for the file-size ceiling. These helpers open the
 * data root READ-ONLY (`readdir` + `stat`) to enumerate candidate folders; they
 * never mutate disk and never construct a path from a user-controlled value
 * (only from process env / resolved tenant scope), so they are not a path-
 * injection sink.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRoot } from "./workbench-run-validation";
import {
  formatWorkbenchTenantScope,
  resolveWorkbenchTenantScope,
} from "./workbench-tenant-scope";

const SNAPSHOT_ROOT_SEGMENT = ".test-intelligence";
const SNAPSHOT_DIRNAME = "figma-snapshots";

export interface DiscoveredSnapshotFolder {
  readonly basename: string;
  readonly tenantScope: string;
  readonly vaultPath: string;
}

export interface DiscoveredRunFolder {
  readonly basename: string;
  readonly artifactDir: string;
}

const listSubdirectories = async (
  parent: string,
): Promise<readonly string[]> => {
  const entries = await readdir(parent, { withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
};

const isDirectory = async (target: string): Promise<boolean> =>
  stat(target)
    .then((info) => info.isDirectory())
    .catch(() => false);

export const discoverLegacySnapshotFolders = async (
  env: NodeJS.ProcessEnv,
): Promise<readonly DiscoveredSnapshotFolder[]> => {
  const repoRoot = resolveRepoRoot(env);
  const tenantScope = resolveWorkbenchTenantScope(env);
  const tenantScopeKey = formatWorkbenchTenantScope(tenantScope);
  const tenantRoot = path.join(
    repoRoot,
    SNAPSHOT_ROOT_SEGMENT,
    SNAPSHOT_DIRNAME,
    ...tenantScopeKey.split("/"),
  );
  if (!(await isDirectory(tenantRoot))) return [];
  const out: DiscoveredSnapshotFolder[] = [];
  for (const fileKey of await listSubdirectories(tenantRoot)) {
    const fileKeyPath = path.join(tenantRoot, fileKey);
    for (const snapshot of await listSubdirectories(fileKeyPath)) {
      out.push({
        basename: snapshot,
        tenantScope: tenantScopeKey,
        vaultPath: path.join(fileKeyPath, snapshot),
      });
    }
  }
  return out;
};

const LEGACY_DEFAULT_OUTPUT_SEGMENT = path.join(
  ".test-intelligence",
  "local-testcases",
);

const resolveConfiguredLegacyOutputRoot = (
  repoRoot: string,
  entry: string,
): string => path.resolve(repoRoot, entry);

/**
 * WHY the default segment is always scanned: the workbench's UI launch paths
 * write to `<repoRoot>/.test-intelligence/local-testcases/<batch>` by default
 * (RunsForm.tsx placeholder, RunsScreen.tsx seed-demo `outputDir`, and the
 * SnapshotVaultScreen "Generate from selection" launcher). A normal install
 * without `WORKBENCH_OUTPUT_ROOTS` set would otherwise leave these valid legacy
 * outputs invisible to the indexer; pre-pending the default segment keeps
 * configured roots strictly additive while closing that gap. Configured roots
 * mirror the run validator allowlist and may be absolute operator-managed
 * locations. Duplicates (e.g. an operator who also lists the default in
 * `WORKBENCH_OUTPUT_ROOTS`) are deduped on the resolved absolute path so a
 * folder is never surfaced twice.
 */
const resolveLegacyOutputRoots = (
  env: NodeJS.ProcessEnv,
): readonly string[] => {
  const repoRoot = resolveRepoRoot(env);
  const configured =
    env.WORKBENCH_OUTPUT_ROOTS?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [
    path.join(repoRoot, LEGACY_DEFAULT_OUTPUT_SEGMENT),
    ...configured.map((entry) =>
      resolveConfiguredLegacyOutputRoot(repoRoot, entry),
    ),
  ]) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
};

export const discoverLegacyRunFolders = async (
  env: NodeJS.ProcessEnv,
): Promise<readonly DiscoveredRunFolder[]> => {
  const out: DiscoveredRunFolder[] = [];
  for (const root of resolveLegacyOutputRoots(env)) {
    if (!(await isDirectory(root))) continue;
    // Include the root itself: Workbench supports outputRunSubdir="none", where
    // the artifact directory is the configured output directory rather than a
    // job-id/timestamp child. The classifier still decides whether it contains
    // known Workbench markers before anything becomes visible.
    out.push({ basename: path.basename(root), artifactDir: root });
    for (const name of await listSubdirectories(root)) {
      out.push({ basename: name, artifactDir: path.join(root, name) });
    }
  }
  return out;
};
