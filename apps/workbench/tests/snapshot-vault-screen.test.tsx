import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_BASELINE } from "@/lib/settings-state";
import { SnapshotVaultScreen } from "@/components/snapshots/SnapshotVaultScreen";

const push = vi.fn();
const startRun = vi.fn(async () => undefined);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/workbench-context", () => ({
  useWorkbench: () => ({
    settings: {
      ...SETTINGS_BASELINE,
      TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY: "test-key",
      TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY: "test-signing-key",
    },
    startRun,
    runBusy: false,
    runError: null,
  }),
}));

const catalog = {
  snapshots: [
    {
      snapshotId: "snapshot-ui-test",
      tenantScope: "default/default/default",
      importedAt: "2026-05-29T08:00:00.000Z",
      importStrategy: "hybrid",
      lifecycleState: "completed",
      previewStatus: "complete",
      boundedPreview: false,
      nodeCount: 2,
      pageCount: 1,
      frameCount: 1,
      componentCount: 1,
      hiddenCount: 0,
      launchable: true,
      cacheState: "complete",
      rateLimit: { remaining: 42 },
    },
  ],
};

const detail = {
  detail: {
    snapshot: catalog.snapshots[0],
    pages: [
      {
        pageId: "page-accounts",
        pageName: "Retail Accounts",
        frameCount: 1,
        nodeCount: 2,
      },
    ],
    frames: [
      {
        pageId: "page-accounts",
        pageName: "Retail Accounts",
        frameId: "frame-open-account",
        frameName: "Open account application",
        nodeCount: 2,
      },
    ],
    sampleNodes: [
      {
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
        labels: ["iban", "field:account"],
        componentHints: ["control:text-entry"],
        textSnippet: "IBAN",
        bbox: { x: 120, y: 240, width: 340, height: 48 },
      },
    ],
    previewTiles: [
      {
        tileId: "tile-1",
        assetId: "asset-1",
        pageId: "page-accounts",
        frameId: "frame-open-account",
        x: 0,
        y: 0,
        width: 340,
        height: 48,
      },
    ],
  },
};

describe("SnapshotVaultScreen", () => {
  beforeEach(() => {
    push.mockClear();
    startRun.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/workbench/snapshots") {
          return Response.json(catalog);
        }
        if (url === "/api/workbench/snapshots/snapshot-ui-test") {
          return Response.json(detail);
        }
        if (url.includes("/selection-preview")) {
          return Response.json({
            preview: {
              snapshotId: "snapshot-ui-test",
              scopeDigest: "a".repeat(64),
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
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );
  });

  it("renders local snapshot evidence and launches from the scope basket", async () => {
    render(<SnapshotVaultScreen />);

    expect(
      await screen.findByRole("heading", { name: /Inspect local Figma evidence/u }),
    ).toBeInTheDocument();
    expect(await screen.findByText("snapshot-ui-test")).toBeInTheDocument();
    expect(await screen.findByText("Pages / frames")).toBeInTheDocument();
    expect(await screen.findByText(/Showing frames for Retail Accounts/u)).toBeInTheDocument();
    expect(await screen.findAllByText("IBAN input mask")).not.toHaveLength(0);

    const addPageButtons = screen.getAllByRole("button", { name: /Add page/u });
    const addFrameButtons = screen.getAllByRole("button", { name: /Add frame/u });
    await userEvent.click(addPageButtons[0]!);
    await userEvent.click(addFrameButtons[0]!);
    await userEvent.click(screen.getByRole("button", { name: /Add node/u }));

    await waitFor(() => {
      expect(screen.getByText(/local preflight matched 1 nodes/u)).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole("button", { name: /Generate from selection/u }),
    );

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMode: "snapshot",
        snapshotId: "snapshot-ui-test",
        snapshotSelection: expect.objectContaining({
          nodeIds: ["mask-iban"],
          pageIds: ["page-accounts"],
          frameIds: ["frame-open-account"],
        }),
        figmaUrl: "",
      }),
    );
    expect(push).toHaveBeenCalledWith("/runs");
  });
});
