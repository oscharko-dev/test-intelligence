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
      rateLimit: {
        remaining: 42,
      },
      credential: {
        authMode: "enterprise_service_token",
      },
      budget: {
        policyVersion: "figma-import-budget/v1",
        resourceType: "image_metadata",
        windowSeconds: 60,
        maxRequestsPerWindow: 80,
        usedRequests: 4,
        remainingRequests: 76,
      },
    },
    {
      snapshotId: "snapshot-broken",
      tenantScope: "default/default/default",
      importedAt: "2026-05-29T08:05:00.000Z",
      importStrategy: "hybrid",
      lifecycleState: "failed",
      previewStatus: "failed",
      boundedPreview: false,
      nodeCount: 0,
      pageCount: 0,
      frameCount: 0,
      componentCount: 0,
      hiddenCount: 0,
      launchable: false,
      cacheState: "failed",
      rateLimit: {},
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
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        if (url === "/api/workbench/snapshots") {
          if (method === "GET") {
            return Response.json(catalog);
          }
          const requestBody =
            typeof init?.body === "string"
              ? (JSON.parse(init.body) as { figmaUrl?: string })
              : {};
          const figmaUrl = requestBody.figmaUrl ?? "";
          const failureClass = figmaUrl.includes("invalid-credential")
            ? "invalid_credential"
            : figmaUrl.includes("unsupported-auth")
              ? "unsupported_auth_mode"
              : figmaUrl.includes("budget-exhausted")
                ? "budget_exhausted"
                : "throttled";
          return Response.json(
            {
              job: {
                jobId: "ti-snapshot-rate-limit",
                action: "import",
                status: "failed",
                queueState: "idle",
                sourceUrlHash: "e".repeat(64),
                tenantScope: "default/default/default",
                queuedAt: "2026-05-29T08:10:00.000Z",
                completedAt: "2026-05-29T08:10:01.000Z",
                failureClass,
                credential: {
                  authMode: "personal_access_token",
                },
                budget: {
                  policyVersion: "figma-import-budget/v1",
                  resourceType: "node_batch",
                  windowSeconds: 60,
                  maxRequestsPerWindow: 1,
                  usedRequests: 1,
                  remainingRequests: 0,
                },
                ...(failureClass === "throttled"
                  ? {
                      rateLimit: {
                        retryAfterSeconds: 90,
                        figmaPlanTier: "starter",
                        figmaRateLimitType: "low_limit",
                        remediation: {
                          scenario: "low_limit",
                          guidance:
                            "Observed Figma throttling is consistent with a low-limit plan or narrow quota bucket. Wait for the retry window, reduce the selected node scope, or use an enterprise-governed credential for scheduled imports.",
                        },
                      },
                    }
                  : {}),
                message: `Snapshot import failed: ${failureClass}.`,
              },
            },
            { status: 202 },
          );
        }
        if (url === "/api/workbench/snapshots/snapshot-ui-test") {
          return Response.json(detail);
        }
        if (url === "/api/workbench/snapshots/snapshot-broken") {
          return Response.json(
            {
              error: {
                code: "SNAPSHOT_DETAIL_FAILED",
                message: "Snapshot detail failed.",
              },
            },
            { status: 500 },
          );
        }
        if (url.includes("/api/workbench/scope-baskets")) {
          // No persisted basket by default, so hydration leaves the basket empty
          // and the existing assertions about the ephemeral selection hold. PUTs
          // (best-effort persistence) are acknowledged without a stored record.
          return Response.json({ basket: null });
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
      await screen.findByRole("heading", {
        name: /Inspect local Figma evidence/u,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("snapshot-ui-test")).toBeInTheDocument();
    expect(await screen.findByText("Pages / frames")).toBeInTheDocument();
    expect(
      await screen.findByText(/Showing frames for Retail Accounts/u),
    ).toBeInTheDocument();
    expect(await screen.findAllByText("IBAN input mask")).not.toHaveLength(0);

    const addPageButtons = screen.getAllByRole("button", { name: /Add page/u });
    const addFrameButtons = screen.getAllByRole("button", {
      name: /Add frame/u,
    });
    await userEvent.click(addPageButtons[0]!);
    await userEvent.click(addFrameButtons[0]!);
    await userEvent.click(screen.getByRole("button", { name: /Add node/u }));

    await waitFor(() => {
      expect(
        screen.getByText(/local preflight matched 1 nodes/u),
      ).toBeInTheDocument();
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

  it("clears stale local evidence when a newly selected snapshot fails", async () => {
    render(<SnapshotVaultScreen />);

    expect(await screen.findAllByText("IBAN input mask")).not.toHaveLength(0);

    await userEvent.click(await screen.findByText("snapshot-broken"));

    await waitFor(() => {
      expect(screen.queryByText("IBAN input mask")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Snapshot detail failed.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Select or import a snapshot to inspect local evidence.",
      ),
    ).toBeInTheDocument();
  });

  it("renders import queue rate-limit metadata and remediation without raw URL echo", async () => {
    render(<SnapshotVaultScreen />);

    const figmaUrl =
      "https://www.figma.com/design/ABC/CustomerBoard?node-id=1-2&access_token=private";
    await userEvent.type(
      await screen.findByLabelText(/Figma URL for live import/u),
      figmaUrl,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Import snapshot/u }),
    );

    expect(await screen.findByText(/queue idle/u)).toBeInTheDocument();
    expect(screen.getByText(/failure class throttled/u)).toBeInTheDocument();
    expect(
      screen.getByText(/credential personal access token/u),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/node batch budget 1\/1 used/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/limit type low_limit/u)).toBeInTheDocument();
    expect(screen.getByText(/plan starter/u)).toBeInTheDocument();
    expect(screen.getByText(/remediation low_limit/u)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(figmaUrl);
    expect(document.body.textContent).not.toContain("access_token=private");
  });

  it.each([
    ["invalid_credential", "invalid-credential"],
    ["unsupported_auth_mode", "unsupported-auth"],
    ["budget_exhausted", "budget-exhausted"],
  ])("renders deterministic %s import failures", async (failureClass, path) => {
    render(<SnapshotVaultScreen />);

    await userEvent.type(
      await screen.findByLabelText(/Figma URL for live import/u),
      `https://www.figma.com/design/ABC/${path}`,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Import snapshot/u }),
    );

    expect(
      await screen.findByText(`failure class ${failureClass}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/credential personal access token/u),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/node batch budget 1\/1 used/u),
    ).toBeInTheDocument();
  });
});
