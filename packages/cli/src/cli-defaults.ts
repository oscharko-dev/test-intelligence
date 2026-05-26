/**
 * Shared defaults for the Test Intelligence CLI.
 *
 * Centralises operator-facing defaults that are referenced by multiple
 * command handlers. The values here are operator-facing (filesystem paths,
 * feature gate evaluation); wire-level identifiers used to coordinate with
 * external systems live in `packages/contracts/src/index.ts`.
 */

import { TEST_INTELLIGENCE_ENV } from "@oscharko-dev/ti-contracts";

/**
 * Default output root used when an operator does not pass `--output-root`.
 *
 * Mirrors the product namespace (`@oscharko-dev/test-intelligence`) so that
 * artifacts produced by the CLI live alongside other product-owned files in
 * an easy-to-recognise directory rather than under a tool-specific prefix.
 */
export const DEFAULT_OUTPUT_ROOT: string = ".test-intelligence";

/**
 * Feature gate for the Test Intelligence command surface.
 *
 * Returns `true` only when the operator has explicitly set the feature gate
 * environment variable {@link TEST_INTELLIGENCE_ENV} to a recognised truthy
 * value.
 *
 * Recognised truthy values are `"1"`, `"true"`, `"yes"`, and `"on"`, with
 * leading and trailing whitespace ignored and case-insensitive matching.
 * Every other value, including `undefined`, returns `false`.
 *
 * @param env - Environment map to consult. Defaults to `process.env`.
 * @returns `true` when the feature gate is enabled; `false` otherwise.
 */
export function resolveTestIntelligenceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[TEST_INTELLIGENCE_ENV];
  if (raw === undefined) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}
