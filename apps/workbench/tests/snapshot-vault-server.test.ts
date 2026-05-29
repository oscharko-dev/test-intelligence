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
import { POST as snapshotsRoute } from "@/app/api/workbench/snapshots/route";
import { POST as previewSelectionRoute } from "@/app/api/workbench/snapshots/[snapshotId]/selection-preview/route";
import {
  listWorkbenchSnapshots,
  previewWorkbenchSnapshotSelection,
  getWorkbenchSnapshotImportCompletionForTests,
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
    },
    credential: {
      authMode: "enterprise_service_token",
    },
    budget: {
      policyVersion: "figma-import-budget/v1",
      resourceType: "node_batch",
      windowSeconds: 60,
      maxRequestsPerWindow: 80,
      usedRequests: 4,
      remainingRequests: 76,
      resetAt: "2026-05-29T08:01:00.000Z",
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

const createWorkbenchBootstrapFile = (nodeIds: readonly string[]): unknown => ({
  name: "Workbench Board",
  lastModified: "2026-05-29T09:00:00Z",
  version: "version-1",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [
      {
        id: "1:0",
        name: "Primary Page",
        type: "CANVAS",
        children: nodeIds.map((nodeId, index) => ({
          id: nodeId,
          name: `Screen ${index + 1}`,
          type: "FRAME",
          visible: true,
        })),
      },
    ],
  },
});

const createWorkbenchNodesResponse = (
  nodeIds: readonly string[],
): unknown => ({
  name: "Workbench Board",
  lastModified: "2026-05-29T09:00:00Z",
  version: "version-1",
  nodes: Object.fromEntries(
    nodeIds.map((nodeId) => [
      nodeId,
      {
        document: {
          id: nodeId,
          name: `Screen ${nodeId}`,
          type: "FRAME",
          visible: true,
          absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
        },
      },
    ]),
  ),
});

const createWorkbenchFigmaFetch = (
  nodeIds: readonly string[],
): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/files/ABC") {
      return Response.json(createWorkbenchBootstrapFile(nodeIds));
    }
    if (url.pathname === "/v1/files/ABC/nodes") {
      const ids = (url.searchParams.get("ids") ?? "")
        .split(",")
        .filter(Boolean);
      return Response.json(createWorkbenchNodesResponse(ids));
    }
    return Response.json({ err: "unexpected request" }, { status: 500 });
  }) as typeof fetch;

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
      },
      credential: {
        authMode: "enterprise_service_token",
      },
      budget: {
        remainingRequests: 76,
        resourceType: "node_batch",
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
      failureClass: "missing_credential",
      status: 503,
    });

    const response = await snapshotsRoute(
      new Request("http://localhost/api/workbench/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import",
          figmaUrl:
            "https://www.figma.com/design/ABC/CustomerBoard?node-id=1-2",
        }),
      }) as Parameters<typeof snapshotsRoute>[0],
    );
    const payload = (await response.json()) as {
      error?: { failureClass?: string; message?: string };
    };
    expect(response.status).toBe(503);
    expect(payload.error?.failureClass).toBe("missing_credential");
    expect(payload.error?.message).not.toContain("figma.com");

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
    const pendingFetch = (() =>
      new Promise<Response>(() => undefined)) as typeof fetch;
    const base = {
      action: "import",
      figmaUrl: "https://www.figma.com/design/ABC/CustomerBoard?node-id=1-2",
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

  it("projects bootstrap 429 metadata into sanitized Workbench guidance", async () => {
    const repoRoot = await tempRepo();
    const env = {
      ...envFor(repoRoot),
      TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN:
        "figd_workbench_low_limit_token_1234567890_padded",
    };
    const fetchImpl = (async () =>
      Response.json(
        { err: "rate limited" },
        {
          status: 429,
          headers: {
            "Retry-After": "90",
            "X-Figma-Plan-Tier": "starter",
            "X-Figma-Rate-Limit-Type": "low_limit",
            "X-Figma-Upgrade-Link":
              "https://www.figma.com/pricing?token=figd_header_secret_value_1234567890",
          },
        },
      )) as typeof fetch;

    const queued = await startWorkbenchSnapshotImport({
      body: {
        action: "import",
        figmaUrl:
          "https://www.figma.com/design/ABC/CustomerBoard?node-id=1-2&access_token=private",
      },
      env,
      fetchImpl,
    });
    await getWorkbenchSnapshotImportCompletionForTests(queued.jobId);

    const job = getWorkbenchSnapshotImportJob(queued.jobId, env);
    expect(job).toMatchObject({
      status: "failed",
      failureClass: "throttled",
      rateLimit: {
        retryAfterSeconds: 90,
        figmaPlanTier: "starter",
        figmaRateLimitType: "low_limit",
        remediation: {
          scenario: "low_limit",
        },
      },
    });
    const serialized = JSON.stringify(job);
    expect(serialized).not.toContain("figd_workbench_low_limit");
    expect(serialized).not.toContain("figd_header_secret");
    expect(serialized).not.toContain("https://www.figma.com");
    expect(serialized).not.toContain("access_token=private");

    const cleanQueued = await startWorkbenchSnapshotImport({
      body: {
        action: "import",
        figmaUrl: "https://www.figma.com/design/ABC/CustomerBoard?node-id=1-2",
      },
      env,
      fetchImpl,
    });
    await getWorkbenchSnapshotImportCompletionForTests(cleanQueued.jobId);
    expect(cleanQueued.sourceUrlHash).toBe(queued.sourceUrlHash);
  });

  it("surfaces invalid and unsupported credential modes as deterministic Workbench failures", async () => {
    const baseBody = {
      action: "import",
      figmaUrl: "https://www.figma.com/design/ABC/CustomerBoard?node-id=1-2",
    };
    const invalidEnv = {
      ...envFor(await tempRepo()),
      TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN:
        "Authorization: Bearer figd_invalid_workbench_token_1234567890",
    };
    const invalid = await startWorkbenchSnapshotImport({
      body: baseBody,
      env: invalidEnv,
      fetchImpl: createWorkbenchFigmaFetch(["1:1"]),
    });
    await getWorkbenchSnapshotImportCompletionForTests(invalid.jobId);
    const invalidJob = getWorkbenchSnapshotImportJob(invalid.jobId, invalidEnv);
    expect(invalidJob).toMatchObject({
      status: "failed",
      failureClass: "invalid_credential",
    });
    expect(JSON.stringify(invalidJob)).not.toContain("figd_invalid_workbench");

    const unsupportedEnv = {
      ...envFor(await tempRepo()),
      TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN:
        "figd_unsupported_workbench_token_1234567890",
      TEST_INTELLIGENCE_FIGMA_CREDENTIAL_MODE: "oauth_access_token",
    };
    const unsupported = await startWorkbenchSnapshotImport({
      body: baseBody,
      env: unsupportedEnv,
      fetchImpl: createWorkbenchFigmaFetch(["1:1"]),
    });
    await getWorkbenchSnapshotImportCompletionForTests(unsupported.jobId);
    const unsupportedJob = getWorkbenchSnapshotImportJob(
      unsupported.jobId,
      unsupportedEnv,
    );
    expect(unsupportedJob).toMatchObject({
      status: "failed",
      failureClass: "unsupported_auth_mode",
    });
    expect(JSON.stringify(unsupportedJob)).not.toContain(
      "figd_unsupported_workbench",
    );
  });

  it("surfaces local budget exhaustion in Workbench without token-derived witnesses", async () => {
    const repoRoot = await tempRepo();
    const env = {
      ...envFor(repoRoot),
      TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN:
        "figd_budget_workbench_token_1234567890",
      TEST_INTELLIGENCE_FIGMA_IMPORT_MAX_REQUESTS_PER_WINDOW: "1",
    };
    const queued = await startWorkbenchSnapshotImport({
      body: {
        action: "import",
        figmaUrl: "https://www.figma.com/design/ABC/CustomerBoard?node-id=1-2",
      },
      env,
      fetchImpl: createWorkbenchFigmaFetch(
        Array.from({ length: 9 }, (_, index) => `1:${index + 1}`),
      ),
    });
    await getWorkbenchSnapshotImportCompletionForTests(queued.jobId);

    const job = getWorkbenchSnapshotImportJob(queued.jobId, env);
    expect(job).toMatchObject({
      status: "failed",
      failureClass: "budget_exhausted",
      credential: {
        authMode: "personal_access_token",
      },
      budget: {
        maxRequestsPerWindow: 1,
        remainingRequests: 0,
      },
    });
    const serialized = JSON.stringify(job);
    expect(serialized).not.toContain("figd_budget_workbench");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("tokenResourceKeyHash");
    expect(serialized).not.toContain("https://www.figma.com");
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
      expect(payload.error?.code).toBe("SNAPSHOT_SELECTION_MISSING_SNAPSHOT");
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
