// @vitest-environment node
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_TENANT_SCOPE,
  FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION,
  FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
  type FigmaSnapshotImportStatus,
  type FigmaSnapshotManifest,
  type FigmaSnapshotNodeRecord,
  type FigmaSnapshotSourceIdentifier,
} from "@oscharko-dev/ti-contracts";
import {
  buildFigmaSnapshotLocalNodeIndex,
  computeFigmaSnapshotArtifactDigest,
  planFigmaSnapshotPreviewCache,
  serializeFigmaSnapshotArtifact,
} from "@oscharko-dev/ti-core-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getWorkbenchStorage } from "@/lib/server/storage/bootstrap";
import { resetWorkbenchStorageForTests } from "@/lib/server/storage/bootstrap";
import {
  getLegacyClassification,
  getLegacyIndexSummary,
  indexLegacyArtifacts,
  resetLegacyIndexForTests,
} from "@/lib/server/workbench-legacy-indexer";
import { redactLegacyId } from "@/lib/server/workbench-legacy-indexer-classify";
import { listWorkbenchSnapshots } from "@/lib/server/workbench-snapshot-vault";

const FILE_KEY_HASH = "a".repeat(64);
const SOURCE_URL_HASH = "b".repeat(64);
const ZERO_DIGEST = "0".repeat(64);

const source: FigmaSnapshotSourceIdentifier = {
  fileKeyHash: FILE_KEY_HASH,
  sourceUrlHash: SOURCE_URL_HASH,
};

const records: FigmaSnapshotNodeRecord[] = [
  {
    pageId: "page-a",
    pageName: "Page A",
    frameId: "frame-1",
    frameName: "Frame 1",
    nodeId: "frame-1",
    nodeName: "Frame 1",
    nodeType: "FRAME",
    ancestorNodeIds: [],
    bbox: { x: 0, y: 0, width: 800, height: 600 },
    labels: ["lab"],
    componentHints: [],
    visible: true,
    sourceChunkRefs: [{ chunkId: "chunk-1" }],
  },
];

const withDigest = <T extends { contentDigest: string }>(
  value: Omit<T, "contentDigest">,
): T => {
  const draft = { ...value, contentDigest: ZERO_DIGEST } as T;
  return {
    ...draft,
    contentDigest: computeFigmaSnapshotArtifactDigest(draft),
  };
};

interface WrittenSnapshot {
  readonly snapshotId: string;
  readonly vaultPath: string;
}

const writeValidSnapshotFixture = async (
  repoRoot: string,
  snapshotId: string,
): Promise<WrittenSnapshot> => {
  const nodeIndex = buildFigmaSnapshotLocalNodeIndex({
    snapshotId,
    tenantScope: DEFAULT_TENANT_SCOPE,
    source,
    records,
  });
  const previewManifest = planFigmaSnapshotPreviewCache({
    nodeIndex,
    maxTiles: 4,
  });
  const importStatus = withDigest<FigmaSnapshotImportStatus>({
    schemaVersion: FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION,
    snapshotId,
    tenantScope: DEFAULT_TENANT_SCOPE,
    source,
    lifecycleState: "completed",
    retry: { attempt: 1, maxAttempts: 3 },
    rateLimit: { remaining: 10 },
    credential: { authMode: "personal_access_token" },
    budget: {
      policyVersion: "figma-import-budget/v1",
      resourceType: "file_bootstrap",
      windowSeconds: 60,
      maxRequestsPerWindow: 40,
      usedRequests: 1,
      remainingRequests: 39,
      resetAt: "2026-05-29T08:01:00.000Z",
    },
    chunks: [
      {
        chunkId: "chunk-1",
        state: "completed",
        nodeCount: records.length,
        contentDigest: nodeIndex.contentDigest,
      },
    ],
    checkpoint: {
      lastSuccessfulPhase: "completed",
      completedChunkIds: ["chunk-1"],
    },
  });
  const manifest = withDigest<FigmaSnapshotManifest>({
    schemaVersion: FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
    snapshotId,
    tenantScope: DEFAULT_TENANT_SCOPE,
    source,
    importStrategy: "hybrid",
    importedAt: "2026-05-29T08:00:00.000Z",
    artifactDigests: {
      nodeIndexDigest: nodeIndex.contentDigest,
      importStatusDigest: importStatus.contentDigest,
      previewManifestDigest: previewManifest.contentDigest,
    },
  });
  const vaultPath = path.join(
    repoRoot,
    ".test-intelligence",
    "figma-snapshots",
    "default",
    "default",
    "default",
    FILE_KEY_HASH,
    snapshotId,
  );
  await mkdir(vaultPath, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(vaultPath, "manifest.json"),
      `${serializeFigmaSnapshotArtifact(manifest)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(vaultPath, "node-index.json"),
      `${serializeFigmaSnapshotArtifact(nodeIndex)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(vaultPath, "import-status.json"),
      `${serializeFigmaSnapshotArtifact(importStatus)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(vaultPath, "preview-manifest.json"),
      `${serializeFigmaSnapshotArtifact(previewManifest)}\n`,
      "utf8",
    ),
  ]);
  return { snapshotId, vaultPath };
};

const envFor = (
  repoRoot: string,
  overrides?: Record<string, string>,
): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  WORKBENCH_REPO_ROOT: repoRoot,
  ...overrides,
});

let repoRoot: string;
let previousRepoRoot: string | undefined;

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(os.tmpdir(), "ti-legacy-index-"));
  previousRepoRoot = process.env.WORKBENCH_REPO_ROOT;
  process.env.WORKBENCH_REPO_ROOT = repoRoot;
  resetWorkbenchStorageForTests();
  resetLegacyIndexForTests();
});

afterEach(async () => {
  resetWorkbenchStorageForTests();
  resetLegacyIndexForTests();
  if (previousRepoRoot === undefined) {
    delete process.env.WORKBENCH_REPO_ROOT;
  } else {
    process.env.WORKBENCH_REPO_ROOT = previousRepoRoot;
  }
  await rm(repoRoot, { recursive: true, force: true });
});

describe("workbench legacy indexer (Issue #54)", () => {
  it("returns an empty summary with no warnings when the data root is absent", async () => {
    const env = envFor(repoRoot);
    const summary = await indexLegacyArtifacts({ env });
    expect(summary).toMatchObject({
      indexed: 0,
      alreadyIndexed: 0,
      legacyReadOnly: 0,
      skipped: 0,
    });
    expect(summary.warnings).toHaveLength(0);
  });

  it("returns an empty summary when the vault directory exists but holds no folders", async () => {
    const env = envFor(repoRoot);
    await mkdir(
      path.join(
        repoRoot,
        ".test-intelligence",
        "figma-snapshots",
        "default",
        "default",
        "default",
      ),
      { recursive: true },
    );
    const summary = await indexLegacyArtifacts({ env });
    expect(summary.indexed).toBe(0);
    expect(summary.skipped).toBe(0);
  });

  it("backfills a valid legacy snapshot into a durable row and marks it indexed (AC#1)", async () => {
    const env = envFor(repoRoot);
    const { snapshotId } = await writeValidSnapshotFixture(repoRoot, "snap-1");

    const summary = await indexLegacyArtifacts({ env });

    expect(summary.indexed).toBe(1);
    expect(summary.legacyReadOnly).toBe(0);
    expect(summary.alreadyIndexed).toBe(0);
    expect(summary.skipped).toBe(0);
    const rows = getWorkbenchStorage({ env }).snapshots.list();
    expect(rows.map((r) => r.source)).toContain(snapshotId);
    expect(getLegacyClassification("snapshot", snapshotId)).toBe("indexed");

    // The snapshot is visible in the live catalog after backfill.
    const catalog = await listWorkbenchSnapshots(env);
    expect(catalog.some((row) => row.snapshotId === snapshotId)).toBe(true);
  });

  it("classifies an incomplete snapshot (missing node-index) as legacy-read-only without inserting a row (AC#2)", async () => {
    const env = envFor(repoRoot);
    const written = await writeValidSnapshotFixture(repoRoot, "snap-partial");
    await rm(path.join(written.vaultPath, "node-index.json"), { force: true });

    const summary = await indexLegacyArtifacts({ env });

    expect(summary.legacyReadOnly).toBeGreaterThanOrEqual(1);
    expect(summary.indexed).toBe(0);
    const rows = getWorkbenchStorage({ env }).snapshots.list();
    expect(rows.map((r) => r.source)).not.toContain("snap-partial");
    expect(getLegacyClassification("snapshot", "snap-partial")).toBe(
      "legacy-read-only",
    );
  });

  it("classifies a triple-mismatch snapshot as legacy-read-only (AC#2)", async () => {
    const env = envFor(repoRoot);
    // Lay down two independently-valid snapshot fixtures, then overwrite folder
    // A's node-index with folder B's bytes. Every JSON file remains individually
    // structurally valid (digests match within each file), but the cross-check
    // in `readArtifactsAtVaultPath` fails because `manifest.snapshotId` no
    // longer matches `nodeIndex.snapshotId`, raising SNAPSHOT_ARTIFACT_MISMATCH.
    const a = await writeValidSnapshotFixture(repoRoot, "snap-mismatch-a");
    const b = await writeValidSnapshotFixture(repoRoot, "snap-mismatch-b");
    const foreignBytes = await readFile(
      path.join(b.vaultPath, "node-index.json"),
    );
    await writeFile(path.join(a.vaultPath, "node-index.json"), foreignBytes);

    const summary = await indexLegacyArtifacts({ env });

    expect(getLegacyClassification("snapshot", "snap-mismatch-a")).toBe(
      "legacy-read-only",
    );
    expect(summary.legacyReadOnly).toBeGreaterThanOrEqual(1);
    // Snapshot B is intact and is the one indexed pass succeeds against.
    expect(summary.indexed).toBe(1);
  });

  it("skips a corrupt JSON snapshot folder with a warning and does not throw (AC#2)", async () => {
    const env = envFor(repoRoot);
    const written = await writeValidSnapshotFixture(repoRoot, "snap-corrupt");
    await writeFile(
      path.join(written.vaultPath, "manifest.json"),
      "{ this is not json",
      "utf8",
    );

    const summary = await indexLegacyArtifacts({ env });

    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.warnings.length).toBeGreaterThan(0);
    expect(summary.indexed).toBe(0);
  });

  it("does not modify legacy snapshot artifact bytes after indexing (AC#3)", async () => {
    const env = envFor(repoRoot);
    const { vaultPath } = await writeValidSnapshotFixture(repoRoot, "snap-imm");
    const files = ["manifest.json", "node-index.json", "import-status.json"];
    const before = await Promise.all(
      files.map(async (name) => ({
        name,
        bytes: await readFile(path.join(vaultPath, name)),
        mtimeMs: (await stat(path.join(vaultPath, name))).mtimeMs,
      })),
    );
    // Capture the full directory listing (sorted). WHY: a per-file byte+mtime
    // probe would miss an indexer that ADDS a new file into the vault folder
    // (e.g. a `.legacy-marker`), so the sorted entry list locks the folder
    // shape against any kind of structural write, not just edits to known files.
    const beforeEntries = (await readdir(vaultPath)).sort();

    await indexLegacyArtifacts({ env });

    for (const entry of before) {
      const after = await readFile(path.join(vaultPath, entry.name));
      const afterStat = await stat(path.join(vaultPath, entry.name));
      // Byte-for-byte equality and unchanged mtime prove no write occurred.
      expect(Buffer.compare(entry.bytes, after)).toBe(0);
      expect(afterStat.mtimeMs).toBe(entry.mtimeMs);
    }
    const afterEntries = (await readdir(vaultPath)).sort();
    expect(afterEntries).toEqual(beforeEntries);
  });

  it("is idempotent on repeated indexing — no duplicate rows for the same legacy snapshot (AC#4)", async () => {
    const env = envFor(repoRoot);
    const { snapshotId } = await writeValidSnapshotFixture(repoRoot, "snap-id");

    const first = await indexLegacyArtifacts({ env });
    expect(first.indexed).toBe(1);

    const second = await indexLegacyArtifacts({ env });
    expect(second.indexed).toBe(0);
    expect(second.alreadyIndexed).toBe(1);

    const rows = getWorkbenchStorage({ env })
      .snapshots.list()
      .filter((r) => r.source === snapshotId);
    expect(rows).toHaveLength(1);
  });

  it("marks a legacy run output folder as legacy-read-only without fabricating a runs row", async () => {
    const env = envFor(repoRoot, {
      WORKBENCH_OUTPUT_ROOTS: ".test-intelligence/local-testcases",
    });
    const legacyRunDir = path.join(
      repoRoot,
      ".test-intelligence",
      "local-testcases",
      "ti-workbench-legacy-1",
    );
    await mkdir(legacyRunDir, { recursive: true });
    await writeFile(
      path.join(legacyRunDir, "generated-testcases.json"),
      JSON.stringify([{ id: "tc-1", title: "Smoke" }]),
      "utf8",
    );

    const summary = await indexLegacyArtifacts({ env });

    // No runs row was fabricated — there were no rows before, and there are none after.
    expect(getWorkbenchStorage({ env }).runs.list()).toHaveLength(0);
    // The folder is surfaced in the summary as legacy-read-only.
    expect(summary.legacyReadOnly).toBeGreaterThanOrEqual(1);
    expect(getLegacyClassification("run", "ti-workbench-legacy-1")).toBe(
      "legacy-read-only",
    );
  });

  // Regression guard for Copilot finding on PR #69: the workbench's default UI
  // launch paths write to `<repoRoot>/.test-intelligence/local-testcases/<batch>`
  // (RunsForm.tsx placeholder, RunsScreen.tsx seed-demo `outputDir`, and the
  // SnapshotVaultScreen "Generate from selection" launcher). A normal install
  // with `WORKBENCH_OUTPUT_ROOTS` unset must still surface these legacy runs.
  it("surfaces legacy runs under the default `.test-intelligence/local-testcases` even when WORKBENCH_OUTPUT_ROOTS is unset", async () => {
    const env = envFor(repoRoot);
    expect(env.WORKBENCH_OUTPUT_ROOTS).toBeUndefined();
    const defaultRunDir = path.join(
      repoRoot,
      ".test-intelligence",
      "local-testcases",
      "ti-workbench-default-1",
    );
    await mkdir(defaultRunDir, { recursive: true });
    await writeFile(
      path.join(defaultRunDir, "generated-testcases.json"),
      JSON.stringify([{ id: "tc-1", title: "Default" }]),
      "utf8",
    );

    const summary = await indexLegacyArtifacts({ env });

    expect(getLegacyClassification("run", "ti-workbench-default-1")).toBe(
      "legacy-read-only",
    );
    expect(summary.runs.map((r) => r.id)).toContain("ti-workbench-default-1");
    // Still never fabricates a runs row (AC#1 boundary preserved).
    expect(getWorkbenchStorage({ env }).runs.list()).toHaveLength(0);
  });

  it("excludes a run folder whose artifactDir already matches a persisted runs row", async () => {
    const env = envFor(repoRoot, {
      WORKBENCH_OUTPUT_ROOTS: ".test-intelligence/local-testcases",
    });
    const persistedRunDir = path.join(
      repoRoot,
      ".test-intelligence",
      "local-testcases",
      "ti-workbench-persisted-1",
    );
    await mkdir(persistedRunDir, { recursive: true });
    await writeFile(
      path.join(persistedRunDir, "generated-testcases.json"),
      JSON.stringify([{ id: "tc-1" }]),
      "utf8",
    );
    // Pre-register a runs row that already references this folder as its artifactDir.
    getWorkbenchStorage({ env }).runs.create({
      tenantScope: "default/default/default",
      status: "sealed",
      artifactDir: persistedRunDir,
    });

    const summary = await indexLegacyArtifacts({ env });

    // The pre-registered run is excluded from the legacy set.
    expect(
      getLegacyClassification("run", "ti-workbench-persisted-1"),
    ).toBeUndefined();
    expect(summary.legacyReadOnly).toBe(0);
  });

  it("redacts absolute paths, home dirs, and Figma tokens from every warning", async () => {
    const env = envFor(repoRoot);
    // Lay down a valid fixture so the entire triple exists, then corrupt the
    // manifest's JSON syntax so `JSON.parse` throws — a non-vault error that
    // routes through the "skipped" branch and produces a warning string. The
    // corruption embeds a tokenish string and an absolute path so the
    // redaction pass must strip them from any warning that surfaces them.
    const tokenLike = "figd_secret_token_abcdef1234567890_padded";
    const written = await writeValidSnapshotFixture(repoRoot, "snap-corrupt");
    await writeFile(
      path.join(written.vaultPath, "manifest.json"),
      `{ not json — token ${tokenLike} at ${written.vaultPath}`,
      "utf8",
    );

    const summary = await indexLegacyArtifacts({ env });

    expect(summary.warnings.length).toBeGreaterThan(0);
    for (const warning of summary.warnings) {
      expect(warning).not.toContain(repoRoot);
      expect(warning).not.toContain(os.homedir());
      expect(warning).not.toMatch(/figd_[A-Za-z0-9_-]{8,}/u);
      expect(warning).not.toMatch(/https?:\/\//iu);
    }
  });

  it("survives a concurrent double-index call with no duplicate rows (AC#4)", async () => {
    const env = envFor(repoRoot);
    const { snapshotId } = await writeValidSnapshotFixture(
      repoRoot,
      "snap-concurrent",
    );

    const [first, second] = await Promise.all([
      indexLegacyArtifacts({ env }),
      indexLegacyArtifacts({ env }),
    ]);

    // Exactly one of the two calls inserts; the other observes the row already exists.
    expect((first.indexed ?? 0) + (second.indexed ?? 0)).toBeLessThanOrEqual(1);
    const rows = getWorkbenchStorage({ env })
      .snapshots.list()
      .filter((r) => r.source === snapshotId);
    expect(rows).toHaveLength(1);
  });

  it("caches the latest summary in the singleton for synchronous read by UI/API", async () => {
    const env = envFor(repoRoot);
    expect(getLegacyIndexSummary()).toMatchObject({
      indexed: 0,
      alreadyIndexed: 0,
      legacyReadOnly: 0,
      skipped: 0,
    });
    await writeValidSnapshotFixture(repoRoot, "snap-cache");
    await indexLegacyArtifacts({ env });
    expect(getLegacyIndexSummary().indexed).toBe(1);
  });

  // WHY POSIX-only: Windows ignores POSIX file modes, so `chmod 0` does not
  // actually deny read access and the EACCES branch is unreachable there. The
  // production code path is still exercised on POSIX CI; the test is skipped on
  // Windows rather than weakened to a synthetic IO error injection.
  it.skipIf(process.platform === "win32")(
    "classifies an unreadable manifest (EACCES) as skipped with a warning, no crash",
    async () => {
      const env = envFor(repoRoot);
      const { vaultPath } = await writeValidSnapshotFixture(
        repoRoot,
        "snap-eacces",
      );
      const manifestPath = path.join(vaultPath, "manifest.json");
      await chmod(manifestPath, 0);
      try {
        const summary = await indexLegacyArtifacts({ env });
        expect(summary.skipped).toBeGreaterThanOrEqual(1);
        // The folder never produced an indexed row.
        expect(summary.indexed).toBe(0);
        // Some warning surfaced for this folder; redaction still applies.
        expect(summary.warnings.length).toBeGreaterThan(0);
        for (const warning of summary.warnings) {
          expect(warning).not.toContain(repoRoot);
        }
      } finally {
        // Restore so afterEach can rm -rf the temp tree.
        await chmod(manifestPath, 0o644);
      }
    },
  );
});

// Pure unit tests for the classifier helpers. WHY a separate describe block:
// these have no filesystem dependency and no need for the temp-root fixture, so
// they run as fast deterministic unit checks against the redaction primitive
// itself. Mutation-robust: the test must fail if `redactLegacyId` is replaced
// with an identity (`return basename;`) that skips token cleaning.
describe("workbench legacy indexer redaction helpers", () => {
  it("strips a Figma personal-access-token from a basename-shaped id", () => {
    const tokenLike = "figd_secrettoken_abcdef1234567890xy";
    const redacted = redactLegacyId(tokenLike);
    expect(redacted).not.toMatch(/figd_[A-Za-z0-9_-]{8,}/u);
  });

  it("strips an embedded https URL from a tainted basename", () => {
    const tainted = "snap-https://evil.example.com/path?token=abc";
    const redacted = redactLegacyId(tainted);
    expect(redacted).not.toMatch(/https?:\/\//iu);
  });
});
