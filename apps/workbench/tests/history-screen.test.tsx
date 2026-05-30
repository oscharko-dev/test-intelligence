import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HistoryScreen } from "@/components/history/HistoryScreen";

describe("HistoryScreen legacy index summary", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          summary: {
            indexed: 1,
            alreadyIndexed: 0,
            legacyReadOnly: 2,
            skipped: 1,
            warnings: ["Legacy snapshot snap-bad skipped: corrupt JSON"],
            snapshots: [
              { id: "snap-read-only", classification: "legacy-read-only" },
              { id: "snap-bad", classification: "skipped" },
            ],
            runs: [{ id: "ti-workbench-legacy", classification: "legacy-read-only" }],
          },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens legacy details from a keyboard-reachable control and renders concrete artifacts", async () => {
    render(<HistoryScreen />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workbench/legacy-index",
        expect.objectContaining({ cache: "no-store" }),
      );
    });

    const user = userEvent.setup();
    const openDetail = screen.getAllByRole("button", {
      name: /view legacy index detail/i,
    })[0];
    expect(openDetail).toBeDefined();
    for (
      let attempt = 0;
      attempt < 20 && document.activeElement !== openDetail;
      attempt += 1
    ) {
      await user.tab();
    }
    expect(openDetail).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Legacy snapshots")).toBeInTheDocument();
    expect(screen.getByText("snap-read-only")).toBeInTheDocument();
    expect(screen.getByText("snap-bad")).toBeInTheDocument();
    expect(screen.getByText("Legacy runs")).toBeInTheDocument();
    expect(screen.getByText("ti-workbench-legacy")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("corrupt JSON");
  });
});
