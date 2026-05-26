/**
 * Standalone Test Intelligence HTTP runtime constants.
 *
 * This module is the single source of truth for runtime defaults consumed by
 * `packages/server/src/server.ts`, `packages/server/src/request-handler.ts`,
 * and the operator CLI (#20). Operator-facing environment-variable names use
 * the Test Intelligence namespace.
 *
 * `DEFAULT_OUTPUT_ROOT` persists per-job artifacts under `.test-intelligence`
 * to match the product name.
 */

import {
  TEST_INTELLIGENCE_ENV,
  TEST_INTELLIGENCE_MULTISOURCE_ENV,
} from "@oscharko-dev/ti-contracts";

/** Default bind host for the standalone server. Loopback-only by default. */
export const DEFAULT_HOST: string = "127.0.0.1";

/** Default TCP port for the standalone server. */
export const DEFAULT_PORT: number = 1983;

/** Default per-job artefact root directory (operator-overridable). */
export const DEFAULT_OUTPUT_ROOT: string = ".test-intelligence";

/** Default per-IP+route rate limit (requests per minute). */
export const DEFAULT_RATE_LIMIT_PER_MINUTE: number = 60;

/** Width of the rate-limit fixed window (ms). */
export const RATE_LIMIT_WINDOW_MS: number = 60_000;

/**
 * Maximum JSON request body size for normal write routes (1 MiB). Larger
 * bodies fail with `413 PAYLOAD_TOO_LARGE` before any parsing.
 */
export const MAX_REQUEST_BODY_BYTES: number = 1_048_576;

/**
 * Maximum body size for the run-submission route which carries an inline
 * Figma node tree (8 MiB).
 */
export const MAX_SUBMIT_BODY_BYTES: number = 8_388_608;

/** Environment-variable name controlling HSTS opt-in. */
export const ENABLE_HSTS_ENV: string = "TEST_INTELLIGENCE_ENABLE_HSTS";

/** Default `Strict-Transport-Security` header when HSTS is enabled. */
export const DEFAULT_STRICT_TRANSPORT_SECURITY: string = "max-age=31536000";

/**
 * Restrictive default Content-Security-Policy applied to every response.
 * The standalone server is API-only, so `default-src 'self'` and
 * `object-src 'none'` are safe.
 */
export const DEFAULT_CONTENT_SECURITY_POLICY: string =
  "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/** Public API route prefix for every TI HTTP endpoint. */
export const API_ROUTE_PREFIX: string = "/api/v1";

/**
 * Resolve the boolean test-intelligence startup gate from the environment.
 * The Test Intelligence env var is the only supported startup gate.
 */
export const resolveTestIntelligenceEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  return parseBooleanEnv(env[TEST_INTELLIGENCE_ENV]);
};

/**
 * Resolve the nested multi-source ingestion gate (#1431). Callers MUST
 * verify {@link resolveTestIntelligenceEnabled} before consulting this
 * resolver.
 */
export const resolveTestIntelligenceMultiSourceEnvEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  return parseBooleanEnv(env[TEST_INTELLIGENCE_MULTISOURCE_ENV]);
};

/**
 * Resolve the `Strict-Transport-Security` value for the current process.
 * Returns `undefined` when HSTS is not requested (the default — the
 * standalone server is loopback-only in the typical configuration and
 * setting HSTS on `http://127.0.0.1` would be a misconfiguration).
 */
export const resolveStrictTransportSecurity = (
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => {
  const raw = env[ENABLE_HSTS_ENV];
  if (raw === undefined) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "" ||
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return undefined;
  }
  return DEFAULT_STRICT_TRANSPORT_SECURITY;
};

const parseBooleanEnv = (raw: string | undefined): boolean => {
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
};
