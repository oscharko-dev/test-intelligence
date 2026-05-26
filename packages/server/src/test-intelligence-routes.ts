/**
 * Standalone Test Intelligence route parser.
 *
 * The parser maps `(method, pathname)` to a discriminated `Route` union
 * so the request handler dispatches by switch rather than chained `if`s.
 * No path component is interpreted before {@link isSafeIdSegment} accepts
 * it — the parser is the only place ID safety is enforced.
 *
 * Routes:
 *   GET    /healthz
 *   GET    /readyz
 *   GET    /openapi.json
 *   POST   /api/v1/jobs                                       (submit a run)
 *   GET    /api/v1/jobs/{jobId}                               (status)
 *   GET    /api/v1/jobs/{jobId}/events                        (SSE)
 *   POST   /api/v1/jobs/{jobId}/evidence/verify
 *   POST   /api/v1/jobs/{jobId}/audit-dossier/verify
 *   POST   /api/v1/jobs/{jobId}/provenance/verify
 *   POST   /api/v1/jobs/{jobId}/seal/verify
 *   GET    /api/v1/review/{jobId}                             (list / snapshot)
 *   POST   /api/v1/review/{jobId}/decision                    (write action)
 *   POST   /api/v1/tms/push
 *   POST   /api/v1/execution/pull
 *   POST   /api/v1/onboard
 *   POST   /api/v1/figma-export
 *   OPTIONS *                                                  (CORS preflight)
 */

import { API_ROUTE_PREFIX } from "./constants.js";
import { isSafeIdSegment, stripTrailingSlash } from "./route-params.js";

export type Route =
  | { readonly kind: "healthz" }
  | { readonly kind: "readyz" }
  | { readonly kind: "openapi" }
  | { readonly kind: "submit_job" }
  | { readonly kind: "job_status"; readonly jobId: string }
  | { readonly kind: "job_events"; readonly jobId: string }
  | { readonly kind: "verify_evidence"; readonly jobId: string }
  | { readonly kind: "verify_audit_dossier"; readonly jobId: string }
  | { readonly kind: "verify_provenance"; readonly jobId: string }
  | { readonly kind: "verify_seal"; readonly jobId: string }
  | { readonly kind: "review_snapshot"; readonly jobId: string }
  | { readonly kind: "review_decision"; readonly jobId: string }
  | { readonly kind: "tms_push" }
  | { readonly kind: "execution_pull" }
  | { readonly kind: "onboard" }
  | { readonly kind: "figma_export" }
  | { readonly kind: "cors_preflight" };

export type RouteParseFailureReason =
  | "unknown_route"
  | "method_not_allowed"
  | "unsafe_id_segment"
  | "empty_segment";

export type RouteParseResult =
  | { readonly ok: true; readonly route: Route }
  | {
      readonly ok: false;
      readonly reason: RouteParseFailureReason;
      readonly allowedMethods?: readonly string[];
    };

export const parseTestIntelligenceRoute = ({
  method,
  pathname,
}: {
  method: string;
  pathname: string;
}): RouteParseResult => {
  const upper = method.toUpperCase();
  if (upper === "OPTIONS") {
    return { ok: true, route: { kind: "cors_preflight" } };
  }

  const normalized = stripTrailingSlash(pathname);

  if (normalized === "/healthz") {
    return methodGuard(upper, "GET", { kind: "healthz" });
  }
  if (normalized === "/readyz") {
    return methodGuard(upper, "GET", { kind: "readyz" });
  }
  if (normalized === "/openapi.json") {
    return methodGuard(upper, "GET", { kind: "openapi" });
  }

  if (!normalized.startsWith(`${API_ROUTE_PREFIX}/`)) {
    return { ok: false, reason: "unknown_route" };
  }
  const rest = normalized.slice(API_ROUTE_PREFIX.length + 1);
  const segments = rest.split("/");
  return dispatchSegments(upper, segments);
};

const methodGuard = (
  method: string,
  allowed: string,
  route: Route,
): RouteParseResult => {
  if (method !== allowed) {
    return {
      ok: false,
      reason: "method_not_allowed",
      allowedMethods: [allowed],
    };
  }
  return { ok: true, route };
};

const dispatchSegments = (
  method: string,
  segments: readonly string[],
): RouteParseResult => {
  if (segments.length === 0 || segments[0] === "") {
    return { ok: false, reason: "unknown_route" };
  }
  const head = segments[0]!;
  const tail = segments.slice(1);
  switch (head) {
    case "jobs":
      return dispatchJobs(method, tail);
    case "review":
      return dispatchReview(method, tail);
    case "tms":
      return dispatchTms(method, tail);
    case "execution":
      return dispatchExecution(method, tail);
    case "onboard":
      return dispatchSingleton(method, tail, "POST", { kind: "onboard" });
    case "figma-export":
      return dispatchSingleton(method, tail, "POST", { kind: "figma_export" });
    default:
      return { ok: false, reason: "unknown_route" };
  }
};

const dispatchJobs = (
  method: string,
  tail: readonly string[],
): RouteParseResult => {
  if (tail.length === 0) {
    return methodGuard(method, "POST", { kind: "submit_job" });
  }
  const jobId = tail[0]!;
  if (jobId === "") {
    return { ok: false, reason: "empty_segment" };
  }
  if (!isSafeIdSegment(jobId)) {
    return { ok: false, reason: "unsafe_id_segment" };
  }
  if (tail.length === 1) {
    return methodGuard(method, "GET", { kind: "job_status", jobId });
  }
  if (tail.length === 2 && tail[1] === "events") {
    return methodGuard(method, "GET", { kind: "job_events", jobId });
  }
  if (tail.length === 3 && tail[2] === "verify") {
    return jobsVerifySubroute(method, jobId, tail[1]!);
  }
  return { ok: false, reason: "unknown_route" };
};

const jobsVerifySubroute = (
  method: string,
  jobId: string,
  subject: string,
): RouteParseResult => {
  switch (subject) {
    case "evidence":
      return methodGuard(method, "POST", { kind: "verify_evidence", jobId });
    case "audit-dossier":
      return methodGuard(method, "POST", {
        kind: "verify_audit_dossier",
        jobId,
      });
    case "provenance":
      return methodGuard(method, "POST", { kind: "verify_provenance", jobId });
    case "seal":
      return methodGuard(method, "POST", { kind: "verify_seal", jobId });
    default:
      return { ok: false, reason: "unknown_route" };
  }
};

const dispatchReview = (
  method: string,
  tail: readonly string[],
): RouteParseResult => {
  if (tail.length === 0) {
    return { ok: false, reason: "unknown_route" };
  }
  const jobId = tail[0]!;
  if (jobId === "") {
    return { ok: false, reason: "empty_segment" };
  }
  if (!isSafeIdSegment(jobId)) {
    return { ok: false, reason: "unsafe_id_segment" };
  }
  if (tail.length === 1) {
    return methodGuard(method, "GET", { kind: "review_snapshot", jobId });
  }
  if (tail.length === 2 && tail[1] === "decision") {
    return methodGuard(method, "POST", { kind: "review_decision", jobId });
  }
  return { ok: false, reason: "unknown_route" };
};

const dispatchTms = (
  method: string,
  tail: readonly string[],
): RouteParseResult => {
  return dispatchSingleton(method, tail, "POST", { kind: "tms_push" }, [
    "push",
  ]);
};

const dispatchExecution = (
  method: string,
  tail: readonly string[],
): RouteParseResult => {
  return dispatchSingleton(method, tail, "POST", { kind: "execution_pull" }, [
    "pull",
  ]);
};

const dispatchSingleton = (
  method: string,
  tail: readonly string[],
  allowedMethod: string,
  route: Route,
  expectedTail: readonly string[] = [],
): RouteParseResult => {
  if (tail.length !== expectedTail.length) {
    return { ok: false, reason: "unknown_route" };
  }
  for (let i = 0; i < expectedTail.length; i += 1) {
    if (tail[i] !== expectedTail[i]) {
      return { ok: false, reason: "unknown_route" };
    }
  }
  return methodGuard(method, allowedMethod, route);
};
