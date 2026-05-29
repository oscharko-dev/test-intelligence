import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION,
  FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
  FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION,
  type FigmaSnapshotImportStatus,
  type FigmaSnapshotManifest,
  type FigmaSnapshotNodeIndex,
  type FigmaSnapshotNodeRecord,
  type TenantScope,
} from "@oscharko-dev/ti-contracts";
import {
  computeFigmaSnapshotArtifactDigest,
  serializeFigmaSnapshotArtifact,
} from "@oscharko-dev/ti-core-engine";
import { resolveTenantScopeSegments } from "@oscharko-dev/ti-tenant";

import {
  FigmaSnapshotRunSourceError,
  resolveFigmaSnapshotRunSource,
} from "./figma-snapshot-run-source.js";

const TENANT_SCOPE = {
  tenantId: "tenant-acme",
  environmentId: "prod",
  projectId: "claims-modernization",
} as const satisfies TenantScope;

const OTHER_TENANT_SCOPE = {
  tenantId: "tenant-rival",
  environmentId: "prod",
  projectId: "claims-modernization",
} as const satisfies TenantScope;

const SOURCE = {
  fileKeyHash: "a".repeat(64),
  sourceUrlHash: "b".repeat(64),
} as const;

const SNAPSHOT_ID = "snapshot-20260529";

const snapshotPath = (root: string, scope: TenantScope): string => {
  const [tenantId, environmentId, projectId] =
    resolveTenantScopeSegments(scope);
  return path.join(
    root,
    ".test-intelligence",
    "figma-snapshots",
    tenantId,
    environmentId,
    projectId,
    SOURCE.fileKeyHash,
    SNAPSHOT_ID,
  );
};

const withDigest = <T extends Record<string, unknown>>(
  value: T,
): T & { contentDigest: string } => ({
  ...value,
  contentDigest: computeFigmaSnapshotArtifactDigest({
    ...value,
    contentDigest: "0".repeat(64),
  }),
});

const nodeRecord = (
  overrides: Partial<FigmaSnapshotNodeRecord>,
): FigmaSnapshotNodeRecord => ({
  pageId: "page-1",
  pageName: "Claims Intake",
  frameId: "frame-1",
  frameName: "FNOL",
  nodeId: "node-field",
  nodeName: "Claim Number",
  nodeType: "TEXT_FIELD",
  parentNodeId: "frame-1",
  ancestorNodeIds: ["page-1", "frame-1"],
  bbox: { x: 10, y: 20, width: 180, height: 36 },
  labels: ["Claim Number"],
  textSnippet: "Claim Number",
  componentHints: ["control:text-entry"],
  visible: true,
  sourceChunkRefs: [{ chunkId: "chunk-01" }],
  ...overrides,
});

const writeSnapshotVault = async (input: {
  readonly root: string;
  readonly tenantScope?: TenantScope;
  readonly manifestTenantScope?: TenantScope;
  readonly nodes?: readonly FigmaSnapshotNodeRecord[];
  readonly statusState?: FigmaSnapshotImportStatus["lifecycleState"];
  readonly manifestDigestOverride?: Partial<
    FigmaSnapshotManifest["artifactDigests"]
  >;
}): Promise<{
  manifest: FigmaSnapshotManifest;
  nodeIndex: FigmaSnapshotNodeIndex;
  importStatus: FigmaSnapshotImportStatus;
}> => {
  const tenantScope = input.tenantScope ?? TENANT_SCOPE;
  const artifactScope = input.manifestTenantScope ?? tenantScope;
  const nodes =
    input.nodes ??
    [
      nodeRecord({}),
      nodeRecord({
        frameId: "frame-2",
        frameName: "Review",
        nodeId: "node-submit",
        nodeName: "Submit Claim",
        nodeType: "BUTTON",
        labels: ["Submit"],
        textSnippet: "Submit",
        componentHints: ["primary-action"],
      }),
    ];
  const nodeIndex = withDigest({
    schemaVersion: FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION,
    snapshotId: SNAPSHOT_ID,
    tenantScope: artifactScope,
    source: SOURCE,
    nodes,
  }) satisfies FigmaSnapshotNodeIndex;
  const importStatus = withDigest({
    schemaVersion: FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION,
    snapshotId: SNAPSHOT_ID,
    tenantScope: artifactScope,
    source: SOURCE,
    lifecycleState: input.statusState ?? "completed",
    retry: { attempt: 1, maxAttempts: 3 },
    rateLimit: {},
    chunks: [
      {
        chunkId: "chunk-01",
        state: "completed" as const,
        nodeCount: nodes.length,
        contentDigest: "c".repeat(64),
      },
    ],
    checkpoint: {
      lastSuccessfulPhase: input.statusState ?? "completed",
      completedChunkIds: ["chunk-01"],
    },
  }) satisfies FigmaSnapshotImportStatus;
  const manifest = withDigest({
    schemaVersion: FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
    snapshotId: SNAPSHOT_ID,
    tenantScope: artifactScope,
    source: SOURCE,
    importStrategy: "rest_nodes" as const,
    importedAt: "2026-05-29T06:15:00.000Z",
    artifactDigests: {
      nodeIndexDigest: nodeIndex.contentDigest,
      importStatusDigest: importStatus.contentDigest,
      ...input.manifestDigestOverride,
    },
  }) satisfies FigmaSnapshotManifest;

  const vaultPath = snapshotPath(input.root, tenantScope);
  await mkdir(vaultPath, { recursive: true });
  await writeFile(
    path.join(vaultPath, "manifest.json"),
    serializeFigmaSnapshotArtifact(manifest),
    "utf8",
  );
  await writeFile(
    path.join(vaultPath, "node-index.json"),
    serializeFigmaSnapshotArtifact(nodeIndex),
    "utf8",
  );
  await writeFile(
    path.join(vaultPath, "import-status.json"),
    serializeFigmaSnapshotArtifact(importStatus),
    "utf8",
  );
  return { manifest, nodeIndex, importStatus };
};

void test("resolveFigmaSnapshotRunSource: builds local intent and trace anchors for scoped snapshot selection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ti-snapshot-run-"));
  try {
    const { nodeIndex } = await writeSnapshotVault({ root });

    const resolved = await resolveFigmaSnapshotRunSource({
      workspaceRoot: root,
      tenantScope: TENANT_SCOPE,
      snapshotId: SNAPSHOT_ID,
      selection: { frameIds: ["frame-1"] },
    });

    assert.equal(resolved.manifest.snapshotId, SNAPSHOT_ID);
    assert.equal(resolved.nodeIndex.contentDigest, nodeIndex.contentDigest);
    assert.deepEqual(resolved.auditRef.selectedFrameIds, ["frame-1"]);
    assert.deepEqual(resolved.auditRef.selectedNodeIds, ["node-field"]);
    assert.equal(resolved.intentInput.source.kind, "hybrid");
    assert.equal(resolved.intentInput.screens.length, 1);
    assert.equal(resolved.intentInput.screens[0]?.screenId, "frame-1");
    assert.equal(resolved.intentInput.screens[0]?.nodes[0]?.nodeId, "node-field");
    assert.deepEqual(resolved.traceAnchors, [
      {
        screenId: "frame-1",
        nodeId: "node-field",
        nodeName: "Claim Number",
        nodePath: "Claims Intake / FNOL / Claim Number",
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("resolveFigmaSnapshotRunSource: scope digest changes when selected local scope changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ti-snapshot-run-"));
  try {
    await writeSnapshotVault({ root });
    const frameOne = await resolveFigmaSnapshotRunSource({
      workspaceRoot: root,
      tenantScope: TENANT_SCOPE,
      snapshotId: SNAPSHOT_ID,
      selection: { frameIds: ["frame-1"] },
    });
    const frameTwo = await resolveFigmaSnapshotRunSource({
      workspaceRoot: root,
      tenantScope: TENANT_SCOPE,
      snapshotId: SNAPSHOT_ID,
      selection: { frameIds: ["frame-2"] },
    });

    assert.notEqual(
      frameOne.auditRef.scopeDigest,
      frameTwo.auditRef.scopeDigest,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("resolveFigmaSnapshotRunSource: excludes hidden and sentinel nodes while normalizing snapshot text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ti-snapshot-run-"));
  try {
    await writeSnapshotVault({
      root,
      nodes: [
        nodeRecord({
          nodeId: "node-safe",
          nodeName: "Claim\u200B Number",
          textSnippet: "Claim\u200B Number",
          labels: ["Claim\u200B Number"],
        }),
        nodeRecord({
          nodeId: "node-hidden",
          nodeName: "Hidden Claim Number",
          visible: false,
        }),
        nodeRecord({
          nodeId: "node-sentinel",
          nodeName: "__system",
        }),
      ],
    });

    const resolved = await resolveFigmaSnapshotRunSource({
      workspaceRoot: root,
      tenantScope: TENANT_SCOPE,
      snapshotId: SNAPSHOT_ID,
      selection: { frameIds: ["frame-1"] },
    });

    const intentJson = JSON.stringify(resolved.intentInput);
    assert.deepEqual(resolved.auditRef.selectedNodeIds, ["node-safe"]);
    assert.equal(intentJson.includes("node-hidden"), false);
    assert.equal(intentJson.includes("node-sentinel"), false);
    assert.equal(intentJson.includes("\u200B"), false);
    assert.equal(intentJson.includes("Claim Number"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("resolveFigmaSnapshotRunSource: unsafe, missing, invalid, and cross-tenant snapshots fail closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ti-snapshot-run-"));
  try {
    await writeSnapshotVault({ root });

    await assert.rejects(
      () =>
        resolveFigmaSnapshotRunSource({
          workspaceRoot: root,
          tenantScope: TENANT_SCOPE,
          snapshotId: "../escape",
        }),
      (err: unknown) =>
        err instanceof FigmaSnapshotRunSourceError &&
        err.errorCode === "unsafe_path",
    );
    await assert.rejects(
      () =>
        resolveFigmaSnapshotRunSource({
          workspaceRoot: root,
          tenantScope: TENANT_SCOPE,
          snapshotId: "missing-snapshot",
        }),
      (err: unknown) =>
        err instanceof FigmaSnapshotRunSourceError &&
        err.errorCode === "missing_snapshot",
    );

    const invalidRoot = await mkdtemp(path.join(os.tmpdir(), "ti-snapshot-run-"));
    try {
      await writeSnapshotVault({
        root: invalidRoot,
        manifestDigestOverride: { nodeIndexDigest: "9".repeat(64) },
      });
      await assert.rejects(
        () =>
          resolveFigmaSnapshotRunSource({
            workspaceRoot: invalidRoot,
            tenantScope: TENANT_SCOPE,
            snapshotId: SNAPSHOT_ID,
          }),
        (err: unknown) =>
          err instanceof FigmaSnapshotRunSourceError &&
          err.errorCode === "invalid_snapshot",
      );
    } finally {
      await rm(invalidRoot, { recursive: true, force: true });
    }

    const crossTenantRoot = await mkdtemp(
      path.join(os.tmpdir(), "ti-snapshot-run-"),
    );
    try {
      await writeSnapshotVault({
        root: crossTenantRoot,
        manifestTenantScope: OTHER_TENANT_SCOPE,
      });
      await assert.rejects(
        () =>
          resolveFigmaSnapshotRunSource({
            workspaceRoot: crossTenantRoot,
            tenantScope: TENANT_SCOPE,
            snapshotId: SNAPSHOT_ID,
          }),
        (err: unknown) =>
          err instanceof FigmaSnapshotRunSourceError &&
          err.errorCode === "cross_tenant_snapshot",
      );
    } finally {
      await rm(crossTenantRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("resolveFigmaSnapshotRunSource: rejects snapshot artifact symlink escapes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ti-snapshot-run-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "ti-snapshot-outside-"));
  try {
    const { nodeIndex } = await writeSnapshotVault({ root });
    const externalNodeIndexPath = path.join(outsideRoot, "node-index.json");
    await writeFile(
      externalNodeIndexPath,
      serializeFigmaSnapshotArtifact(nodeIndex),
      "utf8",
    );
    const vaultPath = snapshotPath(root, TENANT_SCOPE);
    const localNodeIndexPath = path.join(vaultPath, "node-index.json");
    await rm(localNodeIndexPath, { force: true });
    await symlink(externalNodeIndexPath, localNodeIndexPath);

    await assert.rejects(
      () =>
        resolveFigmaSnapshotRunSource({
          workspaceRoot: root,
          tenantScope: TENANT_SCOPE,
          snapshotId: SNAPSHOT_ID,
        }),
      (err: unknown) =>
        err instanceof FigmaSnapshotRunSourceError &&
        err.errorCode === "unsafe_path",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
