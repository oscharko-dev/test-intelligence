/**
 * Stable error-envelope codes for every standalone HTTP route.
 *
 * The string union is intentionally narrow: callers MUST emit one of these
 * codes so the operator-facing CLI, OpenAPI document, and audit log share a
 * single closed enumeration. Adding a code requires:
 *   1. extending {@link TestIntelligenceErrorCode},
 *   2. updating the OpenAPI route metadata,
 *   3. covering the new code in a route test.
 */

export type TestIntelligenceErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN_REQUEST_ORIGIN"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "FEATURE_GATE_DISABLED"
  | "AUTHENTICATION_UNAVAILABLE"
  | "LLM_GATEWAY_UNCONFIGURED"
  | "LLM_GATEWAY_FAILED"
  | "BEARER_TOKEN_MISSING"
  | "VERIFICATION_FAILED"
  | "INTERNAL_ERROR";

export interface TestIntelligenceErrorEnvelope {
  readonly error: TestIntelligenceErrorCode;
  readonly message: string;
}

/**
 * Map an error code to the canonical HTTP status. Routes that need to deviate
 * (e.g. a `VERIFICATION_FAILED` returned with 200 when the operator asked for
 * `report-only`) construct the envelope manually.
 */
export const statusForErrorCode = (code: TestIntelligenceErrorCode): number => {
  switch (code) {
    case "BAD_REQUEST":
      return 400;
    case "UNAUTHORIZED":
    case "BEARER_TOKEN_MISSING":
      return 401;
    case "FORBIDDEN_REQUEST_ORIGIN":
    case "FEATURE_GATE_DISABLED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "METHOD_NOT_ALLOWED":
      return 405;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    case "UNSUPPORTED_MEDIA_TYPE":
      return 415;
    case "RATE_LIMITED":
      return 429;
    case "INTERNAL_ERROR":
    case "VERIFICATION_FAILED":
      return 500;
    case "AUTHENTICATION_UNAVAILABLE":
    case "LLM_GATEWAY_UNCONFIGURED":
    case "LLM_GATEWAY_FAILED":
      return 503;
  }
};
