import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
  type FigmaSnapshotManifest,
  type FigmaSnapshotNodeIndex,
  type FigmaSnapshotNodeRecord,
  type TenantScope,
} from "@oscharko-dev/ti-contracts";
import { sha256Hex } from "@oscharko-dev/ti-security";

import {
  attachFigmaSnapshotPreviewManifestDigest,
  buildFigmaSnapshotLocalNodeIndex,
  FigmaSnapshotExplorerError,
  planFigmaSnapshotPreviewCache,
  queryFigmaSnapshotNodeIndex,
  writeFigmaSnapshotPreviewCacheAssets,
  writeFigmaSnapshotPreviewCacheManifest,
} from "./figma-snapshot-explorer.js";
import {
  computeFigmaSnapshotArtifactDigest,
  validateFigmaSnapshotManifest,
  validateFigmaSnapshotPreviewManifest,
} from "./figma-snapshot-vault.js";

const TENANT_SCOPE: TenantScope = {
  tenantId: "tenant-bank",
  environmentId: "dev",
  projectId: "claims-modernization",
};
const SOURCE = {
  fileKeyHash: "a".repeat(64),
  sourceUrlHash: "b".repeat(64),
  nodeId: "1:1",
} as const;
const SNAPSHOT_ID = "snap-local-index";
const ZERO_DIGEST = "0".repeat(64);
const FIGMA_TOKEN_PREFIX = "figd" + "_";

const createRecord = (
  overrides: Partial<FigmaSnapshotNodeRecord>,
): FigmaSnapshotNodeRecord => ({
  pageId: "page:1",
  pageName: "Retail Banking Antrag",
  frameId: "frame:payment",
  frameName: "Payment Frame",
  nodeId: "node:default",
  nodeName: "Default Node",
  nodeType: "FRAME",
  ancestorNodeIds: ["page:1"],
  bbox: { x: 0, y: 0, width: 320, height: 200 },
  labels: [],
  componentHints: [],
  visible: true,
  sourceChunkRefs: [{ chunkId: "node-chunk-1" }],
  ...overrides,
});

const createMixedRecords = (): readonly FigmaSnapshotNodeRecord[] => [
  createRecord({
    nodeId: "field:iban",
    nodeName: "IBAN Eingabe",
    nodeType: "TEXT_FIELD",
    textSnippet: "IBAN",
    componentHints: ["ds-input"],
    bbox: { x: 10, y: 20, width: 240, height: 32 },
  }),
  createRecord({
    nodeId: "action:submit",
    nodeName: "Antrag stellen",
    nodeType: "INSTANCE",
    textSnippet: "Antrag stellen",
    componentHints: ["button-primary"],
    bbox: { x: 10, y: 80, width: 180, height: 44 },
  }),
  createRecord({
    nodeId: "hidden:one",
    nodeName: "Policy Number",
    nodeType: "TEXT",
    textSnippet: "Policy Number",
    visible: false,
    bbox: { x: 10, y: 140, width: 180, height: 24 },
  }),
  createRecord({
    nodeId: "hidden:two",
    nodeName: "Policy Number",
    nodeType: "TEXT",
    textSnippet: "Policy Number",
    visible: false,
    bbox: { x: 210, y: 140, width: 180, height: 24 },
  }),
  createRecord({
    nodeId: "off:canvas",
    nodeName: "Approval Drawer",
    nodeType: "FRAME",
    bbox: { x: -900, y: 10, width: 80, height: 80 },
  }),
  createRecord({
    nodeId: "claim:description",
    nodeName: "Schadensfall Beschreibung",
    nodeType: "TEXTAREA",
    textSnippet: "Schaden Beschreibung",
    bbox: undefined,
  }),
  createRecord({
    nodeId: "deep:leaf",
    nodeName: "Deep Beneficiary Leaf",
    nodeType: "TEXT",
    textSnippet: "Bezugsberechtigter",
    ancestorNodeIds: Array.from({ length: 1_500 }, (_, index) => `deep:${index}`),
    bbox: { x: 20, y: 220, width: 180, height: 24 },
  }),
];

const buildIndex = (
  records: readonly FigmaSnapshotNodeRecord[] = createMixedRecords(),
): FigmaSnapshotNodeIndex =>
  buildFigmaSnapshotLocalNodeIndex({
    snapshotId: SNAPSHOT_ID,
    tenantScope: TENANT_SCOPE,
    source: SOURCE,
    records,
  });

const createManifest = (nodeIndex: FigmaSnapshotNodeIndex): FigmaSnapshotManifest =>
  withDigest<FigmaSnapshotManifest>({
    schemaVersion: FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
    snapshotId: nodeIndex.snapshotId,
    tenantScope: nodeIndex.tenantScope,
    source: nodeIndex.source,
    importStrategy: "hybrid",
    figmaVersion: "version-1",
    figmaLastModified: "2026-05-29T09:00:00.000Z",
    importedAt: "2026-05-29T10:00:00.000Z",
    artifactDigests: {
      nodeIndexDigest: nodeIndex.contentDigest,
      importStatusDigest: "c".repeat(64),
    },
  });

void test("figma snapshot explorer: builds a deterministic searchable local node index", () => {
  const left = buildIndex(createMixedRecords());
  const right = buildIndex([...createMixedRecords()].reverse());

  assert.equal(JSON.stringify(left), JSON.stringify(right));
  assert.deepEqual(
    left.nodes.map((node) => node.nodeId),
    [
      "action:submit",
      "claim:description",
      "deep:leaf",
      "field:iban",
      "hidden:one",
      "hidden:two",
      "off:canvas",
    ],
  );

  const hidden = left.nodes.filter((node) => node.labels.includes("duplicate-label"));
  assert.deepEqual(
    hidden.map((node) => node.nodeId),
    ["hidden:one", "hidden:two"],
  );
  assert.equal(
    left.nodes.find((node) => node.nodeId === "off:canvas")?.labels.includes("off-canvas"),
    true,
  );
  assert.equal(
    left.nodes
      .find((node) => node.nodeId === "claim:description")
      ?.labels.includes("missing-bounds"),
    true,
  );
  assert.equal(
    left.nodes.find((node) => node.nodeId === "deep:leaf")?.ancestorNodeIds.length,
    1_500,
  );
});

void test("figma snapshot explorer: freezes validated artifacts before caching", () => {
  const index = buildIndex();
  const firstNode = index.nodes[0];
  assert.ok(firstNode);

  assert.equal(Object.isFrozen(index), true);
  assert.equal(Object.isFrozen(index.nodes), true);
  assert.equal(Object.isFrozen(firstNode), true);
  assert.equal(Object.isFrozen(firstNode.labels), true);
  assert.throws(
    () => {
      (firstNode.labels as string[]).push("https://customer.example/mutated");
    },
    TypeError,
  );
});

void test("figma snapshot explorer: queries local snapshots without live Figma REST", () => {
  const index = buildIndex();

  assert.equal(
    queryFigmaSnapshotNodeIndex({
      nodeIndex: index,
      kind: "node_id",
      query: "field:iban",
    })[0]?.nodeId,
    "field:iban",
  );
  assert.deepEqual(
    queryFigmaSnapshotNodeIndex({
      nodeIndex: index,
      kind: "label",
      query: "Policy Number",
    }).map((hit) => hit.nodeId),
    ["hidden:one", "hidden:two"],
  );
  assert.equal(
    queryFigmaSnapshotNodeIndex({
      nodeIndex: index,
      kind: "page_frame",
      query: "Payment Frame",
    })[0]?.frameName,
    "Payment Frame",
  );
  assert.equal(
    queryFigmaSnapshotNodeIndex({
      nodeIndex: index,
      kind: "component",
      query: "button",
    })[0]?.nodeId,
    "action:submit",
  );
  assert.equal(
    queryFigmaSnapshotNodeIndex({
      nodeIndex: index,
      kind: "field_action",
      query: "submit",
    })[0]?.nodeId,
    "action:submit",
  );
  assert.equal(
    queryFigmaSnapshotNodeIndex({
      nodeIndex: index,
      kind: "domain_term",
      query: "IBAN",
    })[0]?.nodeId,
    "field:iban",
  );
  assert.equal(
    queryFigmaSnapshotNodeIndex({
      nodeIndex: index,
      kind: "domain_term",
      query: "Schaden",
    })[0]?.nodeId,
    "claim:description",
  );
  assert.throws(
    () =>
      queryFigmaSnapshotNodeIndex({
        nodeIndex: index,
        kind: "unsupported" as never,
        query: "IBAN",
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaSnapshotExplorerError);
      assert.equal(err.errorCode, "invalid_query");
      return true;
    },
  );
});

void test("figma snapshot explorer: preserves design-system-heavy component hints for local lookup", () => {
  const index = buildIndex([
    createRecord({
      nodeId: "ds:button:primary",
      nodeName: "DS Button Primary",
      nodeType: "INSTANCE",
      componentHints: [
        "ds/button",
        "ds/button",
        "variant:primary",
        "control:button",
      ],
      textSnippet: "Continue",
    }),
    createRecord({
      nodeId: "ds:card:summary",
      nodeName: "DS Account Summary Card",
      nodeType: "COMPONENT",
      componentHints: ["ds/card", "variant:summary", "banking-component"],
      textSnippet: "Konto summary",
    }),
  ]);

  assert.deepEqual(
    index.nodes.find((node) => node.nodeId === "ds:button:primary")?.componentHints,
    [
      "action:continue",
      "control:button",
      "ds/button",
      "type:instance",
      "variant:primary",
    ],
  );
  assert.equal(
    queryFigmaSnapshotNodeIndex({
      nodeIndex: index,
      kind: "component",
      query: "ds/card",
    })[0]?.nodeId,
    "ds:card:summary",
  );
  assert.equal(
    queryFigmaSnapshotNodeIndex({
      nodeIndex: index,
      kind: "domain_term",
      query: "Konto",
    })[0]?.nodeId,
    "ds:card:summary",
  );
});

void test("figma snapshot explorer: plans bounded hash-addressed preview metadata", () => {
  const index = buildIndex();
  const preview = planFigmaSnapshotPreviewCache({
    nodeIndex: index,
    maxTiles: 2,
    tileWidth: 100,
    tileHeight: 50,
  });
  const again = planFigmaSnapshotPreviewCache({
    nodeIndex: index,
    maxTiles: 2,
    tileWidth: 100,
    tileHeight: 50,
  });

  assert.deepEqual(preview, again);
  assert.equal(preview.previewStatus, "complete");
  assert.equal(preview.boundedPreview, true);
  assert.equal(preview.assets.length, 2);
  assert.equal(preview.tiles.length, 2);
  for (const asset of preview.assets) {
    assert.match(asset.assetId, /^asset-[a-f0-9]{32}$/u);
    assert.match(asset.relativePath, /^previews\/asset-[a-f0-9]{32}\.preview-plan\.json$/u);
    assert.equal(
      asset.mediaType,
      "application/vnd.test-intelligence.figma-preview-plan+json",
    );
    assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(asset.byteLength > 0);
    assert.ok(asset.width <= 100);
    assert.ok(asset.height <= 50);
    assert.doesNotMatch(asset.relativePath, /https?:\/\//u);
  }
  validateFigmaSnapshotPreviewManifest(preview);
});

void test("figma snapshot explorer: keeps large synthetic indexes searchable with bounded preview metadata", () => {
  const records = Array.from({ length: 2_500 }, (_, index) =>
    createRecord({
      nodeId: `large:${index.toString().padStart(4, "0")}`,
      nodeName: index % 10 === 0 ? `IBAN Row ${index}` : `Customer Row ${index}`,
      nodeType: index % 5 === 0 ? "TEXT_FIELD" : "FRAME",
      textSnippet: index % 10 === 0 ? "IBAN" : `Customer ${index}`,
      bbox: { x: index % 100, y: index, width: 240, height: 32 },
      ancestorNodeIds: ["page:1", `section:${Math.floor(index / 100)}`],
    }),
  );
  const index = buildIndex(records);

  assert.equal(index.nodes.length, 2_500);
  assert.equal(
    queryFigmaSnapshotNodeIndex({
      nodeIndex: index,
      kind: "domain_term",
      query: "IBAN",
      limit: 5,
    }).length,
    5,
  );
  const preview = planFigmaSnapshotPreviewCache({
    nodeIndex: index,
    maxTiles: 25,
  });
  assert.equal(preview.assets.length, 25);
  assert.equal(preview.tiles.length, 25);
  assert.equal(preview.boundedPreview, true);
});

void test("figma snapshot explorer: attaches and writes preview manifests consistently with the snapshot manifest", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ti-figma-snapshot-explorer-"));
  try {
    const index = buildIndex();
    const manifest = createManifest(index);
    const preview = planFigmaSnapshotPreviewCache({ nodeIndex: index, maxTiles: 4 });
    const updatedManifest = attachFigmaSnapshotPreviewManifestDigest({
      manifest,
      previewManifest: preview,
    });
    assert.equal(
      updatedManifest.artifactDigests.previewManifestDigest,
      preview.contentDigest,
    );

    const written = await writeFigmaSnapshotPreviewCacheManifest({
      workspaceRoot,
      manifest,
      nodeIndex: index,
      maxTiles: 4,
    });
    assert.equal(
      written.manifest.artifactDigests.previewManifestDigest,
      written.previewManifest.contentDigest,
    );
    const persistedPreview = JSON.parse(
      await readFile(join(written.vaultPath, "preview-manifest.json"), "utf8"),
    ) as unknown;
    const persistedManifest = JSON.parse(
      await readFile(join(written.vaultPath, "manifest.json"), "utf8"),
    ) as unknown;
    const firstAsset = written.previewManifest.assets[0];
    assert.ok(firstAsset !== undefined);
    const persistedAsset = await readFile(
      join(written.vaultPath, firstAsset.relativePath),
      "utf8",
    );
    assert.equal(Buffer.byteLength(persistedAsset, "utf8"), firstAsset.byteLength);
    assert.equal(sha256Hex(JSON.parse(persistedAsset) as unknown), firstAsset.sha256);
    validateFigmaSnapshotPreviewManifest(persistedPreview);
    validateFigmaSnapshotManifest(persistedManifest);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("figma snapshot explorer: writes fractional-bound preview assets with consistent tile dimensions", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ti-figma-fractional-preview-"));
  try {
    const index = buildIndex([
      createRecord({
        nodeId: "fractional:node",
        nodeName: "Fractional Preview Node",
        bbox: { x: 1.25, y: 2.5, width: 123.2, height: 45.8 },
      }),
    ]);
    const preview = planFigmaSnapshotPreviewCache({
      nodeIndex: index,
      maxTiles: 1,
      tileWidth: 500,
      tileHeight: 500,
    });
    const asset = preview.assets[0];
    const tile = preview.tiles[0];
    assert.ok(asset);
    assert.ok(tile);
    assert.equal(asset.width, 124);
    assert.equal(asset.height, 46);
    assert.equal(tile.width, asset.width);
    assert.equal(tile.height, asset.height);

    await writeFigmaSnapshotPreviewCacheAssets(workspaceRoot, preview);
    const persistedAsset = await readFile(join(workspaceRoot, asset.relativePath), "utf8");
    assert.equal(Buffer.byteLength(persistedAsset, "utf8"), asset.byteLength);
    assert.equal(sha256Hex(JSON.parse(persistedAsset) as unknown), asset.sha256);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

void test("figma snapshot explorer: rejects malformed evidence with sanitized diagnostics", () => {
  const index = buildIndex();
  const unsafe = {
    ...index,
    nodes: [
      {
        ...index.nodes[0],
        labels: [
          "Review https://customer.example/private",
          `${FIGMA_TOKEN_PREFIX}secret_node_value_1234567890`,
        ],
      },
      ...index.nodes.slice(1),
    ],
  } satisfies FigmaSnapshotNodeIndex;

  assert.throws(
    () =>
      queryFigmaSnapshotNodeIndex({
        nodeIndex: unsafe,
        query: "Review",
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaSnapshotExplorerError);
      assert.equal(err.errorCode, "invalid_evidence");
      assert.doesNotMatch(err.message, /https:\/\/customer\.example/u);
      assert.doesNotMatch(err.message, /figd_secret/u);
      return true;
    },
  );

  assert.throws(
    () =>
      buildFigmaSnapshotLocalNodeIndex({
        snapshotId: SNAPSHOT_ID,
        tenantScope: TENANT_SCOPE,
        source: SOURCE,
        records: [
          createRecord({ nodeId: "duplicate" }),
          createRecord({ nodeId: "duplicate" }),
        ],
      }),
    /duplicate node ids/u,
  );
});

const withDigest = <T extends { readonly contentDigest: string }>(
  artifact: Omit<T, "contentDigest">,
): T =>
  ({
    ...artifact,
    contentDigest: computeFigmaSnapshotArtifactDigest({
      ...artifact,
      contentDigest: ZERO_DIGEST,
    }),
  }) as T;
