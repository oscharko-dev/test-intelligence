import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  TestCasesList,
  TEST_CASES_LIST_PAGE_SIZE,
} from "@/components/test-cases/TestCasesList";
import type { TestCaseSummary } from "@/lib/server/storage/types";

const makeRows = (count: number): readonly TestCaseSummary[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `tc-${index}`,
    tenantScope: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourceRunId: "run-1",
    sourceGeneratedSeedId: "seed-1",
    sourceTestCaseId: `src-${index}`,
    currentVersionId: `ver-${index}`,
    status: "draft" as const,
    title: `Case ${index}`,
    priority: "P1",
    risk: "low",
    tags: [],
    versionStatus: "generated",
    snapshotIds: [],
    traceLinkKinds: ["run"] as const,
  }));

describe("TestCasesList windowing", () => {
  it("limits the rendered rows to the page size by default", () => {
    const rows = makeRows(500);
    render(<TestCasesList rows={rows} hasAnyData />);
    const links = screen.getAllByTestId("test-case-row-link");
    expect(links.length).toBe(TEST_CASES_LIST_PAGE_SIZE);
  });

  it("reveals the remaining rows when 'Show {N} more' is clicked", async () => {
    const rows = makeRows(500);
    render(<TestCasesList rows={rows} hasAnyData />);
    const button = screen.getByTestId("test-cases-show-more");
    expect(button).toHaveTextContent("300");
    await userEvent.click(button);
    const linksAfter = screen.getAllByTestId("test-case-row-link");
    expect(linksAfter.length).toBe(500);
  });

  it("renders every row without a button when count is at the page size", () => {
    const rows = makeRows(TEST_CASES_LIST_PAGE_SIZE);
    render(<TestCasesList rows={rows} hasAnyData />);
    expect(screen.queryByTestId("test-cases-show-more")).toBeNull();
    expect(screen.getAllByTestId("test-case-row-link").length).toBe(
      TEST_CASES_LIST_PAGE_SIZE,
    );
  });
});
