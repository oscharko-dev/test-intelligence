import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION,
  FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
  FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION,
  FIGMA_SNAPSHOT_PREVIEW_MANIFEST_SCHEMA_VERSION,
  type FigmaSnapshotImportStatus,
  type FigmaSnapshotManifest,
  type FigmaSnapshotNodeIndex,
  type FigmaSnapshotPreviewManifest,
} from "@oscharko-dev/ti-contracts";

import {
  buildFigmaSnapshotVaultPath,
  collectFigmaSnapshotVaultGarbage,
  computeFigmaSnapshotArtifactDigest,
  FigmaSnapshotVaultError,
  serializeFigmaSnapshotArtifact,
  validateFigmaSnapshotImportStatus,
  validateFigmaSnapshotManifest,
  validateFigmaSnapshotNodeIndex,
  validateFigmaSnapshotPreviewManifest,
} from "./figma-snapshot-vault.js";

const TENANT_SCOPE = {
  tenantId: "tenant-acme",
  environmentId: "prod",
  projectId: "claims-modernization",
} as const;

const SOURCE = {
  fileKeyHash: "a".repeat(64),
  sourceUrlHash: "b".repeat(64),
  nodeId: "12:34",
} as const;
const FIGMA_TOKEN_PREFIX = "figd" + "_";

const MANIFEST_BASE = {
  schemaVersion: FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
  snapshotId: "snapshot-20260529",
  tenantScope: TENANT_SCOPE,
  source: SOURCE,
  importStrategy: "rest_nodes",
  figmaVersion: "143.8",
  figmaLastModified: "2026-05-29T06:00:00.000Z",
  importedAt: "2026-05-29T06:15:00.000Z",
  artifactDigests: {
    nodeIndexDigest: "c".repeat(64),
    importStatusDigest: "d".repeat(64),
    previewManifestDigest: "e".repeat(64),
  },
} as const;

const NODE_INDEX_BASE = {
  schemaVersion: FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION,
  snapshotId: MANIFEST_BASE.snapshotId,
  tenantScope: TENANT_SCOPE,
  source: SOURCE,
  nodes: [
    {
      pageId: "1:1",
      pageName: "Board",
      frameId: "1:10",
      frameName: "Payment",
      nodeId: "1:11",
      nodeName: "SubmitButton",
      nodeType: "BUTTON",
      parentNodeId: "1:10",
      ancestorNodeIds: ["1:10"],
      bbox: { x: 10, y: 20, width: 120, height: 32 },
      labels: ["Submit payment"],
      textSnippet: "Submit payment",
      componentHints: ["primary-action"],
      visible: true,
      sourceChunkRefs: [{ chunkId: "chunk-01", startNodePath: "0.1" }],
    },
  ],
} as const;

const PREVIEW_BASE = {
  schemaVersion: FIGMA_SNAPSHOT_PREVIEW_MANIFEST_SCHEMA_VERSION,
  snapshotId: MANIFEST_BASE.snapshotId,
  tenantScope: TENANT_SCOPE,
  source: SOURCE,
  previewStatus: "complete",
  boundedPreview: true,
  assets: [
    {
      assetId: "preview-01",
      relativePath: "previews/preview-01.png",
      mediaType: "image/png",
      width: 800,
      height: 600,
      byteLength: 2048,
      sha256: "f".repeat(64),
    },
  ],
  tiles: [
    {
      tileId: "tile-01",
      assetId: "preview-01",
      pageId: "1:1",
      frameId: "1:10",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    },
  ],
} as const;

const IMPORT_STATUS_BASE = {
  schemaVersion: FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION,
  snapshotId: MANIFEST_BASE.snapshotId,
  tenantScope: TENANT_SCOPE,
  source: SOURCE,
  lifecycleState: "completed",
  retry: {
    attempt: 1,
    maxAttempts: 3,
  },
  rateLimit: {
    remaining: 99,
    retryAfterSeconds: 0,
    resetAt: "2026-05-29T06:20:00.000Z",
  },
  chunks: [
    {
      chunkId: "chunk-01",
      state: "completed",
      nodeCount: 1,
      contentDigest: "1".repeat(64),
    },
  ],
  checkpoint: {
    lastSuccessfulPhase: "completed",
    completedChunkIds: ["chunk-01"],
  },
} as const;

const withDigest = <T extends Record<string, unknown>>(
  value: T,
): T & {
  contentDigest: string;
} => ({
  ...value,
  contentDigest: computeFigmaSnapshotArtifactDigest({
    ...value,
    contentDigest: "0".repeat(64),
  }),
});

void test("figma snapshot vault: serialization and digest are deterministic across key order", () => {
  const left = withDigest({
    ...MANIFEST_BASE,
    artifactDigests: {
      previewManifestDigest: "e".repeat(64),
      importStatusDigest: "d".repeat(64),
      nodeIndexDigest: "c".repeat(64),
    },
  });
  const right = withDigest({
    importedAt: MANIFEST_BASE.importedAt,
    source: SOURCE,
    tenantScope: TENANT_SCOPE,
    schemaVersion: FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
    snapshotId: MANIFEST_BASE.snapshotId,
    figmaLastModified: MANIFEST_BASE.figmaLastModified,
    figmaVersion: MANIFEST_BASE.figmaVersion,
    importStrategy: MANIFEST_BASE.importStrategy,
    artifactDigests: {
      nodeIndexDigest: "c".repeat(64),
      importStatusDigest: "d".repeat(64),
      previewManifestDigest: "e".repeat(64),
    },
  });

  assert.equal(
    serializeFigmaSnapshotArtifact(left),
    serializeFigmaSnapshotArtifact(right),
  );
  assert.equal(left.contentDigest, right.contentDigest);
});

void test("figma snapshot vault: validates each artifact kind", () => {
  const manifest = validateFigmaSnapshotManifest(
    withDigest(MANIFEST_BASE),
  ) as FigmaSnapshotManifest;
  const nodeIndex = validateFigmaSnapshotNodeIndex(
    withDigest(NODE_INDEX_BASE),
  ) as FigmaSnapshotNodeIndex;
  const preview = validateFigmaSnapshotPreviewManifest(
    withDigest(PREVIEW_BASE),
  ) as FigmaSnapshotPreviewManifest;
  const status = validateFigmaSnapshotImportStatus(
    withDigest(IMPORT_STATUS_BASE),
  ) as FigmaSnapshotImportStatus;

  assert.equal(manifest.schemaVersion, FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION);
  assert.equal(
    nodeIndex.schemaVersion,
    FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION,
  );
  assert.equal(
    preview.schemaVersion,
    FIGMA_SNAPSHOT_PREVIEW_MANIFEST_SCHEMA_VERSION,
  );
  assert.equal(
    status.schemaVersion,
    FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION,
  );
});

void test("figma snapshot vault: validates large-board budget and metric metadata", () => {
  const preview = validateFigmaSnapshotPreviewManifest(
    withDigest({
      ...PREVIEW_BASE,
      budget: {
        maxTiles: 2,
        tileWidth: 1024,
        tileHeight: 768,
        candidateTileCount: 10,
        selectedTileCount: 2,
        skippedTileCount: 8,
      },
    }),
  );
  const status = validateFigmaSnapshotImportStatus(
    withDigest({
      ...IMPORT_STATUS_BASE,
      failureClass: "oversized_board",
      limits: {
        maxNodeCount: 100,
        maxPayloadBytes: 1_000_000,
        maxPreviewTiles: 2,
        maxPreviewBytes: 4096,
        maxElapsedMs: 5000,
        maxWorkingSetBytes: 2_000_000,
        maxChunkCount: 20,
      },
      metrics: {
        elapsedMs: 123,
        nodeCount: 101,
        payloadBytes: 4096,
        previewBytes: 512,
        chunkCount: 4,
        previewCount: 2,
        skippedPreviewCount: 8,
        fetchedChunkCount: 2,
        reusedChunkCount: 2,
        cacheHitCount: 2,
        liveRestCallCount: 3,
        liveRestCallsAvoided: 2,
        resumedChunkCount: 1,
        peakWorkingSetBytes: 4096,
        peakHeapUsedBytes: 8192,
      },
    }),
  );

  assert.equal(preview.budget?.skippedTileCount, 8);
  assert.equal(status.failureClass, "oversized_board");
  assert.equal(status.metrics?.peakHeapUsedBytes, 8192);
});

void test("figma snapshot vault: tolerates and strips legacy import rate-limit fields", () => {
  const legacy = withDigest({
    ...IMPORT_STATUS_BASE,
    rateLimit: {
      ...IMPORT_STATUS_BASE.rateLimit,
      figmaPlanTier: "enterprise",
      figmaRateLimitType: "file_content",
      figmaUpgradeLinkDigest: "2".repeat(64),
    },
  });

  const status = validateFigmaSnapshotImportStatus(legacy);

  assert.equal(status.contentDigest, legacy.contentDigest);
  assert.equal("figmaPlanTier" in status.rateLimit, false);
  assert.equal("figmaRateLimitType" in status.rateLimit, false);
  assert.equal("figmaUpgradeLinkDigest" in status.rateLimit, false);
});

void test("figma snapshot vault: rejects missing digests and digest mismatches", () => {
  assert.throws(
    () => validateFigmaSnapshotManifest(MANIFEST_BASE),
    /contentDigest/,
  );

  assert.throws(
    () =>
      validateFigmaSnapshotManifest({
        ...withDigest(MANIFEST_BASE),
        contentDigest: "9".repeat(64),
      }),
    /contentDigest mismatch/,
  );
});

void test("figma snapshot vault: rejects token-bearing and raw-URL content", () => {
  assert.throws(
    () =>
      validateFigmaSnapshotNodeIndex(
        withDigest({
          ...NODE_INDEX_BASE,
          nodes: [
            {
              ...NODE_INDEX_BASE.nodes[0],
              textSnippet: "authorization: bearer super-secret-token",
            },
          ],
        }),
      ),
    /token-bearing content/,
  );

  assert.throws(
    () =>
      validateFigmaSnapshotPreviewManifest(
        withDigest({
          ...PREVIEW_BASE,
          assets: [
            {
              ...PREVIEW_BASE.assets[0],
              relativePath: "https://customer-bank.example/signed-snapshot-url",
            },
          ],
        }),
      ),
    /must not be a URL|raw URL/,
  );

  assert.throws(
    () =>
      validateFigmaSnapshotNodeIndex(
        withDigest({
          ...NODE_INDEX_BASE,
          nodes: [
            {
              ...NODE_INDEX_BASE.nodes[0],
              labels: ["Review https://customer-bank.example/case/123"],
            },
          ],
        }),
      ),
    /raw URL/,
  );

  assert.throws(
    () =>
      validateFigmaSnapshotImportStatus(
        withDigest({
          ...IMPORT_STATUS_BASE,
          source: {
            ...IMPORT_STATUS_BASE.source,
            nodeId: `${FIGMA_TOKEN_PREFIX}supersecret_checkpoint_node_value_1234567890`,
          },
        }),
      ),
    /token-bearing content/,
  );
});

void test("figma snapshot vault: builds deterministic tenant-scoped storage paths and rejects unsafe segments", () => {
  assert.equal(
    buildFigmaSnapshotVaultPath({
      workspaceRoot: "/tmp/workspace",
      tenantScope: TENANT_SCOPE,
      fileKeyHash: SOURCE.fileKeyHash,
      snapshotId: MANIFEST_BASE.snapshotId,
    }),
    "/tmp/workspace/.test-intelligence/figma-snapshots/tenant-acme/prod/claims-modernization/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/snapshot-20260529",
  );

  assert.throws(
    () =>
      buildFigmaSnapshotVaultPath({
        workspaceRoot: "/tmp/workspace",
        tenantScope: TENANT_SCOPE,
        fileKeyHash: SOURCE.fileKeyHash,
        snapshotId: ".",
      }),
    /must not be '.' or '..'/,
  );

  assert.throws(
    () =>
      buildFigmaSnapshotVaultPath({
        workspaceRoot: "/tmp/workspace",
        tenantScope: TENANT_SCOPE,
        fileKeyHash: SOURCE.fileKeyHash,
        snapshotId: "..",
      }),
    /must not be '.' or '..'/,
  );

  assert.throws(
    () =>
      validateFigmaSnapshotPreviewManifest(
        withDigest({
          ...PREVIEW_BASE,
          assets: [
            {
              ...PREVIEW_BASE.assets[0],
              relativePath: "../../.env",
            },
          ],
        }),
      ),
    /must not contain '.' or '..' segments/,
  );

  assert.throws(
    () =>
      validateFigmaSnapshotPreviewManifest(
        withDigest({
          ...PREVIEW_BASE,
          assets: [
            {
              ...PREVIEW_BASE.assets[0],
              relativePath: "/absolute.png",
            },
          ],
        }),
      ),
    /must be a relative descendant path/,
  );

  assert.throws(
    () =>
      buildFigmaSnapshotVaultPath({
        workspaceRoot: "/tmp/workspace",
        tenantScope: TENANT_SCOPE,
        fileKeyHash: SOURCE.fileKeyHash,
        snapshotId: "../escape",
      }),
    /snapshotId must match/,
  );

  const siblingProjectPath = buildFigmaSnapshotVaultPath({
    workspaceRoot: "/tmp/workspace",
    tenantScope: {
      tenantId: TENANT_SCOPE.tenantId,
      environmentId: TENANT_SCOPE.environmentId,
      projectId: "policy-modernization",
    },
    fileKeyHash: SOURCE.fileKeyHash,
    snapshotId: MANIFEST_BASE.snapshotId,
  });
  assert.notEqual(
    siblingProjectPath,
    buildFigmaSnapshotVaultPath({
      workspaceRoot: "/tmp/workspace",
      tenantScope: TENANT_SCOPE,
      fileKeyHash: SOURCE.fileKeyHash,
      snapshotId: MANIFEST_BASE.snapshotId,
    }),
  );
});

void test("figma snapshot vault: garbage collection is tenant/project scoped and path-safe", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ti-figma-vault-gc-"));
  try {
    const retained = buildFigmaSnapshotVaultPath({
      workspaceRoot,
      tenantScope: TENANT_SCOPE,
      fileKeyHash: SOURCE.fileKeyHash,
      snapshotId: "snap-retained",
    });
    const deleted = buildFigmaSnapshotVaultPath({
      workspaceRoot,
      tenantScope: TENANT_SCOPE,
      fileKeyHash: SOURCE.fileKeyHash,
      snapshotId: "snap-deleted",
    });
    const siblingProject = buildFigmaSnapshotVaultPath({
      workspaceRoot,
      tenantScope: {
        tenantId: TENANT_SCOPE.tenantId,
        environmentId: TENANT_SCOPE.environmentId,
        projectId: "policy-modernization",
      },
      fileKeyHash: SOURCE.fileKeyHash,
      snapshotId: "snap-sibling",
    });
    await mkdir(retained, { recursive: true });
    await mkdir(deleted, { recursive: true });
    await mkdir(siblingProject, { recursive: true });
    await writeFile(join(retained, "marker.txt"), "retain", "utf8");
    await writeFile(join(deleted, "marker.txt"), "delete", "utf8");
    await writeFile(join(siblingProject, "marker.txt"), "sibling", "utf8");
    await writeFile(join(dirname(retained), ".stale.tmp"), "tmp", "utf8");

    const result = await collectFigmaSnapshotVaultGarbage({
      workspaceRoot,
      tenantScope: TENANT_SCOPE,
      fileKeyHash: SOURCE.fileKeyHash,
      retainSnapshotIds: ["snap-retained"],
    });

    assert.deepEqual(result.deletedSnapshotIds, ["snap-deleted"]);
    assert.deepEqual(result.deletedTempFiles, [".stale.tmp"]);
    assert.deepEqual(await readdir(dirname(retained)), ["snap-retained"]);
    assert.equal((await lstat(retained)).isDirectory(), true);
    assert.equal((await lstat(siblingProject)).isDirectory(), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("figma snapshot vault: garbage collection refuses symlinked entries", async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "ti-figma-vault-gc-symlink-"),
  );
  const outsideRoot = await mkdtemp(join(tmpdir(), "ti-figma-vault-outside-"));
  try {
    const symlinked = buildFigmaSnapshotVaultPath({
      workspaceRoot,
      tenantScope: TENANT_SCOPE,
      fileKeyHash: SOURCE.fileKeyHash,
      snapshotId: "snap-symlink",
    });
    await mkdir(dirname(symlinked), { recursive: true });
    await symlink(outsideRoot, symlinked, "dir");

    await assert.rejects(
      () =>
        collectFigmaSnapshotVaultGarbage({
          workspaceRoot,
          tenantScope: TENANT_SCOPE,
          fileKeyHash: SOURCE.fileKeyHash,
          retainSnapshotIds: [],
        }),
      (err: unknown): boolean => {
        assert.ok(err instanceof FigmaSnapshotVaultError);
        assert.equal(err.errorCode, "unsafe_path");
        return true;
      },
    );
    assert.deepEqual(await readdir(outsideRoot), []);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
