import { expect, test, type Page } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
import type { Settings } from "@/lib/settings-state";

const FIXED_NOW = "2026-05-25T10:15:30.000Z";
const VISUAL_TEST_SETTINGS: Settings = {
  TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT:
    "https://visual-test-gateway.example.test/openai",
  TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION: "2024-10-01-preview",
  TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY: "visual-test-api-key",
  TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN: "visual-test-figma-token",
  TEST_INTELLIGENCE_MODEL_ENDPOINT:
    "https://visual-test-foundry.example.test/openai",
  TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT:
    "https://visual-test-vision.example.test/openai",
  TEST_INTELLIGENCE_TESTCASE_MODEL_DEPLOYMENT: "gpt-oss-120b",
  TEST_INTELLIGENCE_LOGIC_JUDGE_DEPLOYMENT: "gpt-oss-120b",
  TEST_INTELLIGENCE_VISUAL_PRIMARY_DEPLOYMENT: "llama-4-maverick-vision",
  TEST_INTELLIGENCE_VISUAL_FALLBACK_DEPLOYMENT: "phi-4-multimodal-instruct",
  TEST_INTELLIGENCE_REGION_ATTESTED_REGION: "eu-north-1",
  TEST_INTELLIGENCE_REGION_ATTESTATION_SOVEREIGN_SOURCE: true,
  TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY:
    "visual-test-region-signing-key",
  TEST_INTELLIGENCE_ALLOW_POLICY_BLOCKED: false,
  NODE_EXTRA_CA_CERTS: "",
};
const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const BROWSER_SNAPSHOT_ID = "snapshot-browser-gate";
const BROWSER_FILE_KEY_HASH = "c".repeat(64);
const BROWSER_SOURCE_URL_HASH = "d".repeat(64);
const ZERO_DIGEST = "0".repeat(64);
const browserSnapshotSource: FigmaSnapshotSourceIdentifier = {
  fileKeyHash: BROWSER_FILE_KEY_HASH,
  sourceUrlHash: BROWSER_SOURCE_URL_HASH,
};
const browserSnapshotVaultPath = path.join(
  repoRoot,
  ".test-intelligence",
  "figma-snapshots",
  "default",
  "default",
  "default",
  BROWSER_FILE_KEY_HASH,
  BROWSER_SNAPSHOT_ID,
);

const withDigest = <T extends { contentDigest: string }>(
  value: Omit<T, "contentDigest">,
): T => {
  const draft = { ...value, contentDigest: ZERO_DIGEST } as T;
  return {
    ...draft,
    contentDigest: computeFigmaSnapshotArtifactDigest(draft),
  };
};

function buildBrowserSnapshotRecords(): FigmaSnapshotNodeRecord[] {
  const records: FigmaSnapshotNodeRecord[] = [];
  for (let pageIndex = 1; pageIndex <= 3; pageIndex += 1) {
    const pageId = `page-${pageIndex}`;
    const pageName =
      pageIndex === 1 ? "Retail Accounts" : `Enterprise Journey ${pageIndex}`;
    for (let frameIndex = 1; frameIndex <= 4; frameIndex += 1) {
      const frameId = `frame-${pageIndex}-${frameIndex}`;
      const frameName =
        pageIndex === 1 && frameIndex === 1
          ? "Open account application"
          : `Workflow frame ${pageIndex}.${frameIndex}`;
      records.push({
        pageId,
        pageName,
        frameId,
        frameName,
        nodeId: frameId,
        nodeName: frameName,
        nodeType: "FRAME",
        ancestorNodeIds: [],
        bbox: {
          x: frameIndex * 1320,
          y: pageIndex * 960,
          width: 1280,
          height: 900,
        },
        labels: ["screen", `page:${pageIndex}`],
        componentHints: [],
        visible: true,
        sourceChunkRefs: [{ chunkId: `chunk-${pageIndex}-${frameIndex}` }],
      });
      for (let nodeIndex = 1; nodeIndex <= 5; nodeIndex += 1) {
        const target =
          pageIndex === 1 && frameIndex === 1 && nodeIndex === 1;
        records.push({
          pageId,
          pageName,
          frameId,
          frameName,
          parentNodeId: frameId,
          nodeId: target
            ? "mask-iban-browser"
            : `node-${pageIndex}-${frameIndex}-${nodeIndex}`,
          nodeName: target
            ? "IBAN input mask"
            : `Control ${pageIndex}.${frameIndex}.${nodeIndex}`,
          nodeType: target ? "TEXT_FIELD" : "INSTANCE",
          ancestorNodeIds: [frameId],
          bbox: {
            x: 120 + nodeIndex * 80,
            y: 180 + nodeIndex * 54,
            width: target ? 340 : 220,
            height: target ? 48 : 64,
          },
          labels: target
            ? ["iban", "field:account", "mask", "domain:banking"]
            : ["control", `node:${nodeIndex}`],
          componentHints: target
            ? ["control:text-entry", "field:account"]
            : ["component:design-system"],
          ...(target ? { textSnippet: "IBAN" } : {}),
          visible: true,
          sourceChunkRefs: [{ chunkId: `chunk-${pageIndex}-${frameIndex}` }],
        });
      }
    }
  }
  return records;
}

async function seedBrowserSnapshotVaultFixture(): Promise<void> {
  await rm(browserSnapshotVaultPath, { recursive: true, force: true });
  const records = buildBrowserSnapshotRecords();
  const nodeIndex = buildFigmaSnapshotLocalNodeIndex({
    snapshotId: BROWSER_SNAPSHOT_ID,
    tenantScope: DEFAULT_TENANT_SCOPE,
    source: browserSnapshotSource,
    records,
  });
  const previewManifest = planFigmaSnapshotPreviewCache({
    nodeIndex,
    maxTiles: 18,
  });
  const importStatus = withDigest<FigmaSnapshotImportStatus>({
    schemaVersion: FIGMA_SNAPSHOT_IMPORT_STATUS_SCHEMA_VERSION,
    snapshotId: BROWSER_SNAPSHOT_ID,
    tenantScope: DEFAULT_TENANT_SCOPE,
    source: browserSnapshotSource,
    lifecycleState: "completed",
    retry: { attempt: 1, maxAttempts: 3 },
    rateLimit: {
      remaining: 77,
      figmaPlanTier: "enterprise",
      figmaRateLimitType: "file",
    },
    chunks: [
      {
        chunkId: "chunk-browser-gate",
        state: "completed",
        nodeCount: records.length,
        contentDigest: nodeIndex.contentDigest,
      },
    ],
    checkpoint: {
      lastSuccessfulPhase: "completed",
      completedChunkIds: ["chunk-browser-gate"],
    },
  });
  const manifest = withDigest<FigmaSnapshotManifest>({
    schemaVersion: FIGMA_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
    snapshotId: BROWSER_SNAPSHOT_ID,
    tenantScope: DEFAULT_TENANT_SCOPE,
    source: browserSnapshotSource,
    importStrategy: "hybrid",
    figmaVersion: "browser-gate-1",
    figmaLastModified: "2026-05-28T12:00:00.000Z",
    importedAt: "2026-05-29T08:00:00.000Z",
    artifactDigests: {
      nodeIndexDigest: nodeIndex.contentDigest,
      importStatusDigest: importStatus.contentDigest,
      previewManifestDigest: previewManifest.contentDigest,
    },
  });

  await mkdir(browserSnapshotVaultPath, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(browserSnapshotVaultPath, "manifest.json"),
      `${serializeFigmaSnapshotArtifact(manifest)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(browserSnapshotVaultPath, "node-index.json"),
      `${serializeFigmaSnapshotArtifact(nodeIndex)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(browserSnapshotVaultPath, "import-status.json"),
      `${serializeFigmaSnapshotArtifact(importStatus)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(browserSnapshotVaultPath, "preview-manifest.json"),
      `${serializeFigmaSnapshotArtifact(previewManifest)}\n`,
      "utf8",
    ),
  ]);
}

async function cleanupBrowserSnapshotVaultFixture(): Promise<void> {
  await rm(browserSnapshotVaultPath, { recursive: true, force: true });
}

async function preparePage(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      {
        const fixed = new Date("${FIXED_NOW}").valueOf();
        const NativeDate = Date;
        class FixedDate extends NativeDate {
          constructor(...args) {
            super(args.length === 0 ? fixed : args[0]);
          }
          static now() {
            return fixed;
          }
        }
        Object.setPrototypeOf(FixedDate, NativeDate);
        window.Date = FixedDate;
      }
    `,
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
}

async function openWorkbench(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.getByRole("banner").waitFor();
  await page.locator(".statusbar").waitFor();
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        caret-color: transparent !important;
      }
      .tip::after {
        display: none !important;
      }
    `,
  });
}

async function mockWorkbenchSettings(page: Page, settings: Settings): Promise<void> {
  await page.route("**/api/workbench/settings", async (route, request) => {
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ settings }),
    });
  });
}

async function mockSnapshotVault(page: Page): Promise<void> {
  const snapshot = {
    snapshotId: "snapshot-20260529-enterprise",
    tenantScope: "default/default/default",
    importedAt: "2026-05-29T08:00:00.000Z",
    importStrategy: "hybrid",
    lifecycleState: "completed",
    previewStatus: "complete",
    boundedPreview: true,
    figmaVersion: "99",
    figmaLastModified: "2026-05-28T12:00:00.000Z",
    nodeCount: 2500,
    pageCount: 18,
    frameCount: 144,
    componentCount: 620,
    hiddenCount: 31,
    launchable: true,
    cacheState: "complete",
    rateLimit: {
      remaining: 42,
      figmaPlanTier: "enterprise",
      figmaRateLimitType: "file",
    },
  };
  const node = {
    nodeId: "mask-iban",
    nodeName: "IBAN input mask",
    nodeType: "TEXT_FIELD",
    pageId: "page-accounts",
    pageName: "Retail Accounts",
    frameId: "frame-open-account",
    frameName: "Open account application",
    visible: true,
    offCanvas: false,
    missingBounds: false,
    labels: ["iban", "field:account", "duplicate-label", "domain:banking"],
    componentHints: ["control:text-entry", "field:account"],
    textSnippet: "IBAN",
    bbox: { x: 120, y: 240, width: 340, height: 48 },
  };
  await page.route("**/api/workbench/snapshots", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ snapshots: [snapshot] }),
      });
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        job: {
          jobId: "ti-snapshot-visual",
          action: "import",
          status: "queued",
          queueState: "queued",
          sourceUrlHash: "a".repeat(64),
          tenantScope: "default/default/default",
          queuedAt: FIXED_NOW,
        },
      }),
    });
  });
  await page.route("**/api/workbench/snapshots/*/selection-preview", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        preview: {
          snapshotId: snapshot.snapshotId,
          scopeDigest: "b".repeat(64),
          payloadBytes: 2048,
          resolvedNodeCount: 1,
          requestedSelection: {
            nodeIds: ["mask-iban"],
            pageIds: [],
            frameIds: [],
          },
          traceAnchors: [
            {
              screenId: "Retail Accounts",
              nodeId: "mask-iban",
              nodeName: "IBAN input mask",
            },
          ],
        },
      }),
    });
  });
  await page.route("**/api/workbench/snapshots/*/search?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        search: {
          snapshot,
          query: "iban",
          results: [node],
        },
      }),
    });
  });
  await page.route("**/api/workbench/snapshots/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.split("/").length !== 5) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        detail: {
          snapshot,
          pages: [
            {
              pageId: "page-accounts",
              pageName: "Retail Accounts",
              frameCount: 14,
              nodeCount: 280,
            },
          ],
          frames: [
            {
              pageId: "page-accounts",
              pageName: "Retail Accounts",
              frameId: "frame-open-account",
              frameName: "Open account application",
              nodeCount: 86,
            },
          ],
          sampleNodes: [node],
          previewTiles: Array.from({ length: 18 }, (_, index) => ({
            tileId: `tile-${index}`,
            assetId: `asset-${index}`,
            pageId: "page-accounts",
            frameId: "frame-open-account",
            x: index * 73,
            y: index * 41,
            width: 320 + (index % 4) * 80,
            height: 180 + (index % 3) * 60,
          })),
        },
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test.afterEach(async () => {
  await cleanupBrowserSnapshotVaultFixture();
});

test("captures the run draft screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkbench(page, "/runs");

  await expect(
    page.getByRole("heading", { name: "Configure run" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workbench-runs-draft.png");
});

test("captures a completed run detail screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockWorkbenchSettings(page, VISUAL_TEST_SETTINGS);
  await openWorkbench(page, "/runs");

  await page.getByRole("button", { name: "Seed demo" }).click();
  await page.getByRole("button", { name: "Advanced" }).click();
  await page.getByLabel("Job ID override").fill("ti-workbench-visual-fixed");
  await expect(page.getByRole("button", { name: "Launch run" })).toBeEnabled();
  const started = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      response.url().includes("/api/workbench/runs")
    );
  });
  await page.getByRole("button", { name: "Launch run" }).click();
  const startResponse = await started;
  expect(
    startResponse.ok(),
    `Expected run start to succeed, got HTTP ${startResponse.status()}`,
  ).toBe(true);

  await expect(page.getByRole("heading", { name: "Run detail" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".rd-header")).toContainText(
    "ti-workbench-visual-fixed",
  );
  await expect(page.locator(".rd-header")).toContainText(
    "generatedAt 2026-05-25 10:15:30Z",
  );
  await expect(page.locator(".statusbar")).toContainText("sealed");
  await expect(page).toHaveScreenshot("workbench-run-detail-sealed.png");
});

test("captures model gateway settings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openWorkbench(page, "/settings/model");

  await expect(
    page.getByRole("heading", { name: "Model gateway settings" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workbench-model-settings.png");
});

test("captures run history with the detail drawer state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openWorkbench(page, "/runs/history");

  await page.getByText("ti-workbench-1764950400123").click();
  await expect(
    page.getByText("Detail · ti-workbench-1764950400123"),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workbench-history-detail.png");
});

test("captures the Snapshot Vault desktop workflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockWorkbenchSettings(page, VISUAL_TEST_SETTINGS);
  await mockSnapshotVault(page);
  await openWorkbench(page, "/snapshots");

  await expect(
    page.getByRole("heading", { name: /Inspect local Figma evidence/u }),
  ).toBeVisible();
  await page.getByLabel("Search local node index").fill("iban");
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(page.getByText(/local preflight matched 1 nodes/u)).toBeVisible();
  await expect(page).toHaveScreenshot("workbench-snapshot-vault-desktop.png");
});

test("runs the Snapshot Vault browser flow from a real local vault", async ({
  page,
}) => {
  await seedBrowserSnapshotVaultFixture();
  await page.setViewportSize({ width: 1440, height: 960 });
  const figmaRequests: string[] = [];
  const importPosts: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname.endsWith("figma.com")) figmaRequests.push(request.url());
    if (
      request.method() === "POST" &&
      url.pathname === "/api/workbench/snapshots"
    ) {
      importPosts.push(request.url());
    }
  });
  await page.route(/https?:\/\/(?:[^/]+\.)?figma\.com\/.*/u, async (route) => {
    figmaRequests.push(route.request().url());
    await route.abort();
  });
  await mockWorkbenchSettings(page, VISUAL_TEST_SETTINGS);

  await openWorkbench(page, "/snapshots");

  await expect(page.getByText(BROWSER_SNAPSHOT_ID)).toBeVisible();
  await page.getByRole("button", { name: /Retail Accounts page-1/u }).click();
  await expect(
    page.getByText(/Showing frames for Retail Accounts/u),
  ).toBeVisible();
  await page.getByRole("button", { name: /Add page/u }).first().click();
  await page.getByRole("button", { name: /Add frame/u }).first().click();
  await page.getByLabel("Search local node index").fill("IBAN");
  await expect(page.getByText("IBAN input mask")).toBeVisible();
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(page.getByText(/local preflight matched \d+ nodes/u)).toBeVisible();

  const startResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      response.url().includes("/api/workbench/runs")
    );
  });
  await page.getByRole("button", { name: /Generate from selection/u }).click();
  const startResponse = await startResponsePromise;
  expect(startResponse.ok()).toBe(true);
  const startPayload = (await startResponse.json()) as {
    run?: {
      config?: {
        sourceMode?: string;
        figmaUrl?: string;
        snapshotId?: string;
      };
      artifactDir?: string;
      outputRoot?: string;
    };
  };
  expect(startPayload.run?.config).toMatchObject({
    sourceMode: "snapshot",
    figmaUrl: "",
    snapshotId: BROWSER_SNAPSHOT_ID,
  });
  expect(startPayload.run?.artifactDir).toBeUndefined();
  expect(startPayload.run?.outputRoot).toBeUndefined();

  await expect(page.getByRole("heading", { name: "Run detail" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".statusbar")).toContainText("sealed", {
    timeout: 15_000,
  });
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain(repoRoot);
  expect(bodyText).not.toContain("https://www.figma.com/design");
  expect(figmaRequests).toEqual([]);
  expect(importPosts).toEqual([]);
});

test("captures the Snapshot Vault mobile layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkbenchSettings(page, VISUAL_TEST_SETTINGS);
  await mockSnapshotVault(page);
  await openWorkbench(page, "/snapshots");

  await expect(page.getByText("Snapshot Vault")).toBeVisible();
  await expect(page.getByText("snapshot-20260529-enterprise")).toBeVisible();
  await expect(page).toHaveScreenshot("workbench-snapshot-vault-mobile.png");
});
