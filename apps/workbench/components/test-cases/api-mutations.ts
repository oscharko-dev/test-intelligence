/**
 * Mutation fetch helpers for persisted test-case lifecycle changes.
 * Reads live in `./api`.
 */
import type {
  PersistedTestCaseDetail,
  TestCaseLifecycleStatus,
} from "@/lib/server/storage/types";
import type { PlausibilityWarning } from "@/lib/server/test-case-plausibility";
import {
  fallbackError,
  isRecord,
  readErrorBody,
  type ApiError,
} from "./api-internal";
import type { TestCaseValidationError } from "./test-case-draft-validation";

export type AppendVersionResult =
  | {
      readonly ok: true;
      readonly detail: PersistedTestCaseDetail;
      readonly warnings: readonly PlausibilityWarning[];
    }
  | {
      readonly ok: false;
      readonly kind: "validation";
      readonly errors: readonly TestCaseValidationError[];
    }
  | { readonly ok: false; readonly kind: "error"; readonly error: ApiError };

export interface AppendVersionBody {
  readonly title: string;
  readonly objective: string;
  readonly preconditions: readonly string[];
  readonly steps: readonly {
    readonly action: string;
    readonly expected: string;
  }[];
  readonly testData: readonly string[];
  readonly priority: string;
  readonly risk: string;
  readonly tags: readonly string[];
  readonly status: string;
  readonly description?: string;
  readonly traceTargets: readonly {
    readonly targetKind: "run" | "snapshot" | "figma-node" | "scope-basket";
    readonly targetId: string;
  }[];
  readonly changeReason?: string;
}

export async function appendTestCaseVersion(
  caseId: string,
  body: AppendVersionBody,
): Promise<AppendVersionResult> {
  try {
    const response = await fetch(
      `/api/workbench/test-cases/${encodeURIComponent(caseId)}/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    if (response.status === 422) {
      const payload = (await response.json().catch(() => ({}))) as unknown;
      const errors =
        isRecord(payload) && Array.isArray(payload.errors)
          ? (payload.errors as unknown as TestCaseValidationError[])
          : [];
      return { ok: false, kind: "validation", errors };
    }
    if (!response.ok) {
      return {
        ok: false,
        kind: "error",
        error: await readErrorBody(response, "Could not save version."),
      };
    }
    const payload = (await response.json().catch(() => undefined)) as unknown;
    if (!isRecord(payload) || !isRecord(payload.detail)) {
      return {
        ok: false,
        kind: "error",
        error: fallbackError(response.status, "Malformed save response."),
      };
    }
    const warnings = Array.isArray(payload.warnings)
      ? (payload.warnings as PlausibilityWarning[])
      : [];
    return {
      ok: true,
      detail: payload.detail as unknown as PersistedTestCaseDetail,
      warnings,
    };
  } catch (error) {
    return {
      ok: false,
      kind: "error",
      error: {
        status: 0,
        code: "WORKBENCH_TEST_CASE_APPEND_NETWORK_ERROR",
        message:
          error instanceof Error ? error.message : "Network request failed.",
      },
    };
  }
}

export type TransitionStatusResult =
  | { readonly ok: true; readonly detail: PersistedTestCaseDetail }
  | {
      readonly ok: false;
      readonly kind: "invalid-transition";
      readonly message: string;
    }
  | { readonly ok: false; readonly kind: "error"; readonly error: ApiError };

export async function transitionTestCaseStatus(
  caseId: string,
  newStatus: TestCaseLifecycleStatus,
  changeReason?: string,
): Promise<TransitionStatusResult> {
  try {
    const response = await fetch(
      `/api/workbench/test-cases/${encodeURIComponent(caseId)}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          changeReason !== undefined
            ? { newStatus, changeReason }
            : { newStatus },
        ),
        cache: "no-store",
      },
    );
    if (response.status === 422) {
      const payload = (await response.json().catch(() => ({}))) as unknown;
      const errCode = isRecord(payload)
        ? String(payload.error ?? "INVALID_STATUS_TRANSITION")
        : "INVALID_STATUS_TRANSITION";
      return {
        ok: false,
        kind: "invalid-transition",
        message: `Status transition not allowed (${errCode}).`,
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        kind: "error",
        error: await readErrorBody(response, "Status transition failed."),
      };
    }
    const payload = (await response.json().catch(() => undefined)) as unknown;
    if (!isRecord(payload) || !isRecord(payload.detail)) {
      return {
        ok: false,
        kind: "error",
        error: fallbackError(response.status, "Malformed status response."),
      };
    }
    return {
      ok: true,
      detail: payload.detail as unknown as PersistedTestCaseDetail,
    };
  } catch (error) {
    return {
      ok: false,
      kind: "error",
      error: {
        status: 0,
        code: "WORKBENCH_TEST_CASE_STATUS_NETWORK_ERROR",
        message:
          error instanceof Error ? error.message : "Network request failed.",
      },
    };
  }
}
