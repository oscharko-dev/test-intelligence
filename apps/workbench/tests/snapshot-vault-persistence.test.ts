// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  artifactAbsolutePath,
  resolveWorkbenchStoragePaths,
  verifyArtifact,
} from "@/lib/server/storage";
import {
  getWorkbenchStorage,
  resetWorkbenchStorageForTests,
} from "@/lib/server/storage/bootstrap";
import {
  getWorkbenchSnapshotDetail,
  getWorkbenchSnapshotImportCompletionForTests,
  getWorkbenchSnapshotImportJob,
  listWorkbenchSnapshots,
  resetWorkbenchSnapshotImportStoreForTests,
  startWorkbenchSnapshotImport,
} from "@/lib/server/workbench-snapshot-vault";

// The import harness mirrors `snapshot-vault-server.test.ts`: a deterministic
// Figma REST double lets the real engine stage a snapshot to disk, exercising
// the production persistence wiring end-to-end (no engine mock).
const createBootstrapFile = (nodeIds: readonly string[]): unknown => ({
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

const createNodesResponse = (nodeIds: readonly string[]): unknown => ({
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

const createImagesResponse = (nodeIds: readonly string[]): unknown => ({
  images: Object.fromEntries(
    nodeIds.map((nodeId) => [
      nodeId,
      `https://figma-alpha-api.s3.us-west-2.amazonaws.com/${nodeId.replace(/:/gu, "_")}.png`,
    ]),
  ),
});

const createFigmaFetch = (nodeIds: readonly string[]): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
    if (url.pathname === "/v1/files/ABC") {
      return Response.json(createBootstrapFile(nodeIds));
    }
    if (url.pathname === "/v1/files/ABC/nodes") {
      return Response.json(createNodesResponse(ids));
    }
    if (url.pathname === "/v1/images/ABC") {
      return Response.json(createImagesResponse(ids));
    }
    return Response.json({ err: "unexpected request" }, { status: 500 });
  }) as typeof fetch;

// WHY a unique token per import: the engine's import budget is a process-global
// window keyed by the access token, so reusing one token across the cases in
// this file would exhaust the `file_bootstrap` budget after a few imports. A
// distinct token per import gives each its own fresh budget window, isolating
// the cases exactly as separate real credentials would be.
let tokenCounter = 0;
const nextToken = (): string =>
  `figd_persistence_fixture_token_${(tokenCounter += 1)
    .toString()
    .padStart(10, "0")}`;

const envFor = (
  repoRoot: string,
  overrides?: Record<string, string>,
): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  WORKBENCH_REPO_ROOT: repoRoot,
  TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN: nextToken(),
  ...overrides,
});

const importSnapshot = async (env: NodeJS.ProcessEnv): Promise<string> => {
  const queued = await startWorkbenchSnapshotImport({
    body: {
      action: "import",
      figmaUrl: "https://www.figma.com/design/ABC/CustomerBoard?node-id=1-2",
    },
    env,
    fetchImpl: createFigmaFetch(["1:1", "1:2"]),
  });
  await getWorkbenchSnapshotImportCompletionForTests(queued.jobId);
  const job = getWorkbenchSnapshotImportJob(queued.jobId, env);
  expect(job?.status).toBe("completed");
  const snapshotId = job?.snapshotId;
  if (snapshotId === undefined)
    throw new Error("import did not yield a snapshotId");
  return snapshotId;
};

describe("Workbench snapshot persistence (Issue #53)", () => {
  let repoRoot: string;
  let previousRepoRoot: string | undefined;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(os.tmpdir(), "ti-snapshot-persist-"));
    // WHY set process.env BEFORE the first getWorkbenchStorage(): the storage
    // singleton bootstraps lazily from process.env, so the adapter and the
    // content store must share this temp WORKBENCH_REPO_ROOT.
    previousRepoRoot = process.env.WORKBENCH_REPO_ROOT;
    process.env.WORKBENCH_REPO_ROOT = repoRoot;
    resetWorkbenchStorageForTests();
  });

  afterEach(async () => {
    resetWorkbenchSnapshotImportStoreForTests();
    resetWorkbenchStorageForTests();
    if (previousRepoRoot === undefined) {
      delete process.env.WORKBENCH_REPO_ROOT;
    } else {
      process.env.WORKBENCH_REPO_ROOT = previousRepoRoot;
    }
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("persists a SnapshotMetadataRecord with a verifiable node-index ContentRef on import", async () => {
    const env = envFor(repoRoot);
    const snapshotId = await importSnapshot(env);

    const records = getWorkbenchStorage().snapshots.list();
    expect(records).toHaveLength(1);
    const record = records[0];
    // Engine snapshotId is reconciled via the `source` field.
    expect(record?.source).toBe(snapshotId);
    expect(record?.lifecycleState).toBe("completed");
    expect(record?.nodeCount).toBeGreaterThan(0);

    const payload = record?.payload;
    expect(payload).toBeDefined();
    if (payload === undefined)
      throw new Error("expected a persisted payload ref");
    const paths = resolveWorkbenchStoragePaths(env);
    expect(verifyArtifact(paths, payload).checksumValid).toBe(true);
  });

  it("keeps the snapshot listed and inspectable after a storage restart (AC#1)", async () => {
    const env = envFor(repoRoot);
    const snapshotId = await importSnapshot(env);

    // Simulate a process restart: drop the in-memory singleton. The on-disk
    // SQLite file and content store persist on the temp root.
    resetWorkbenchStorageForTests();

    const catalog = await listWorkbenchSnapshots(env);
    const row = catalog.find((entry) => entry.snapshotId === snapshotId);
    expect(row).toBeDefined();
    // Read-back proves the SQLite record was rebuilt from disk AND its persisted
    // node-index reference still verifies through the content store.
    expect(row?.persistedNodeIndex?.status).toBe("verified");

    const detail = await getWorkbenchSnapshotDetail(snapshotId, env);
    expect(detail.snapshot.snapshotId).toBe(snapshotId);
    expect(detail.pages.length).toBeGreaterThan(0);

    // The durable record itself survived the restart.
    const persisted = getWorkbenchStorage().snapshots.list();
    expect(persisted.map((r) => r.source)).toContain(snapshotId);
  });

  it("surfaces a persisted-only snapshot after disk eviction and restart", async () => {
    const env = envFor(repoRoot);
    const snapshotId = await importSnapshot(env);

    // Evict the disk vault but keep the durable SQLite index + content store.
    await rm(path.join(repoRoot, ".test-intelligence", "figma-snapshots"), {
      recursive: true,
      force: true,
    });
    resetWorkbenchStorageForTests();

    const catalog = await listWorkbenchSnapshots(env);
    const row = catalog.find((entry) => entry.snapshotId === snapshotId);
    // The synthesized row proves SQLite is a real durable index, not a disk
    // passthrough; its node-index payload still verifies from the content store.
    expect(row).toBeDefined();
    expect(row?.persistedNodeIndex?.status).toBe("verified");
    expect(row?.nodeCount).toBeGreaterThan(0);
  });

  it("reports a missing persisted node-index payload as unverified without throwing", async () => {
    const env = envFor(repoRoot);
    const snapshotId = await importSnapshot(env);
    const record = getWorkbenchStorage().snapshots.list()[0];
    const payload = record?.payload;
    if (payload === undefined)
      throw new Error("expected a persisted payload ref");

    // Delete the content-store .bin backing the node-index reference.
    const paths = resolveWorkbenchStoragePaths(env);
    await rm(artifactAbsolutePath(paths, payload.sha256), { force: true });
    resetWorkbenchStorageForTests();

    const catalog = await listWorkbenchSnapshots(env);
    const row = catalog.find((entry) => entry.snapshotId === snapshotId);
    expect(row).toBeDefined();
    expect(row?.persistedNodeIndex?.status).toBe("unverified");
  });

  it("does not leak a persisted snapshot across tenant scopes", async () => {
    const envA = envFor(repoRoot, {
      TEST_INTELLIGENCE_TENANT_ID: "tenant-a",
      TEST_INTELLIGENCE_ENVIRONMENT_ID: "qa",
      TEST_INTELLIGENCE_PROJECT_ID: "claims",
    });
    const envB = envFor(repoRoot, {
      TEST_INTELLIGENCE_TENANT_ID: "tenant-b",
      TEST_INTELLIGENCE_ENVIRONMENT_ID: "qa",
      TEST_INTELLIGENCE_PROJECT_ID: "claims",
    });
    const snapshotId = await importSnapshot(envA);

    // Evict disk so the catalog can only surface the durable SQLite index, then
    // list under a different tenant: the persisted-only row MUST be filtered by
    // tenant scope and not bleed into tenant B's catalog.
    await rm(path.join(repoRoot, ".test-intelligence", "figma-snapshots"), {
      recursive: true,
      force: true,
    });
    resetWorkbenchStorageForTests();

    const tenantBCatalog = await listWorkbenchSnapshots(envB);
    expect(
      tenantBCatalog.some((entry) => entry.snapshotId === snapshotId),
    ).toBe(false);

    const tenantACatalog = await listWorkbenchSnapshots(envA);
    expect(
      tenantACatalog.some((entry) => entry.snapshotId === snapshotId),
    ).toBe(true);
  });
});
