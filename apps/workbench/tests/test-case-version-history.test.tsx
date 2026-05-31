import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestCaseVersionHistory } from "@/components/test-cases/TestCaseVersionHistory";
import type { TestCaseVersionRecord } from "@/lib/server/storage/types";

const SHA = "0".repeat(64);

const baseVersion = (
  index: number,
  overrides?: Partial<TestCaseVersionRecord>,
): TestCaseVersionRecord => ({
  id: `ver-${index}`,
  testCaseId: "tc-1",
  tenantScope: "t",
  createdAt: `2026-01-0${index}T00:00:00.000Z`,
  versionIndex: index,
  source: "manual",
  title: `Version ${index}`,
  objective: "",
  preconditions: [],
  steps: [],
  testData: [],
  priority: "",
  risk: "",
  tags: [],
  status: "draft",
  content: { sha256: SHA, byteSize: 0, storageRef: `artifacts/00/${SHA}` },
  traceLinks: [],
  ...overrides,
});

const installFetch = (
  impl: (input: string) => Promise<Response>,
): ReturnType<typeof vi.fn> => {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    return impl(url);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
};

describe("TestCaseVersionHistory", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders versions newest-first", async () => {
    const versions = [
      baseVersion(3, { source: "manual", title: "Third" }),
      baseVersion(2, { source: "manual", title: "Second" }),
      baseVersion(1, { source: "generated", title: "First" }),
    ];
    installFetch(async () => Response.json({ versions }));
    render(<TestCaseVersionHistory caseId="tc-1" currentVersionId="ver-3" />);

    await waitFor(() => {
      expect(screen.getByText("v3")).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole("button");
    // Newest first: v3, v2, v1
    expect(buttons[0]?.textContent).toContain("v3");
    expect(buttons[1]?.textContent).toContain("v2");
    expect(buttons[2]?.textContent).toContain("v1");
  });

  it("highlights the current version with a 'current' badge and selects it by default", async () => {
    const versions = [
      baseVersion(2, { source: "manual" }),
      baseVersion(1, { source: "generated" }),
    ];
    installFetch(async () => Response.json({ versions }));
    render(<TestCaseVersionHistory caseId="tc-1" currentVersionId="ver-2" />);

    await waitFor(() => {
      expect(screen.getByText("v2")).toBeInTheDocument();
    });

    const currentButton = screen.getByRole("button", {
      name: /Version 2 \(current\)/,
    });
    expect(currentButton).toBeInTheDocument();
    expect(currentButton.textContent).toContain("current");
    expect(currentButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Version 1/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls onSelectVersion with the version id when a row is clicked", async () => {
    const versions = [baseVersion(2), baseVersion(1)];
    installFetch(async () => Response.json({ versions }));
    const onSelectVersion = vi.fn();
    render(
      <TestCaseVersionHistory
        caseId="tc-1"
        currentVersionId="ver-2"
        onSelectVersion={onSelectVersion}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("v2")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Version 1/ }));
    expect(onSelectVersion).toHaveBeenCalledWith("ver-1");
  });

  it("renders the empty state when the version list is empty", async () => {
    installFetch(async () => Response.json({ versions: [] }));
    render(<TestCaseVersionHistory caseId="tc-1" currentVersionId="ver-x" />);

    await waitFor(() => {
      expect(screen.getByText("No versions recorded.")).toBeInTheDocument();
    });
  });

  it("renders an error notice when the fetch returns 500", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "WORKBENCH_TEST_CASE_VERSIONS_LIST_FAILED",
              message: "boom",
            },
          }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
    );
    render(<TestCaseVersionHistory caseId="tc-1" currentVersionId="ver-1" />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("boom");
    });
  });

  it("reflects an externally-controlled selectedVersionId via aria-pressed", async () => {
    const versions = [baseVersion(2), baseVersion(1)];
    installFetch(async () => Response.json({ versions }));
    render(
      <TestCaseVersionHistory
        caseId="tc-1"
        currentVersionId="ver-2"
        selectedVersionId="ver-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("v2")).toBeInTheDocument();
    });

    const v1 = screen.getByRole("button", { name: /Version 1/ });
    const v2 = screen.getByRole("button", { name: /Version 2 \(current\)/ });
    expect(v1).toHaveAttribute("aria-pressed", "true");
    expect(v2).toHaveAttribute("aria-pressed", "false");
  });
});
