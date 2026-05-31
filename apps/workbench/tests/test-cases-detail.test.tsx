import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestCaseDetailScreen } from "@/components/test-cases/TestCaseDetailScreen";
import type { PersistedTestCaseDetail } from "@/lib/server/storage/types";

const SHA = "1".repeat(64);

const traceLinks = [
  {
    id: "tl-run",
    testCaseVersionId: "ver-1",
    tenantScope: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    targetKind: "run" as const,
    targetId: "run-12345678",
  },
  {
    id: "tl-snap",
    testCaseVersionId: "ver-1",
    tenantScope: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    targetKind: "snapshot" as const,
    targetId: "snap-12345678",
  },
  {
    id: "tl-node",
    testCaseVersionId: "ver-1",
    tenantScope: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    targetKind: "figma-node" as const,
    targetId: "node-12345678",
  },
  {
    id: "tl-basket",
    testCaseVersionId: "ver-1",
    tenantScope: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    targetKind: "scope-basket" as const,
    targetId: "basket-12345678",
  },
];

const detail: PersistedTestCaseDetail = {
  testCase: {
    id: "tc-1",
    tenantScope: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    sourceRunId: "run-12345678",
    sourceGeneratedSeedId: "seed-1",
    sourceTestCaseId: "src-1",
    currentVersionId: "ver-1",
    status: "draft",
  },
  currentVersion: {
    id: "ver-1",
    testCaseId: "tc-1",
    tenantScope: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    versionIndex: 1,
    source: "generated",
    title: "Onboarding flow happy path",
    objective: "Validate the onboarding flow.",
    preconditions: ["User exists", "Feature flag on"],
    steps: [
      { action: "Open onboarding", expected: "Wizard appears" },
      { action: "Submit", expected: "Account created" },
    ],
    testData: ["sample@example.com"],
    priority: "P1",
    risk: "high",
    tags: ["L1", "smoke"],
    status: "generated",
    content: {
      sha256: SHA,
      byteSize: 12,
      storageRef: `artifacts/${SHA.slice(0, 2)}/${SHA.slice(2)}`,
    },
    traceLinks,
  },
};

const installDetailFetch = (response: Response): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
};

describe("TestCaseDetailScreen", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the editor with the read-only banner and disabled inputs", async () => {
    installDetailFetch(Response.json(detail));
    render(<TestCaseDetailScreen caseId="tc-1" />);

    await waitFor(() => {
      expect(
        screen.getByText("Onboarding flow happy path"),
      ).toBeInTheDocument();
    });

    const banner = screen.getByText(
      /Editing is read-only until the next release/i,
    );
    expect(banner).toBeInTheDocument();
    expect(banner.closest('[role="status"]')).not.toBeNull();

    const titleInput = screen.getByLabelText("Title");
    expect(titleInput).toBeDisabled();

    const objective = screen.getByLabelText("Objective");
    expect(objective).toBeDisabled();

    const stepOneAction = screen.getByLabelText("Step 1 action");
    expect(stepOneAction).toBeDisabled();
    expect(stepOneAction).toHaveValue("Open onboarding");
  });

  it("renders every traceability group present in the fixture", async () => {
    installDetailFetch(Response.json(detail));
    render(<TestCaseDetailScreen caseId="tc-1" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Run" })).toBeInTheDocument();
    });
    expect(
      screen.getByRole("heading", { name: "Snapshot" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Figma node" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Scope basket" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Source version")).toBeInTheDocument();
    expect(screen.getByText("ver-1")).toBeInTheDocument();
  });

  it("shows the friendly missing state on 404", async () => {
    installDetailFetch(
      new Response(
        JSON.stringify({
          error: { code: "WORKBENCH_TEST_CASE_NOT_FOUND", message: "gone" },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    render(<TestCaseDetailScreen caseId="tc-1" />);

    await waitFor(() => {
      expect(screen.getByText("Test case not found.")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /Back to all test cases/i }),
    ).toBeInTheDocument();
  });
});
