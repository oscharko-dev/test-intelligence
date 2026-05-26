/**
 * Default per-route handler implementations.
 *
 * Every handler in the default table either answers from in-process state
 * (`healthz`, `readyz`, `openapi`, `cors_preflight`) or returns
 * `503 LLM_GATEWAY_UNCONFIGURED` so the route is reachable but the
 * operator must explicitly wire it via
 * {@link TestIntelligenceRequestHandlerOptions.routeHandlers}. This split
 * keeps every handler small and lets the integration tests substitute a
 * mock for any single route without rebuilding the dispatcher.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_REQUEST_BODY_BYTES, MAX_SUBMIT_BODY_BYTES } from "./constants.js";
import {
  beginSseResponse,
  readJsonBody,
  writeErrorResponse,
  writeJsonResponse,
} from "./http-helpers.js";
import type { Route } from "./test-intelligence-routes.js";
import type {
  RouteHandler,
  RouteHandlerContext,
  TestIntelligenceRequestHandlerOptions,
} from "./request-handler-types.js";

export const buildHandlerTable = (
  options: TestIntelligenceRequestHandlerOptions,
): Record<Route["kind"], RouteHandler> => {
  const defaults: Record<Route["kind"], RouteHandler> = {
    healthz: handleHealthz,
    readyz: ({ response }) => handleReadyz(response, options),
    openapi: handleOpenapi,
    cors_preflight: ({ response }) => handleCorsPreflight(response, options),
    submit_job: handleNotImplemented("submit_job"),
    job_status: handleNotImplemented("job_status"),
    job_events: handleSseStub,
    verify_evidence: handleNotImplemented("verify_evidence"),
    verify_audit_dossier: handleNotImplemented("verify_audit_dossier"),
    verify_provenance: handleNotImplemented("verify_provenance"),
    verify_seal: handleNotImplemented("verify_seal"),
    review_snapshot: handleNotImplemented("review_snapshot"),
    review_decision: handleNotImplemented("review_decision"),
    tms_push: handleNotImplemented("tms_push"),
    execution_pull: handleNotImplemented("execution_pull"),
    onboard: handleNotImplemented("onboard"),
    figma_export: handleNotImplemented("figma_export"),
  };
  const overrides = options.routeHandlers ?? {};
  for (const [kind, handler] of Object.entries(overrides) as ReadonlyArray<
    [Route["kind"], RouteHandler]
  >) {
    defaults[kind] = handler;
  }
  return defaults;
};

const handleHealthz: RouteHandler = ({ response }) => {
  writeJsonResponse({
    response,
    statusCode: 200,
    payload: { status: "ok", checkedAt: new Date().toISOString() },
  });
};

const handleReadyz = (
  response: ServerResponse,
  options: TestIntelligenceRequestHandlerOptions,
): void => {
  writeJsonResponse({
    response,
    statusCode: 200,
    payload: {
      status: "ready",
      featureGate: options.testIntelligenceEnabled ? "enabled" : "disabled",
      authConfigured: options.bearerToken !== undefined,
      checkedAt: new Date().toISOString(),
    },
  });
};

const handleOpenapi: RouteHandler = ({ response }) => {
  // The server factory overrides this handler with one that serves the
  // checked-in document from packages/server/src/openapi.ts. The default
  // stub keeps the route addressable when the handler is mounted in isolation.
  writeJsonResponse({
    response,
    statusCode: 200,
    payload: {
      openapi: "3.1.0",
      info: { title: "Test Intelligence API", version: "0.0.1" },
      paths: {},
    },
  });
};

const handleCorsPreflight = (
  response: ServerResponse,
  options: TestIntelligenceRequestHandlerOptions,
): void => {
  const allowedOrigin = options.allowedCorsOrigins?.[0];
  if (allowedOrigin !== undefined) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
  response.setHeader("Access-Control-Max-Age", "600");
  response.statusCode = 204;
  response.end();
};

const handleNotImplemented = (routeKind: string): RouteHandler => {
  return ({
    request,
    response,
    route,
    audit,
    requestId,
  }: RouteHandlerContext) => {
    void readJsonBodyForRoute(request, route).then((body) => {
      audit.record({
        action: `${routeKind}.received`,
        subject: routeKind,
        outcome: body.ok ? "ok" : "denied",
        requestId,
      });
      writeErrorResponse({
        response,
        code: "LLM_GATEWAY_UNCONFIGURED",
        message: `Route '${routeKind}' is reachable but no operator-supplied handler is wired.`,
      });
    });
  };
};

const handleSseStub: RouteHandler = ({ response }) => {
  const sse = beginSseResponse(response);
  sse.writeRetry(15_000);
  sse.writeEvent({
    event: "noop",
    data: { message: "No event source is wired for this job." },
    id: "0",
  });
  sse.end();
};

const readJsonBodyForRoute = async (
  request: IncomingMessage,
  route: Route,
): Promise<{ ok: boolean }> => {
  const maxBytes =
    route.kind === "submit_job"
      ? MAX_SUBMIT_BODY_BYTES
      : MAX_REQUEST_BODY_BYTES;
  const result = await readJsonBody({ request, maxBytes });
  return { ok: result.ok };
};
