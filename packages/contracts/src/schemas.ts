/**
 * Zod request-body schemas for the `@oscharko-dev/test-intelligence` HTTP API.
 *
 * This module establishes the conservative request foundation aligned to the
 * `GeneratedTestCase` contract. The standalone `/api/v1/` HTTP API (Issue #21)
 * extends this surface; Issue #6 only establishes the foundation.
 */

import * as z from "zod";

/**
 * Runtime source-of-truth list of generation modes accepted by the
 * test-case generation request. Keep this array and the inferred `mode`
 * type in lockstep; `submit-mode-parity.test.ts` enforces agreement.
 *
 * - `deterministic_llm` — a productive run that calls the model gateway.
 * - `offline_eval` — a replay/evaluation run with no live model call.
 */
export const ALLOWED_GENERATE_TEST_CASE_MODES = [
  "deterministic_llm",
  "offline_eval",
] as const;

/** Generation mode accepted by {@link GenerateTestCasesRequestSchema}. */
export type GenerateTestCaseMode =
  (typeof ALLOWED_GENERATE_TEST_CASE_MODES)[number];

/**
 * Validated body of a request to start a test-case generation job. This is
 * the irreducible input set: the upstream job whose sources are read, and
 * the generation mode.
 */
export interface GenerateTestCasesRequest {
  /** Branded-ID-shaped identifier of the upstream job to generate from. */
  sourceJobId: string;
  /** Generation mode for the run. */
  mode: GenerateTestCaseMode;
}

/**
 * Request body schema to start a test-case generation job. Unknown
 * properties are rejected.
 */
export const GenerateTestCasesRequestSchema: z.ZodType<GenerateTestCasesRequest> =
  z.strictObject({
    sourceJobId: z.string().min(1),
    mode: z.enum(ALLOWED_GENERATE_TEST_CASE_MODES),
  });

/** A single flattened validation issue with a dotted path to the field. */
export interface FormattedZodIssue {
  path: string;
  message: string;
}

/**
 * Flattens a {@link z.ZodError} into an array of `{ path, message }` issues.
 *
 * The path is a dot-joined property chain (`""` for a root-level issue),
 * suitable for surfacing to an HTTP client without leaking internals.
 */
export const formatZodError = (error: z.ZodError): FormattedZodIssue[] =>
  error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join("."),
    message: issue.message,
  }));
