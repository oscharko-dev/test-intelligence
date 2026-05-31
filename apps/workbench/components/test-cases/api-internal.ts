/**
 * Shared internals for the test-case fetch helpers.
 * Exported for use by `api.ts` (reads) and `api-mutations.ts` (writes) only.
 */

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

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

export const fallbackError = (status: number, fallback: string): ApiError => ({
  status,
  code:
    status === 404
      ? "WORKBENCH_TEST_CASE_NOT_FOUND"
      : "WORKBENCH_TEST_CASE_REQUEST_FAILED",
  message: fallback,
});

export const readErrorBody = async (
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
    // No JSON body, or malformed — fall through to synthesized error.
  }
  return fallbackError(response.status, fallback);
};
