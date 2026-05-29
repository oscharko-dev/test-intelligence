import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
import { describe, expect, it, afterEach } from "vitest";
import { POST as previewSelectionRoute } from "@/app/api/workbench/snapshots/[snapshotId]/selection-preview/route";
import {
  listWorkbenchSnapshots,
  previewWorkbenchSnapshotSelection,
  getWorkbenchSnapshotImportJob,
  resetWorkbenchSnapshotImportStoreForTests,
  searchWorkbenchSnapshot,
  startWorkbenchSnapshotImport,
  WorkbenchSnapshotVaultError,
} from "@/lib/server/workbench-snapshot-vault";

const SNAPSHOT_ID = "snapshot-ui-test";
const FILE_KEY_HASH = "a".repeat(64);
const SOURCE_URL_HASH = "b".repeat(64);
const ZERO_DIGEST = "0".repeat(64);

const source: FigmaSnapshotSourceIdentifier = {
  fileKeyHash: FILE_KEY_HASH,
  sourceUrlHash: SOURCE_URL_HASH,
};

const records: FigmaSnapshotNodeRecord[] = [
  {
    pageId: "page-accounts",
    pageName: "Retail Accounts",
    frameId: "frame-open-account",
    frameName: "Open account application",
    nodeId: "frame-open-account",
    nodeName: "Open account application",
    nodeType: "FRAME",
    ancestorNodeIds: [],
    bbox: { x: 0, y: 0, width: 1280, height: 900 },
    labels: ["application", "banking"],
    componentHints: [],
    visible: true,
    sourceChunkRefs: [{ chunkId: "node-frame-open-account" }],
  },
  {
    pageId: "page-accounts",
    pageName: "Retail Accounts",
    frameId: "frame-open-account",
    frameName: "Open account application",
    parentNodeId: "frame-open-account",
    nodeId: "mask-iban",
    nodeName: "IBAN input mask",
    nodeType: "TEXT_FIELD",
    ancestorNodeIds: ["frame-open-account"],
    bbox: { x: 120, y: 240, width: 340, height: 48 },
    labels: ["field:account", "iban", "mask"],
    textSnippet: "IBAN",
    componentHints: ["control:text-entry"],
    visible: true,
    sourceChunkRefs: [{ chunkId: "node-mask-iban" }],
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

async function writeSnapshotFixture(repoRoot: string): Promise<void> {
  const nodeIndex = buildFigmaSnapshotLocalNodeIndex({
    snapshotId: SNAPSHOT_ID,
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
    snapshotId: SNAPSHOT_ID,
    tenantScope: DEFAULT_TENANT_SCOPE,
    source,
    lifecycleState: "completed",
    retry: { attempt: 1, maxAttempts: 3 },
    rateLimit: {
      remaining: 42,
      figmaPlanTier: "enterprise",
      figmaRateLimitType: "file",
    },
    chunks: [
      {
        chunkId: "node-mask-iban",
        state: "completed",
        nodeCount: records.length,
        contentDigest: nodeIndex.contentDigest,
      },
    ],
    checkpoint: {
      lastSuccessfulPhase: "completed",
      completedChunkIds: ["node-mask-iban"],
    },
  });
  const manifest = withDigest<FigmaSnapshotManifest>({
    schemaVersion: FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
    snapshotId: SNAPSHOT_ID,
    tenantScope: DEFAULT_TENANT_SCOPE,
    source,
    importStrategy: "hybrid",
    figmaVersion: "99",
    figmaLastModified: "2026-05-28T12:00:00.000Z",
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
    SNAPSHOT_ID,
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
}

async function tempRepo(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "ti-workbench-snapshot-"));
}

const envFor = (repoRoot: string): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  WORKBENCH_REPO_ROOT: repoRoot,
});

afterEach(() => {
  resetWorkbenchSnapshotImportStoreForTests();
});

describe("Workbench Snapshot Vault adapter", () => {
  it("lists local snapshots with sanitized status and no raw source URL", async () => {
    const repoRoot = await tempRepo();
    await writeSnapshotFixture(repoRoot);

    const snapshots = await listWorkbenchSnapshots(envFor(repoRoot));

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      snapshotId: SNAPSHOT_ID,
      tenantScope: "default/default/default",
      lifecycleState: "completed",
      previewStatus: "complete",
      launchable: true,
      nodeCount: 2,
      pageCount: 1,
      frameCount: 1,
      rateLimit: {
        remaining: 42,
        figmaPlanTier: "enterprise",
      },
    });
    expect(JSON.stringify(snapshots[0])).not.toContain("figma.com");
  });

  it("searches the local node index and preflights the exact runner scope", async () => {
    const repoRoot = await tempRepo();
    await writeSnapshotFixture(repoRoot);
    const env = envFor(repoRoot);

    const search = await searchWorkbenchSnapshot({
      snapshotId: SNAPSHOT_ID,
      query: "IBAN",
      env,
    });
    expect(search.results[0]?.nodeId).toBe("mask-iban");

    const preview = await previewWorkbenchSnapshotSelection({
      snapshotId: SNAPSHOT_ID,
      selection: { nodeIds: ["mask-iban"], pageIds: [], frameIds: [] },
      env,
    });
    expect(preview.resolvedNodeCount).toBe(1);
    expect(preview.scopeDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(preview.traceAnchors[0]?.nodeId).toBe("mask-iban");
  });

  it("rejects import start without exposing the raw Figma URL", async () => {
    await expect(
      startWorkbenchSnapshotImport({
        body: {
          action: "import",
          figmaUrl:
            "https://www.figma.com/design/ABC/CustomerBoard?node-id=1-2",
        },
        env: envFor(await tempRepo()),
      }),
    ).rejects.toMatchObject({
      code: "SNAPSHOT_IMPORT_FIGMA_TOKEN_MISSING",
      status: 503,
    });

    await startWorkbenchSnapshotImport({
      body: {
        action: "import",
        figmaUrl: "not a url",
      },
      env: envFor(await tempRepo()),
    }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(WorkbenchSnapshotVaultError);
      expect(String((error as Error).message)).not.toContain("figma.com");
    });
  });

  it("keeps active import queues isolated by tenant scope", async () => {
    const repoRoot = await tempRepo();
    const pendingFetch = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    const base = {
      action: "import",
      figmaUrl:
        "https://www.figma.com/design/ABC/CustomerBoard?node-id=1-2",
    };
    const tenantA = {
      ...envFor(repoRoot),
      TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN: "tenant-a-fixture-token",
      TEST_INTELLIGENCE_TENANT_ID: "tenant-a",
      TEST_INTELLIGENCE_ENVIRONMENT_ID: "qa",
      TEST_INTELLIGENCE_PROJECT_ID: "claims",
    };
    const tenantB = {
      ...envFor(repoRoot),
      TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN: "tenant-b-fixture-token",
      TEST_INTELLIGENCE_TENANT_ID: "tenant-b",
      TEST_INTELLIGENCE_ENVIRONMENT_ID: "qa",
      TEST_INTELLIGENCE_PROJECT_ID: "claims",
    };

    const first = await startWorkbenchSnapshotImport({
      body: base,
      env: tenantA,
      fetchImpl: pendingFetch,
    });
    const second = await startWorkbenchSnapshotImport({
      body: base,
      env: tenantB,
      fetchImpl: pendingFetch,
    });

    expect(first.tenantScope).toBe("tenant-a/qa/claims");
    expect(second.tenantScope).toBe("tenant-b/qa/claims");
    expect(first.jobId).not.toBe(second.jobId);
    expect(getWorkbenchSnapshotImportJob(first.jobId, tenantB)).toBeUndefined();
    expect(getWorkbenchSnapshotImportJob(first.jobId, tenantA)?.jobId).toBe(
      first.jobId,
    );
    await expect(
      startWorkbenchSnapshotImport({
        body: base,
        env: tenantA,
        fetchImpl: pendingFetch,
      }),
    ).rejects.toMatchObject({
      code: "SNAPSHOT_IMPORT_ALREADY_ACTIVE",
      status: 409,
    });
  });

  it("fails closed when optional preview evidence is corrupted", async () => {
    const repoRoot = await tempRepo();
    await writeSnapshotFixture(repoRoot);
    await writeFile(
      path.join(
        repoRoot,
        ".test-intelligence",
        "figma-snapshots",
        "default",
        "default",
        "default",
        FILE_KEY_HASH,
        SNAPSHOT_ID,
        "preview-manifest.json",
      ),
      "{not-json",
      "utf8",
    );

    await expect(listWorkbenchSnapshots(envFor(repoRoot))).resolves.toEqual([]);
  });

  it("maps snapshot selection preflight input errors to client 4xx responses", async () => {
    const repoRoot = await tempRepo();
    const previousRepoRoot = process.env.WORKBENCH_REPO_ROOT;
    process.env.WORKBENCH_REPO_ROOT = repoRoot;
    try {
      const response = await previewSelectionRoute(
        new Request(
          "http://localhost/api/workbench/snapshots/missing/selection-preview",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              nodeIds: ["mask-iban"],
              pageIds: [],
              frameIds: [],
            }),
          },
        ) as Parameters<typeof previewSelectionRoute>[0],
        { params: Promise.resolve({ snapshotId: "missing" }) },
      );
      const payload = (await response.json()) as {
        error?: { code?: string; message?: string };
      };

      expect(response.status).toBe(404);
      expect(payload.error?.code).toBe(
        "SNAPSHOT_SELECTION_MISSING_SNAPSHOT",
      );
      expect(payload.error?.message).toMatch(/snapshot/u);
    } finally {
      if (previousRepoRoot === undefined) {
        delete process.env.WORKBENCH_REPO_ROOT;
      } else {
        process.env.WORKBENCH_REPO_ROOT = previousRepoRoot;
      }
    }
  });
});
