import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestCaseStatusControl } from "@/components/test-cases/TestCaseStatusControl";
import type {
  PersistedTestCaseDetail,
  TestCaseLifecycleStatus,
} from "@/lib/server/storage/types";

const SHA = "0".repeat(64);

const makeDetail = (
  status: TestCaseLifecycleStatus,
): PersistedTestCaseDetail => ({
  testCase: {
    id: "tc-1",
    tenantScope: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    sourceRunId: "run-1",
    sourceGeneratedSeedId: "seed-1",
    sourceTestCaseId: "src-1",
    currentVersionId: "ver-1",
    status,
  },
  currentVersion: {
    id: "ver-1",
    testCaseId: "tc-1",
    tenantScope: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    versionIndex: 1,
    source: "manual",
    title: "x",
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
  },
});

interface RequestCapture {
  readonly url: string;
  readonly body: unknown;
}

const installStatusFetch = (
  responder: (request: RequestCapture) => Promise<Response> | Response,
): RequestCapture[] => {
  const captured: RequestCapture[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const body =
      rawBody !== undefined ? (JSON.parse(rawBody) as unknown) : undefined;
    const entry: RequestCapture = { url, body };
    captured.push(entry);
    return await responder(entry);
  });
  vi.stubGlobal("fetch", fn);
  return captured;
};

describe("TestCaseStatusControl", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders 'Mark as Reviewed' and 'Mark as Approved' buttons for a draft case", () => {
    render(
      <TestCaseStatusControl
        status="draft"
        caseId="tc-1"
        onTransition={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Mark as Reviewed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark as Approved" }),
    ).toBeInTheDocument();
  });

  it("renders only 'Mark as Approved' for a reviewed case", () => {
    render(
      <TestCaseStatusControl
        status="reviewed"
        caseId="tc-1"
        onTransition={() => undefined}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Mark as Reviewed" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark as Approved" }),
    ).toBeInTheDocument();
  });

  it("renders no transition buttons for an approved case (terminal)", () => {
    render(
      <TestCaseStatusControl
        status="approved"
        caseId="tc-1"
        onTransition={() => undefined}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Mark as/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/No further transitions/i)).toBeInTheDocument();
  });

  it("POSTs the correct body and calls onTransition on success", async () => {
    const detailAfter = makeDetail("reviewed");
    const captured = installStatusFetch(async () =>
      Response.json({ detail: detailAfter }),
    );
    const onTransition = vi.fn();
    render(
      <TestCaseStatusControl
        status="draft"
        caseId="tc-1"
        onTransition={onTransition}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Mark as Reviewed" }),
    );
    await userEvent.type(
      screen.getByLabelText(/Change reason for status transition/i),
      "ready for review",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Confirm Mark as Reviewed/i }),
    );

    await waitFor(() => {
      expect(onTransition).toHaveBeenCalledWith(detailAfter);
    });
    expect(captured[0]?.url).toBe("/api/workbench/test-cases/tc-1/status");
    expect(captured[0]?.body).toEqual({
      newStatus: "reviewed",
      changeReason: "ready for review",
    });
  });

  it("renders an inline error when the server returns 422 INVALID_STATUS_TRANSITION", async () => {
    installStatusFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: "INVALID_STATUS_TRANSITION",
            currentStatus: "draft",
            newStatus: "reviewed",
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        ),
    );
    render(
      <TestCaseStatusControl
        status="draft"
        caseId="tc-1"
        onTransition={() => undefined}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Mark as Reviewed" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Confirm Mark as Reviewed/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Status transition not allowed/i,
      );
    });
  });

  it("omits changeReason from the request body when the operator leaves it blank", async () => {
    const captured = installStatusFetch(async () =>
      Response.json({ detail: makeDetail("reviewed") }),
    );
    render(
      <TestCaseStatusControl
        status="draft"
        caseId="tc-1"
        onTransition={() => undefined}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Mark as Reviewed" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Confirm Mark as Reviewed/i }),
    );

    await waitFor(() => {
      expect(captured).toHaveLength(1);
    });
    expect(captured[0]?.body).toEqual({ newStatus: "reviewed" });
  });
});
