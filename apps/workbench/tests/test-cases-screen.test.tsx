import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestCasesScreen } from "@/components/test-cases/TestCasesScreen";
import type { TestCaseSummary } from "@/lib/server/storage/types";

const summary = (
  overrides: Partial<TestCaseSummary> & { readonly id: string },
): TestCaseSummary => ({
  id: overrides.id,
  tenantScope: overrides.tenantScope ?? "t",
  createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
  sourceRunId: overrides.sourceRunId ?? "run-1",
  sourceGeneratedSeedId: overrides.sourceGeneratedSeedId ?? "seed-1",
  sourceTestCaseId: overrides.sourceTestCaseId ?? overrides.id,
  currentVersionId: overrides.currentVersionId ?? `ver-${overrides.id}`,
  status: overrides.status ?? "draft",
  title: overrides.title ?? `Case ${overrides.id}`,
  priority: overrides.priority ?? "P1",
  risk: overrides.risk ?? "low",
  tags: overrides.tags ?? [],
  versionStatus: overrides.versionStatus ?? "generated",
  snapshotIds: overrides.snapshotIds ?? [],
  traceLinkKinds: overrides.traceLinkKinds ?? ["run"],
});

const fixtures: readonly TestCaseSummary[] = [
  summary({
    id: "a",
    title: "Alpha",
    priority: "P0",
    risk: "high",
    tags: ["L1"],
  }),
  summary({
    id: "b",
    title: "Bravo",
    priority: "P1",
    risk: "low",
    tags: ["L1"],
  }),
  summary({
    id: "c",
    title: "Charlie",
    priority: "P1",
    risk: "low",
    tags: ["L2"],
  }),
  summary({ id: "d", title: "Delta", priority: "P2", risk: "low" }),
  summary({
    id: "e",
    title: "Echo",
    priority: "P2",
    risk: "high",
    tags: ["L2"],
  }),
];

const installListFetch = (
  rows: readonly TestCaseSummary[],
): ReturnType<typeof vi.fn> => {
  const fn = vi.fn(async () => Response.json({ testCases: rows }));
  vi.stubGlobal("fetch", fn);
  return fn;
};

describe("TestCasesScreen", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the list after the initial fetch", async () => {
    installListFetch(fixtures);
    render(<TestCasesScreen />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Echo")).toBeInTheDocument();
  });

  it("filters by priority via the chip group", async () => {
    installListFetch(fixtures);
    render(<TestCasesScreen />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    const priorityGroup = screen.getByRole("group", { name: /priority/i });
    const p0Chip = within(priorityGroup).getByRole("button", { name: "P0" });
    await userEvent.click(p0Chip);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
    expect(screen.queryByText("Delta")).not.toBeInTheDocument();

    await userEvent.click(p0Chip);
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });

  it("shows the no-matches status when all rows are filtered out", async () => {
    installListFetch(fixtures);
    render(<TestCasesScreen />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    const tagGroup = screen.getByRole("group", { name: /tags/i });
    await userEvent.click(within(tagGroup).getByRole("button", { name: "L1" }));
    await userEvent.click(within(tagGroup).getByRole("button", { name: "L2" }));

    expect(
      screen.getByText("No test cases match the current filters."),
    ).toBeInTheDocument();
  });

  it("shows the empty state when zero rows are returned", async () => {
    installListFetch([]);
    render(<TestCasesScreen />);

    await waitFor(() => {
      expect(
        screen.getByText("No persisted test cases yet."),
      ).toBeInTheDocument();
    });
  });
});
