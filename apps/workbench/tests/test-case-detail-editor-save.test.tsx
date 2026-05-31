import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestCaseDetailEditor } from "@/components/test-cases/TestCaseDetailEditor";
import type {
  PersistedTestCaseDetail,
  TestCaseVersionRecord,
} from "@/lib/server/storage/types";

const SHA = "0".repeat(64);

const baseVersion = (
  overrides?: Partial<TestCaseVersionRecord>,
): TestCaseVersionRecord => ({
  id: "ver-1",
  testCaseId: "tc-1",
  tenantScope: "t",
  createdAt: "2026-01-01T00:00:00.000Z",
  versionIndex: 1,
  source: "generated",
  title: "Onboarding happy path",
  objective: "Validate onboarding",
  preconditions: ["pre"],
  steps: [{ action: "open", expected: "wizard appears" }],
  testData: ["sample"],
  priority: "P1",
  risk: "high",
  tags: ["L1"],
  status: "draft",
  description: "desc",
  content: {
    sha256: SHA,
    byteSize: 0,
    storageRef: `artifacts/00/${SHA}`,
  },
  traceLinks: [
    {
      id: "tl-1",
      testCaseVersionId: "ver-1",
      tenantScope: "t",
      createdAt: "2026-01-01T00:00:00.000Z",
      targetKind: "run",
      targetId: "run-12345",
    },
  ],
  ...overrides,
});

const makeDetail = (
  version: TestCaseVersionRecord,
): PersistedTestCaseDetail => ({
  testCase: {
    id: "tc-1",
    tenantScope: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    sourceRunId: "run-1",
    sourceGeneratedSeedId: "seed-1",
    sourceTestCaseId: "src-1",
    currentVersionId: version.id,
    status: "draft",
  },
  currentVersion: version,
});

interface RequestCapture {
  readonly url: string;
  readonly body: unknown;
}

const installFetch = (
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

const clickEdit = async (): Promise<void> => {
  await userEvent.click(
    screen.getByRole("button", { name: /Edit this test case/i }),
  );
};

describe("TestCaseDetailEditor save flow", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not show an Edit button when the version is not the current version", () => {
    render(
      <TestCaseDetailEditor
        version={baseVersion()}
        caseId="tc-1"
        isCurrentVersion={false}
        onSaved={() => undefined}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Edit this test case/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Viewing a previous version/i)).toBeInTheDocument();
  });

  it("POSTs the form body and invokes onSaved with the returned detail", async () => {
    const after = baseVersion({ id: "ver-2", title: "Onboarding edited" });
    const captured = installFetch(async () =>
      Response.json({ detail: makeDetail(after), warnings: [] }),
    );
    const onSaved = vi.fn();
    render(
      <TestCaseDetailEditor
        version={baseVersion()}
        caseId="tc-1"
        isCurrentVersion={true}
        onSaved={onSaved}
      />,
    );

    await clickEdit();
    // Edit the title to ensure body reflects current draft.
    const titleField = screen.getByLabelText(/^Title/);
    await userEvent.clear(titleField);
    await userEvent.type(titleField, "New title");

    await userEvent.click(
      screen.getByRole("button", { name: /Save new version/i }),
    );

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(makeDetail(after));
    });
    expect(captured[0]?.url).toBe("/api/workbench/test-cases/tc-1/versions");
    const body = captured[0]?.body as Record<string, unknown>;
    expect(body.title).toBe("New title");
    expect(body.status).toBe("draft");
    expect(Array.isArray(body.steps)).toBe(true);
    expect(Array.isArray(body.traceTargets)).toBe(true);
    // After a successful save we leave edit mode and the Edit button reappears.
    expect(
      screen.queryByRole("button", { name: /Save new version/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Edit this test case/i }),
    ).toBeInTheDocument();
  });

  it("disables save and renders TITLE_REQUIRED when the title is blank", async () => {
    installFetch(async () => Response.json({}));
    render(
      <TestCaseDetailEditor
        version={baseVersion()}
        caseId="tc-1"
        isCurrentVersion={true}
        onSaved={() => undefined}
      />,
    );
    await clickEdit();

    const titleField = screen.getByLabelText(/^Title/);
    await userEvent.clear(titleField);

    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Save new version/i }),
    ).toBeDisabled();
  });

  it("disables save and renders TRACE_LINK_REQUIRED when all trace links are removed", async () => {
    installFetch(async () => Response.json({}));
    render(
      <TestCaseDetailEditor
        version={baseVersion()}
        caseId="tc-1"
        isCurrentVersion={true}
        onSaved={() => undefined}
      />,
    );
    await clickEdit();

    await userEvent.click(
      screen.getByRole("button", { name: /Remove trace link run run-12345/i }),
    );

    expect(
      screen.getByText("At least one trace link is required."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Save new version/i }),
    ).toBeDisabled();
  });

  it("renders STEP_ACTION_REQUIRED for the right step index when action is blank", async () => {
    installFetch(async () => Response.json({}));
    render(
      <TestCaseDetailEditor
        version={baseVersion()}
        caseId="tc-1"
        isCurrentVersion={true}
        onSaved={() => undefined}
      />,
    );
    await clickEdit();

    const action1 = screen.getByLabelText("Step 1 action");
    await userEvent.clear(action1);

    expect(screen.getByText("Step action is required.")).toBeInTheDocument();
    expect(action1).toHaveAttribute("aria-invalid", "true");
  });

  it("renders STEP_EXPECTED_REQUIRED when expected is blank", async () => {
    installFetch(async () => Response.json({}));
    render(
      <TestCaseDetailEditor
        version={baseVersion()}
        caseId="tc-1"
        isCurrentVersion={true}
        onSaved={() => undefined}
      />,
    );
    await clickEdit();

    const expected1 = screen.getByLabelText("Step 1 expected result");
    await userEvent.clear(expected1);

    expect(
      screen.getByText("Step expected result is required."),
    ).toBeInTheDocument();
    expect(expected1).toHaveAttribute("aria-invalid", "true");
  });

  it("adds and removes steps via the toolbar buttons", async () => {
    installFetch(async () => Response.json({}));
    render(
      <TestCaseDetailEditor
        version={baseVersion()}
        caseId="tc-1"
        isCurrentVersion={true}
        onSaved={() => undefined}
      />,
    );
    await clickEdit();

    expect(screen.getByLabelText("Step 1 action")).toBeInTheDocument();
    expect(screen.queryByLabelText("Step 2 action")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Add step$/ }));
    expect(screen.getByLabelText("Step 2 action")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /^Remove step 2$/ }),
    );
    expect(screen.queryByLabelText("Step 2 action")).not.toBeInTheDocument();
  });

  it("persists the changeReason in the request body when provided", async () => {
    const captured = installFetch(async () =>
      Response.json({ detail: makeDetail(baseVersion()), warnings: [] }),
    );
    render(
      <TestCaseDetailEditor
        version={baseVersion()}
        caseId="tc-1"
        isCurrentVersion={true}
        onSaved={() => undefined}
      />,
    );
    await clickEdit();

    await userEvent.type(
      screen.getByLabelText(/Change reason for this version/i),
      "Fixed typo",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Save new version/i }),
    );

    await waitFor(() => {
      expect(captured).toHaveLength(1);
    });
    const body = captured[0]?.body as Record<string, unknown>;
    expect(body.changeReason).toBe("Fixed typo");
  });

  it("renders server-returned per-field errors when the response is 422", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                field: "title",
                code: "TITLE_REQUIRED",
                message: "Server says title required.",
              },
            ],
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        ),
    );
    render(
      <TestCaseDetailEditor
        version={baseVersion()}
        caseId="tc-1"
        isCurrentVersion={true}
        onSaved={() => undefined}
      />,
    );
    await clickEdit();

    await userEvent.click(
      screen.getByRole("button", { name: /Save new version/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Server says title required."),
      ).toBeInTheDocument();
    });
  });

  it("renders plausibility warnings as a non-blocking strip after a successful save", async () => {
    installFetch(async () =>
      Response.json({
        detail: makeDetail(baseVersion()),
        warnings: [
          {
            kind: "trace-target-missing",
            targetKind: "snapshot",
            targetId: "snap-missing",
            message: "Snapshot snap-missing not in catalog.",
          },
        ],
      }),
    );
    render(
      <TestCaseDetailEditor
        version={baseVersion()}
        caseId="tc-1"
        isCurrentVersion={true}
        onSaved={() => undefined}
      />,
    );
    await clickEdit();
    await userEvent.click(
      screen.getByRole("button", { name: /Save new version/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("Plausibility warnings")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Snapshot snap-missing not in catalog/),
    ).toBeInTheDocument();
  });

  it("Cancel discards edits and returns to the read-only view", async () => {
    installFetch(async () => Response.json({}));
    render(
      <TestCaseDetailEditor
        version={baseVersion()}
        caseId="tc-1"
        isCurrentVersion={true}
        onSaved={() => undefined}
      />,
    );
    await clickEdit();

    const titleField = screen.getByLabelText(/^Title/);
    await userEvent.clear(titleField);
    await userEvent.type(titleField, "Throwaway");
    expect(titleField).toHaveValue("Throwaway");

    await userEvent.click(
      screen.getByRole("button", { name: /Cancel editing/i }),
    );

    expect(
      screen.queryByRole("button", { name: /Save new version/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Edit this test case/i }),
    ).toBeInTheDocument();

    // Re-enter edit mode — draft is reset from props (Throwaway is gone).
    await clickEdit();
    expect(screen.queryByDisplayValue("Throwaway")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveValue(
      "Onboarding happy path",
    );
  });
});
