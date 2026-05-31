import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestCaseDetail, listTestCases } from "@/components/test-cases/api";

interface MockFetch {
  readonly fn: ReturnType<typeof vi.fn>;
}

const installFetch = (
  impl: (input: string) => Promise<Response>,
): MockFetch => {
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
  return { fn };
};

describe("test-cases api helpers", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an ok result with parsed summaries on 200", async () => {
    installFetch(async () =>
      Response.json({
        testCases: [
          {
            id: "tc-1",
            tenantScope: "t",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            sourceRunId: "run-1",
            sourceGeneratedSeedId: "seed-1",
            sourceTestCaseId: "src-1",
            currentVersionId: "ver-1",
            status: "draft",
            title: "Hello",
            priority: "P1",
            risk: "low",
            tags: ["L1"],
            versionStatus: "generated",
            snapshotIds: [],
            traceLinkKinds: ["run"],
          },
        ],
      }),
    );

    const result = await listTestCases();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.title).toBe("Hello");
    expect(result.value[0]?.traceLinkKinds).toEqual(["run"]);
  });

  it("appends ?runId=… exactly once", async () => {
    const { fn } = installFetch(async () => Response.json({ testCases: [] }));
    await listTestCases({ runId: "r1" });
    const call = fn.mock.calls[0]?.[0];
    expect(typeof call).toBe("string");
    expect(call).toBe("/api/workbench/test-cases?runId=r1");
  });

  it("treats an empty runId as undefined", async () => {
    const { fn } = installFetch(async () => Response.json({ testCases: [] }));
    await listTestCases({ runId: "" });
    expect(fn.mock.calls[0]?.[0]).toBe("/api/workbench/test-cases");
  });

  it("returns ok:false with parsed envelope on 404", async () => {
    installFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "WORKBENCH_TEST_CASE_NOT_FOUND", message: "Gone" },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    );
    const result = await getTestCaseDetail("absent");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.status).toBe(404);
    expect(result.error.code).toBe("WORKBENCH_TEST_CASE_NOT_FOUND");
    expect(result.error.message).toBe("Gone");
  });

  it("returns ok:false with a synthesized envelope on 500 with no body", async () => {
    installFetch(async () => new Response(null, { status: 500 }));
    const result = await listTestCases();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.status).toBe(500);
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it("returns ok:true for a detail 200 response with envelope", async () => {
    installFetch(async () =>
      Response.json({
        testCase: {
          id: "tc-1",
          tenantScope: "t",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          sourceRunId: "run-1",
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
          title: "Hello",
          objective: "do it",
          preconditions: [],
          steps: [],
          testData: [],
          priority: "P1",
          risk: "low",
          tags: [],
          status: "generated",
          content: {
            sha256: "0".repeat(64),
            byteSize: 0,
            storageRef: "artifacts/00/000000",
          },
          traceLinks: [],
        },
      }),
    );

    const result = await getTestCaseDetail("tc-1");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.testCase.id).toBe("tc-1");
    expect(result.value.currentVersion.title).toBe("Hello");
  });

  it("returns ok:false on a network error without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    const result = await listTestCases();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("WORKBENCH_TEST_CASE_LIST_NETWORK_ERROR");
  });
});
