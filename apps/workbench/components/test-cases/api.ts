/**
 * Typed fetch helpers for the persisted test-case READ endpoints.
 *
 * WHY a discriminated `ApiResult` instead of throwing or resolving with an
 * empty success on failure: this is the storage-team pattern (Copilot review
 * pattern 4 on Epic #48). A failed fetch must never appear to the caller as
 * a successful empty list, because empty-on-failure renders the same as
 * empty-on-success and silently hides repository outages from the operator.
 *
 * Mutation helpers (POST) live in `./api-mutations`.
 */
import type {
  PersistedTestCaseDetail,
  TestCaseSummary,
  TestCaseVersionRecord,
} from "@/lib/server/storage/types";
import {
  fallbackError,
  isRecord,
  isStringArray,
  readErrorBody,
  type ApiError,
  type ApiResult,
} from "./api-internal";

export type { ApiError, ApiResult } from "./api-internal";

interface ListEnvelope {
  readonly testCases?: unknown;
}

const summariesFromEnvelope = (raw: unknown): readonly TestCaseSummary[] => {
  if (!isRecord(raw)) return [];
  const { testCases } = raw as ListEnvelope;
  if (!Array.isArray(testCases)) return [];
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
      !isRecord(payload.currentVersion) ||
      !Array.isArray(payload.currentVersion.traceLinks) ||
      !Array.isArray(payload.currentVersion.steps) ||
      !Array.isArray(payload.currentVersion.preconditions) ||
      !Array.isArray(payload.currentVersion.testData) ||
      !Array.isArray(payload.currentVersion.tags)
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
    return { ok: true, value: payload as unknown as PersistedTestCaseDetail };
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

export type ListVersionsResult =
  | { readonly ok: true; readonly versions: readonly TestCaseVersionRecord[] }
  | { readonly ok: false; readonly error: ApiError };

export async function listTestCaseVersions(
  caseId: string,
): Promise<ListVersionsResult> {
  try {
    const response = await fetch(
      `/api/workbench/test-cases/${encodeURIComponent(caseId)}/versions`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      return {
        ok: false,
        error: await readErrorBody(response, "Could not load version history."),
      };
    }
    const payload = (await response.json().catch(() => undefined)) as unknown;
    if (!isRecord(payload) || !Array.isArray(payload.versions)) {
      return {
        ok: false,
        error: fallbackError(
          response.status,
          "Malformed version list response.",
        ),
      };
    }
    return {
      ok: true,
      versions: payload.versions as unknown as TestCaseVersionRecord[],
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        status: 0,
        code: "WORKBENCH_TEST_CASE_VERSIONS_NETWORK_ERROR",
        message:
          error instanceof Error ? error.message : "Network request failed.",
      },
    };
  }
}

export type GetVersionResult =
  | { readonly ok: true; readonly value: TestCaseVersionRecord }
  | { readonly ok: false; readonly error: ApiError };

export async function getTestCaseVersion(
  caseId: string,
  versionId: string,
): Promise<GetVersionResult> {
  const listResult = await listTestCaseVersions(caseId);
  if (!listResult.ok) return { ok: false, error: listResult.error };
  const found = listResult.versions.find((v) => v.id === versionId);
  if (found === undefined) {
    return {
      ok: false,
      error: fallbackError(404, `Version ${versionId} not found.`),
    };
  }
  return { ok: true, value: found };
}
