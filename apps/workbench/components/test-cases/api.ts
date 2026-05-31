/**
 * Typed fetch helpers for the persisted test-case endpoints.
 *
 * WHY a discriminated `ApiResult` instead of throwing or resolving with an
 * empty success on failure: this is the storage-team pattern (Copilot review
 * pattern 4 on Epic #48). A failed fetch must never appear to the caller as
 * a successful empty list, because empty-on-failure renders the same as
 * empty-on-success and silently hides repository outages from the operator.
 */
import type {
  PersistedTestCaseDetail,
  TestCaseSummary,
} from "@/lib/server/storage/types";

export interface ApiError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiError };

interface ServerErrorEnvelope {
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

interface ListEnvelope {
  readonly testCases?: unknown;
}

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fallbackError = (status: number, fallback: string): ApiError => ({
  status,
  code:
    status === 404
      ? "WORKBENCH_TEST_CASE_NOT_FOUND"
      : "WORKBENCH_TEST_CASE_REQUEST_FAILED",
  message: fallback,
});

const readErrorBody = async (
  response: Response,
  fallback: string,
): Promise<ApiError> => {
  try {
    const body = (await response.json()) as ServerErrorEnvelope;
    const code = body.error?.code;
    const message = body.error?.message;
    if (typeof code === "string" && typeof message === "string") {
      return { status: response.status, code, message };
    }
  } catch {
    // No JSON body, or malformed — fall through to the synthesized error.
  }
  return fallbackError(response.status, fallback);
};

const summariesFromEnvelope = (raw: unknown): readonly TestCaseSummary[] => {
  if (!isRecord(raw)) return [];
  const { testCases } = raw as ListEnvelope;
  if (!Array.isArray(testCases)) return [];
  // WHY: trust the server contract for the row shape, but defend against
  // missing array fields so a malformed row never throws inside `.map`.
  return testCases.map((entry): TestCaseSummary => {
    const source = isRecord(entry) ? entry : {};
    return {
      id: String(source.id ?? ""),
      tenantScope: String(source.tenantScope ?? ""),
      createdAt: String(source.createdAt ?? ""),
      updatedAt: String(source.updatedAt ?? ""),
      sourceRunId: String(source.sourceRunId ?? ""),
      sourceGeneratedSeedId: String(source.sourceGeneratedSeedId ?? ""),
      sourceTestCaseId: String(source.sourceTestCaseId ?? ""),
      currentVersionId: String(source.currentVersionId ?? ""),
      status:
        source.status === "reviewed" || source.status === "approved"
          ? source.status
          : "draft",
      title: String(source.title ?? ""),
      priority: String(source.priority ?? ""),
      risk: String(source.risk ?? ""),
      tags: isStringArray(source.tags) ? source.tags : [],
      versionStatus: String(source.versionStatus ?? ""),
      snapshotIds: isStringArray(source.snapshotIds) ? source.snapshotIds : [],
      traceLinkKinds: isStringArray(source.traceLinkKinds)
        ? (source.traceLinkKinds.filter(
            (kind): kind is TestCaseSummary["traceLinkKinds"][number] =>
              kind === "run" ||
              kind === "snapshot" ||
              kind === "figma-node" ||
              kind === "scope-basket",
          ) as TestCaseSummary["traceLinkKinds"])
        : [],
    };
  });
};

export interface ListTestCasesOptions {
  readonly runId?: string;
}

export async function listTestCases(
  options: ListTestCasesOptions = {},
): Promise<ApiResult<readonly TestCaseSummary[]>> {
  const runId =
    options.runId !== undefined && options.runId.length > 0
      ? options.runId
      : undefined;
  const query =
    runId !== undefined ? `?runId=${encodeURIComponent(runId)}` : "";
  try {
    const response = await fetch(`/api/workbench/test-cases${query}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ok: false,
        error: await readErrorBody(response, "Test case list failed."),
      };
    }
    const payload = (await response.json().catch(() => undefined)) as unknown;
    return { ok: true, value: summariesFromEnvelope(payload) };
  } catch (error) {
    return {
      ok: false,
      error: {
        status: 0,
        code: "WORKBENCH_TEST_CASE_LIST_NETWORK_ERROR",
        message:
          error instanceof Error ? error.message : "Network request failed.",
      },
    };
  }
}

export async function getTestCaseDetail(
  caseId: string,
): Promise<ApiResult<PersistedTestCaseDetail>> {
  if (caseId.length === 0) {
    return {
      ok: false,
      error: {
        status: 400,
        code: "WORKBENCH_TEST_CASE_INVALID_ID",
        message: "Missing test case id.",
      },
    };
  }
  try {
    const response = await fetch(
      `/api/workbench/test-cases/${encodeURIComponent(caseId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      return {
        ok: false,
        error: await readErrorBody(response, "Test case detail failed."),
      };
    }
    const payload = (await response.json().catch(() => undefined)) as unknown;
    if (
      !isRecord(payload) ||
      !isRecord(payload.testCase) ||
      !isRecord(payload.currentVersion)
    ) {
      return {
        ok: false,
        error: {
          status: response.status,
          code: "WORKBENCH_TEST_CASE_MALFORMED",
          message: "Test case detail response was malformed.",
        },
      };
    }
    return {
      ok: true,
      value: payload as unknown as PersistedTestCaseDetail,
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        status: 0,
        code: "WORKBENCH_TEST_CASE_READ_NETWORK_ERROR",
        message:
          error instanceof Error ? error.message : "Network request failed.",
      },
    };
  }
}
