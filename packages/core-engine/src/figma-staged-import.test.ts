import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TenantScope } from "@oscharko-dev/ti-contracts";

import {
  FigmaStagedImportError,
  importStagedFigmaSnapshot,
} from "./figma-staged-import.js";

const TENANT_SCOPE: TenantScope = {
  tenantId: "tenant-a",
  environmentId: "dev",
  projectId: "project-a",
};
const FIGMA_TOKEN_PREFIX = "figd" + "_";
const ACCESS_TOKEN = `${FIGMA_TOKEN_PREFIX}supersecret_import_token_value_1234567890_padded_padded`;
const FILE_KEY = "FILE123";
const FIGMA_URL = `https://www.figma.com/design/${FILE_KEY}/Customer-Board?node-id=1-1`;
const IMPORT_DATE = new Date("2026-05-29T10:00:00.000Z");

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const errJson = (
  status: number,
  body: unknown,
  headers: HeadersInit = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const createBootstrapFile = (nodeIds: readonly string[]): unknown => ({
  name: "Enterprise Board",
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

const createNodeDocument = (nodeId: string): unknown => ({
  id: nodeId,
  name: `Checkout ${nodeId}`,
  type: "FRAME",
  visible: true,
  absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
  children: [
    {
      id: `${nodeId}:copy`,
      name: "Customer URI should not persist",
      type: "TEXT",
      visible: true,
      characters: `Visit https://customer.example/private-board or mailto:claims@customer.example with ${FIGMA_TOKEN_PREFIX}payload_secret_value_1234567890 for details`,
    },
  ],
});

const createDeepNodeDocumentJson = (depth: number): string => {
  let nodeJson =
    '{"id":"deep:leaf","name":"Deep Leaf","type":"TEXT","visible":true,"characters":"terminal"}';
  for (let index = depth; index > 0; index -= 1) {
    nodeJson = `{"id":"deep:${index}","name":"Deep ${index}","type":"${
      index === 1 ? "FRAME" : "GROUP"
    }","visible":true,"children":[${nodeJson}]}`;
  }
  return nodeJson;
};

const createNodesResponse = (nodeIds: readonly string[]): unknown => ({
  name: "Enterprise Board",
  lastModified: "2026-05-29T09:00:00Z",
  version: "version-1",
  nodes: Object.fromEntries(
    nodeIds.map((nodeId) => [nodeId, { document: createNodeDocument(nodeId) }]),
  ),
});

const createImagesResponse = (nodeIds: readonly string[]): unknown => ({
  images: Object.fromEntries(
    nodeIds.map((nodeId) => [
      nodeId,
      `https://figma-alpha-api.s3.us-west-2.amazonaws.com/${nodeId.replace(/:/gu, "_")}.png`,
    ]),
  ),
});

interface MockFigmaFetchOptions {
  readonly nodeIds: readonly string[];
  readonly failNodeIds?: ReadonlySet<string>;
  readonly oversizedNodeBatches?: boolean;
  readonly oversizedImageBatches?: boolean;
  readonly rateLimitFirstNodeBatch?: boolean;
}

interface MockFigmaFetch {
  readonly fetchImpl: typeof fetch;
  readonly requestedUrls: string[];
  readonly sleeps: number[];
  readonly maxConcurrency: () => number;
}

const createMockFigmaFetch = (
  options: MockFigmaFetchOptions,
): MockFigmaFetch => {
  const requestedUrls: string[] = [];
  const sleeps: number[] = [];
  let inFlight = 0;
  let maxConcurrency = 0;
  let rateLimited = false;
  const fetchImpl = (async (rawUrl: string) => {
    inFlight += 1;
    maxConcurrency = Math.max(maxConcurrency, inFlight);
    try {
      requestedUrls.push(rawUrl);
      const url = new URL(rawUrl);
      if (url.pathname === `/v1/files/${FILE_KEY}`) {
        return okJson(createBootstrapFile(options.nodeIds));
      }
      if (url.pathname === `/v1/files/${FILE_KEY}/nodes`) {
        const ids = parseIds(url);
        if (options.rateLimitFirstNodeBatch === true && !rateLimited) {
          rateLimited = true;
          return errJson(
            429,
            { err: "rate limited" },
            {
              "Retry-After": "2",
              "X-Figma-Plan-Tier": "enterprise",
              "X-Figma-Rate-Limit-Type": "file_content",
              "X-Figma-Upgrade-Link": `https://www.figma.com/pricing?token=${FIGMA_TOKEN_PREFIX}header_secret_value_1234567890`,
            },
          );
        }
        if (ids.some((nodeId) => options.failNodeIds?.has(nodeId) === true)) {
          return errJson(503, { err: "transient" });
        }
        if (options.oversizedNodeBatches === true && ids.length > 1) {
          return new Response("x".repeat(2200), { status: 200 });
        }
        return okJson(createNodesResponse(ids));
      }
      if (url.pathname === `/v1/images/${FILE_KEY}`) {
        const ids = parseIds(url);
        if (options.oversizedImageBatches === true && ids.length > 1) {
          return new Response("x".repeat(2200), { status: 200 });
        }
        return okJson(createImagesResponse(ids));
      }
      return errJson(404, { err: "not found" });
    } finally {
      inFlight -= 1;
    }
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    requestedUrls,
    sleeps,
    maxConcurrency: () => maxConcurrency,
  };
};

const parseIds = (url: URL): readonly string[] =>
  (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const createWorkspaceRoot = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ti-figma-staged-import-"));

const importWithMock = async (
  workspaceRoot: string,
  mock: MockFigmaFetch,
  overrides: Partial<Parameters<typeof importStagedFigmaSnapshot>[0]> = {},
) =>
  importStagedFigmaSnapshot({
    workspaceRoot,
    tenantScope: TENANT_SCOPE,
    figmaUrl: FIGMA_URL,
    accessToken: ACCESS_TOKEN,
    fetchImpl: mock.fetchImpl,
    nodeBatchSize: 2,
    imageBatchSize: 2,
    now: () => IMPORT_DATE,
    sleepMs: async (ms) => {
      mock.sleeps.push(ms);
    },
    ...overrides,
  });

const countRequests = (
  mock: MockFigmaFetch,
  matcher: (url: URL) => boolean,
): number =>
  mock.requestedUrls
    .map((rawUrl) => new URL(rawUrl))
    .filter((url) => matcher(url)).length;

const readAllPersistedText = async (root: string): Promise<string> => {
  const parts: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        parts.push(await readFile(path, "utf8"));
      }
    }
  };
  await visit(root);
  return parts.join("\n");
};

void test("staged import completes large boards through bounded REST batches and safe artifacts", async () => {
  const nodeIds = ["1:1", "1:2", "1:3", "1:4", "1:5"];
  const workspaceRoot = await createWorkspaceRoot();
  const mock = createMockFigmaFetch({ nodeIds });

  const result = await importWithMock(workspaceRoot, mock, {
    figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
  });

  assert.equal(result.manifest.importStrategy, "hybrid");
  assert.equal(result.importStatus.lifecycleState, "completed");
  assert.equal(
    result.manifest.artifactDigests.previewManifestDigest,
    result.previewManifest.contentDigest,
  );
  assert.equal(result.previewManifest.previewStatus, "complete");
  assert.ok(result.previewManifest.assets.length > 0);
  assert.equal(
    result.previewManifest.assets.length,
    result.previewManifest.tiles.length,
  );
  assert.equal(result.nodeIndex.nodes.length, nodeIds.length * 2);
  assert.equal(
    result.importStatus.credential?.authMode,
    "personal_access_token",
  );
  assert.equal("tokenHash" in (result.importStatus.credential ?? {}), false);
  assert.equal(
    result.importStatus.budget?.policyVersion,
    "figma-import-budget/v1",
  );
  assert.equal(result.importStatus.budget?.resourceType, "image_metadata");
  assert.equal("tokenResourceKeyHash" in (result.importStatus.budget ?? {}), false);
  assert.ok((result.importStatus.budget?.remainingRequests ?? 0) > 0);
  assert.equal(mock.maxConcurrency(), 1);
  assert.equal(
    countRequests(mock, (url) => url.pathname === `/v1/files/${FILE_KEY}`),
    1,
  );
  assert.equal(
    countRequests(
      mock,
      (url) => url.pathname === `/v1/files/${FILE_KEY}/nodes`,
    ),
    3,
  );
  assert.equal(
    countRequests(mock, (url) => url.pathname === `/v1/images/${FILE_KEY}`),
    3,
  );
  const persisted = await readAllPersistedText(result.vaultPath);
  assert.doesNotMatch(persisted, new RegExp(ACCESS_TOKEN, "u"));
  assert.doesNotMatch(persisted, /https:\/\//u);
  assert.doesNotMatch(persisted, /mailto:/u);
  assert.doesNotMatch(persisted, /customer\.example/u);
  assert.doesNotMatch(persisted, /figd_payload_secret/u);
  assert.match(persisted, /\[URI_REDACTED\]/u);
});

void test("staged import source identity ignores sensitive Figma URL query material", async () => {
  const nodeIds = ["1:1"];
  const cleanWorkspaceRoot = await createWorkspaceRoot();
  const sensitiveWorkspaceRoot = await createWorkspaceRoot();
  const cleanMock = createMockFigmaFetch({ nodeIds });
  const sensitiveMock = createMockFigmaFetch({ nodeIds });

  const clean = await importWithMock(cleanWorkspaceRoot, cleanMock, {
    figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board?node-id=1-1`,
  });
  const sensitive = await importWithMock(sensitiveWorkspaceRoot, sensitiveMock, {
    figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board?node-id=1-1&access_token=private-token&private_share=tenant-secret`,
  });

  assert.equal(sensitive.snapshotId, clean.snapshotId);
  assert.equal(
    sensitive.importStatus.source.sourceUrlHash,
    clean.importStatus.source.sourceUrlHash,
  );
  const persisted = await readAllPersistedText(sensitive.vaultPath);
  assert.doesNotMatch(persisted, /access_token=/u);
  assert.doesNotMatch(persisted, /private_share=/u);
  assert.doesNotMatch(persisted, /private-token/u);
  assert.doesNotMatch(persisted, /tenant-secret/u);
});

void test("staged import honors Retry-After and records sanitized rate-limit metadata", async () => {
  const nodeIds = ["1:1", "1:2"];
  const workspaceRoot = await createWorkspaceRoot();
  const mock = createMockFigmaFetch({
    nodeIds,
    rateLimitFirstNodeBatch: true,
  });

  const result = await importWithMock(workspaceRoot, mock, {
    figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
  });

  assert.deepEqual(mock.sleeps, [2000]);
  assert.equal(result.importStatus.rateLimit.retryAfterSeconds, 2);
  assert.equal("figmaPlanTier" in result.importStatus.rateLimit, false);
  assert.equal("figmaRateLimitType" in result.importStatus.rateLimit, false);
  assert.equal("remediation" in result.importStatus.rateLimit, false);
  assert.equal(result.rateLimitDiagnostics?.figmaPlanTier, "enterprise");
  assert.equal(
    result.rateLimitDiagnostics?.figmaRateLimitType,
    "file_content",
  );
  assert.equal(
    result.rateLimitDiagnostics?.remediation?.scenario,
    "high_limit",
  );
  assert.match(
    result.rateLimitDiagnostics?.remediation?.guidance ?? "",
    /Stagger imports/u,
  );
  assert.match(
    result.rateLimitDiagnostics?.figmaUpgradeLinkDigest ?? "",
    /^[a-f0-9]{64}$/u,
  );
  const persisted = await readAllPersistedText(result.vaultPath);
  assert.doesNotMatch(persisted, /https:\/\/www\.figma\.com\/pricing/u);
  assert.doesNotMatch(persisted, /figd_header_secret/u);
  assert.doesNotMatch(persisted, /enterprise/u);
  assert.doesNotMatch(persisted, /file_content/u);
  assert.equal(
    countRequests(
      mock,
      (url) => url.pathname === `/v1/files/${FILE_KEY}/nodes`,
    ),
    2,
  );
});

void test("staged import refuses locally when per-resource request budget is exhausted", async () => {
  const nodeIds = ["1:1", "1:2", "1:3"];
  const workspaceRoot = await createWorkspaceRoot();
  const mock = createMockFigmaFetch({ nodeIds });

  await assert.rejects(
    () =>
      importWithMock(workspaceRoot, mock, {
        figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
        nodeBatchSize: 1,
        imageBatchSize: 1,
        budgetPolicy: {
          maxRequestsPerWindow: 10,
          resourceMaxRequestsPerWindow: {
            file_bootstrap: 1,
            node_batch: 1,
            image_metadata: 10,
          },
        },
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaStagedImportError);
      assert.equal(err.errorCode, "budget_exhausted");
      assert.equal(err.failureClass, "budget_exhausted");
      assert.equal(err.checkpoint?.failureClass, "budget_exhausted");
      assert.equal(err.checkpoint?.budget?.resourceType, "node_batch");
      assert.equal(err.checkpoint?.budget?.remainingRequests, 0);
      assert.equal(
        "tokenResourceKeyHash" in (err.checkpoint?.budget ?? {}),
        false,
      );
      return true;
    },
  );

  assert.equal(
    countRequests(
      mock,
      (url) => url.pathname === `/v1/files/${FILE_KEY}/nodes`,
    ),
    1,
  );
  const persisted = await readAllPersistedText(workspaceRoot);
  assert.doesNotMatch(persisted, new RegExp(ACCESS_TOKEN, "u"));
  assert.doesNotMatch(persisted, /https:\/\/www\.figma\.com/u);
  assert.match(persisted, /"failureClass":"budget_exhausted"/u);
});

void test("staged import adaptively splits oversized node and image batches", async () => {
  const nodeIds = ["1:1", "1:2", "1:3", "1:4"];
  const workspaceRoot = await createWorkspaceRoot();
  const mock = createMockFigmaFetch({
    nodeIds,
    oversizedNodeBatches: true,
    oversizedImageBatches: true,
  });

  const result = await importWithMock(workspaceRoot, mock, {
    figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
    nodeBatchSize: 4,
    imageBatchSize: 4,
    maxResponseBytes: 2000,
  });

  assert.equal(result.importStatus.lifecycleState, "completed");
  assert.equal(
    countRequests(
      mock,
      (url) =>
        url.pathname === `/v1/files/${FILE_KEY}/nodes` &&
        parseIds(url).length > 1,
    ),
    3,
  );
  assert.equal(
    countRequests(
      mock,
      (url) =>
        url.pathname === `/v1/images/${FILE_KEY}` && parseIds(url).length > 1,
    ),
    3,
  );
  assert.equal(
    countRequests(
      mock,
      (url) =>
        url.pathname === `/v1/files/${FILE_KEY}/nodes` &&
        parseIds(url).length === 1,
    ),
    4,
  );
  assert.equal(
    countRequests(
      mock,
      (url) =>
        url.pathname === `/v1/images/${FILE_KEY}` && parseIds(url).length === 1,
    ),
    4,
  );
});

void test("staged import flattens deep node trees without recursive stack overflow", async () => {
  const workspaceRoot = await createWorkspaceRoot();
  const deepNodeJson = createDeepNodeDocumentJson(3_000);
  const fetchImpl = (async (rawUrl: string) => {
    const url = new URL(rawUrl);
    if (url.pathname === `/v1/files/${FILE_KEY}`) {
      return okJson(createBootstrapFile(["1:1"]));
    }
    if (url.pathname === `/v1/files/${FILE_KEY}/nodes`) {
      return new Response(
        `{"name":"Enterprise Board","lastModified":"2026-05-29T09:00:00Z","version":"version-1","nodes":{"1:1":{"document":${deepNodeJson}}}}`,
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (url.pathname === `/v1/images/${FILE_KEY}`) {
      return okJson(createImagesResponse(["1:1"]));
    }
    return errJson(404, { err: "not found" });
  }) as unknown as typeof fetch;

  const result = await importStagedFigmaSnapshot({
    workspaceRoot,
    tenantScope: TENANT_SCOPE,
    figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
    accessToken: ACCESS_TOKEN,
    fetchImpl,
    now: () => IMPORT_DATE,
  });

  assert.equal(result.importStatus.lifecycleState, "completed");
  assert.equal(result.nodeIndex.nodes.length, 3_001);
  const nodeById = new Map(
    result.nodeIndex.nodes.map((node) => [node.nodeId, node]),
  );
  const deepLeaf = nodeById.get("deep:leaf");
  assert.ok(deepLeaf);
  assert.equal(deepLeaf.parentNodeId, "deep:3000");
  assert.equal(deepLeaf.ancestorNodeIds.length, 128);
  assert.equal(deepLeaf.ancestorNodeIds[0], "deep:2873");
  assert.equal(deepLeaf.ancestorNodeIds.at(-1), "deep:3000");
  assert.ok(deepLeaf.labels.includes("deeply-nested"));

  const reconstructedParentChain: string[] = [];
  let parentNodeId = deepLeaf.parentNodeId;
  while (parentNodeId !== undefined) {
    reconstructedParentChain.push(parentNodeId);
    parentNodeId = nodeById.get(parentNodeId)?.parentNodeId;
  }
  assert.equal(reconstructedParentChain.length, 3_000);
  assert.equal(reconstructedParentChain.at(-1), "deep:1");
});

void test("staged import resumes a safe checkpoint after interruption", async () => {
  const nodeIds = ["1:1", "1:2", "1:3"];
  const workspaceRoot = await createWorkspaceRoot();
  const firstMock = createMockFigmaFetch({
    nodeIds,
    failNodeIds: new Set(["1:2"]),
  });
  let checkpoint: unknown;
  await assert.rejects(
    () =>
      importWithMock(workspaceRoot, firstMock, {
        figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
        nodeBatchSize: 1,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaStagedImportError);
      checkpoint = err.checkpoint;
      return err.errorCode === "figma_fetch_failed" && checkpoint !== undefined;
    },
  );

  const secondMock = createMockFigmaFetch({ nodeIds });
  const resumed = await importWithMock(workspaceRoot, secondMock, {
    figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
    nodeBatchSize: 1,
    checkpoint,
  });

  assert.equal(resumed.importStatus.lifecycleState, "completed");
  assert.ok(
    resumed.reusedChunkIds.some((chunkId) => chunkId.startsWith("node-")),
  );
  const requestedNodeIds = secondMock.requestedUrls
    .map((rawUrl) => new URL(rawUrl))
    .filter((url) => url.pathname === `/v1/files/${FILE_KEY}/nodes`)
    .flatMap(parseIds);
  assert.deepEqual(requestedNodeIds, ["1:2", "1:3"]);
});

void test("staged import reuses unchanged cached chunks on repeated imports", async () => {
  const nodeIds = ["1:1", "1:2"];
  const workspaceRoot = await createWorkspaceRoot();
  const firstMock = createMockFigmaFetch({ nodeIds });
  const first = await importWithMock(workspaceRoot, firstMock, {
    figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
  });
  const secondMock = createMockFigmaFetch({ nodeIds });

  const second = await importWithMock(workspaceRoot, secondMock, {
    figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
  });

  assert.equal(second.snapshotId, first.snapshotId);
  assert.deepEqual(second.previewManifest, first.previewManifest);
  assert.equal(second.reusedChunkIds.length, first.importStatus.chunks.length);
  assert.equal(
    countRequests(
      secondMock,
      (url) => url.pathname === `/v1/files/${FILE_KEY}/nodes`,
    ),
    0,
  );
  assert.equal(
    countRequests(
      secondMock,
      (url) => url.pathname === `/v1/images/${FILE_KEY}`,
    ),
    0,
  );
});

void test("staged import rejects corrupted checkpoints that reference missing chunks", async () => {
  const nodeIds = ["1:1"];
  const workspaceRoot = await createWorkspaceRoot();
  const firstMock = createMockFigmaFetch({ nodeIds });
  const first = await importWithMock(workspaceRoot, firstMock, {
    figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
  });
  const chunkId = first.importStatus.chunks[0]?.chunkId;
  assert.ok(chunkId !== undefined);
  await rm(join(first.vaultPath, ".staging", "chunks", `${chunkId}.json`));
  const secondMock = createMockFigmaFetch({ nodeIds });

  await assert.rejects(
    () =>
      importWithMock(workspaceRoot, secondMock, {
        figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
        checkpoint: first.importStatus,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaStagedImportError);
      assert.equal(err.errorCode, "checkpoint_rejected");
      assert.doesNotMatch(err.message, /figd_/u);
      assert.doesNotMatch(err.message, /https:\/\//u);
      return true;
    },
  );
});

void test("staged import rejects unsafe checkpoints with sanitized diagnostics", async () => {
  const nodeIds = ["1:1"];
  const workspaceRoot = await createWorkspaceRoot();
  const mock = createMockFigmaFetch({ nodeIds });
  const unsafeCheckpoint = {
    schemaVersion: "1.0.0",
    snapshotId: "snap-unsafe",
    tenantScope: TENANT_SCOPE,
    source: {
      fileKeyHash:
        "1111111111111111111111111111111111111111111111111111111111111111",
      sourceUrlHash:
        "2222222222222222222222222222222222222222222222222222222222222222",
      nodeId: `https://customer.example/private?token=${FIGMA_TOKEN_PREFIX}secret_secret_secret`,
    },
    lifecycleState: "fetching",
    retry: { attempt: 0, maxAttempts: 2 },
    rateLimit: {},
    chunks: [],
    checkpoint: { completedChunkIds: [] },
    contentDigest:
      "0000000000000000000000000000000000000000000000000000000000000000",
  };

  await assert.rejects(
    () =>
      importWithMock(workspaceRoot, mock, {
        figmaUrl: `https://www.figma.com/design/${FILE_KEY}/Customer-Board`,
        checkpoint: unsafeCheckpoint,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaStagedImportError);
      assert.equal(err.errorCode, "checkpoint_rejected");
      assert.doesNotMatch(err.message, /https:\/\/customer\.example/u);
      assert.doesNotMatch(err.message, /figd_secret/u);
      return true;
    },
  );
});

void test("staged import rejects token-shaped explicit nodeId before checkpoint persistence", async () => {
  const workspaceRoot = await createWorkspaceRoot();
  const mock = createMockFigmaFetch({ nodeIds: ["1:1"] });
  const secretLikeNodeId = `${FIGMA_TOKEN_PREFIX}supersecret_source_node_value_1234567890`;

  await assert.rejects(
    () =>
      importWithMock(workspaceRoot, mock, {
        figmaUrl: undefined,
        fileKey: FILE_KEY,
        nodeId: secretLikeNodeId,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaStagedImportError);
      assert.equal(err.errorCode, "figma_fetch_failed");
      assert.doesNotMatch(err.message, /figd_supersecret/u);
      return true;
    },
  );

  assert.equal(mock.requestedUrls.length, 0);
  const persisted = await readAllPersistedText(workspaceRoot);
  assert.doesNotMatch(persisted, /figd_supersecret/u);
});
