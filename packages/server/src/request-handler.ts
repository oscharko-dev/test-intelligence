/**
 * Standalone Test Intelligence HTTP request dispatcher.
 *
 * `createTestIntelligenceRequestHandler` returns a Node `IncomingMessage` /
 * `ServerResponse` callback that:
 *   1. Parses the route via {@link parseTestIntelligenceRoute}.
 *   2. Enforces per-IP+route rate limiting.
 *   3. Applies the feature gate, same-origin, and bearer checks on write
 *      routes (fail-closed).
 *   4. Dispatches to a per-route handler from {@link buildHandlerTable}.
 *
 * Business logic lives in the route handlers (`route-handlers.ts`); the
 * dispatcher here only translates HTTP envelopes to function calls.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkspaceRuntimeLogger } from "@oscharko-dev/ti-security";
import { DEFAULT_RATE_LIMIT_PER_MINUTE } from "./constants.js";
import type { TestIntelligenceErrorCode } from "./error-codes.js";
import { resolveClientKey, writeErrorResponse } from "./http-helpers.js";
import {
  createAuditLogger,
  createRequestLogger,
  type AuditLogger,
  type RequestLogger,
} from "./observability.js";
import { createRateLimiter, type RateLimiter } from "./rate-limit.js";
import {
  validateBearerToken,
  validateWriteRequest,
} from "./request-security.js";
import {
  parseTestIntelligenceRoute,
  type Route,
  type RouteParseFailureReason,
} from "./test-intelligence-routes.js";
import { buildHandlerTable } from "./route-handlers.js";
import type {
  RouteHandler,
  TestIntelligenceRequestHandler,
  TestIntelligenceRequestHandlerOptions,
} from "./request-handler-types.js";

export type {
  RouteHandler,
  RouteHandlerContext,
  TestIntelligenceRequestHandler,
  TestIntelligenceRequestHandlerOptions,
} from "./request-handler-types.js";

export const createTestIntelligenceRequestHandler = (
  options: TestIntelligenceRequestHandlerOptions,
): TestIntelligenceRequestHandler => {
  const rateLimiter = createRateLimiter({
    requestsPerMinute:
      options.requestsPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE,
  });
  const requestLog = createRequestLogger(options.logger);
  const audit = createAuditLogger({
    write: options.auditWrite ?? defaultAuditWrite(options.logger),
  });
  const handlers = buildHandlerTable(options);
  const nowMs = options.nowMs ?? (() => Date.now());

  return (request, response) => {
    void runHandler({
      request,
      response,
      options,
      rateLimiter,
      requestLog,
      audit,
      handlers,
      nowMs,
    });
  };
};

interface RunHandlerInput {
  request: IncomingMessage;
  response: ServerResponse;
  options: TestIntelligenceRequestHandlerOptions;
  rateLimiter: RateLimiter;
  requestLog: RequestLogger;
  audit: AuditLogger;
  handlers: Record<Route["kind"], RouteHandler>;
  nowMs: () => number;
}

const runHandler = async (input: RunHandlerInput): Promise<void> => {
  const { request, response, options, requestLog } = input;
  const start = Date.now();
  const requestId = requestLog.newRequestId();
  const clientKey = resolveClientKey(request);
  const method = request.method ?? "GET";
  const pathname = extractPathname(request.url ?? "/");

  try {
    const dispatched = await dispatch({
      ...input,
      method,
      pathname,
      requestId,
      clientKey,
    });
    requestLog.log({
      requestId,
      method,
      path: pathname,
      statusCode: response.statusCode,
      durationMs: Date.now() - start,
      clientKey,
      route: dispatched,
    });
  } catch (error) {
    handleUnexpectedError({ response, error, options, requestId });
    requestLog.log({
      requestId,
      method,
      path: pathname,
      statusCode: response.statusCode,
      durationMs: Date.now() - start,
      clientKey,
    });
  }
};

interface DispatchInput extends RunHandlerInput {
  method: string;
  pathname: string;
  requestId: string;
  clientKey: string;
}

const dispatch = async (input: DispatchInput): Promise<string> => {
  const {
    request,
    response,
    method,
    pathname,
    options,
    rateLimiter,
    handlers,
    requestId,
    clientKey,
    audit,
    nowMs,
  } = input;

  const parse = parseTestIntelligenceRoute({ method, pathname });
  if (!parse.ok) {
    emitParseFailure({
      response,
      reason: parse.reason,
      allowed: parse.allowedMethods,
    });
    return `parse:${parse.reason}`;
  }

  const route = parse.route;
  const routeKey = `${method.toUpperCase()} ${route.kind}`;
  const limit = rateLimiter.check({
    clientKey,
    routeKey,
    nowMs: nowMs(),
  });
  if (!limit.ok) {
    writeErrorResponse({
      response,
      code: "RATE_LIMITED",
      message: "Too many requests; retry after the indicated interval.",
      extraHeaders: { "Retry-After": String(limit.retryAfterSeconds) },
    });
    return route.kind;
  }

  if (requiresWriteGate(route)) {
    const gate = enforceWriteGate({ request, response, options, route });
    if (!gate.ok) {
      return route.kind;
    }
  }

  await handlers[route.kind]({
    request,
    response,
    route,
    requestId,
    clientKey,
    audit,
    logger: options.logger,
  });
  return route.kind;
};

const requiresWriteGate = (route: Route): boolean => {
  switch (route.kind) {
    case "healthz":
    case "readyz":
    case "openapi":
    case "cors_preflight":
    case "job_status":
    case "job_events":
    case "review_snapshot":
      return false;
    default:
      return true;
  }
};

const enforceWriteGate = ({
  request,
  response,
  options,
  route,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  options: TestIntelligenceRequestHandlerOptions;
  route: Route;
}): { ok: boolean } => {
  if (!options.testIntelligenceEnabled) {
    writeErrorResponse({
      response,
      code: "FEATURE_GATE_DISABLED",
      message: "The test-intelligence feature gate is disabled on this server.",
    });
    return { ok: false };
  }
  const writeCheck = validateWriteRequest({
    request,
    host: options.host,
    port: options.port,
  });
  if (!writeCheck.ok) {
    writeErrorResponse({
      response,
      code: writeCheck.payload.error,
      message: writeCheck.payload.message,
      statusCode: writeCheck.statusCode,
    });
    return { ok: false };
  }
  const auth = validateBearerToken({
    request,
    bearerToken: options.bearerToken,
    routeLabel: route.kind,
  });
  if (!auth.ok) {
    writeErrorResponse({
      response,
      code: auth.payload.error,
      message: auth.payload.message,
      statusCode: auth.statusCode,
      ...(auth.wwwAuthenticate !== undefined
        ? { extraHeaders: { "WWW-Authenticate": auth.wwwAuthenticate } }
        : {}),
    });
    return { ok: false };
  }
  return { ok: true };
};

const emitParseFailure = ({
  response,
  reason,
  allowed,
}: {
  response: ServerResponse;
  reason: RouteParseFailureReason;
  allowed: readonly string[] | undefined;
}): void => {
  if (reason === "method_not_allowed") {
    writeErrorResponse({
      response,
      code: "METHOD_NOT_ALLOWED",
      message: "The requested method is not allowed on this route.",
      ...(allowed !== undefined
        ? { extraHeaders: { Allow: allowed.join(", ") } }
        : {}),
    });
    return;
  }
  const code: TestIntelligenceErrorCode =
    reason === "unsafe_id_segment" || reason === "empty_segment"
      ? "BAD_REQUEST"
      : "NOT_FOUND";
  const message =
    code === "BAD_REQUEST"
      ? "The route contains an unsafe or empty path segment."
      : "The requested route does not exist.";
  writeErrorResponse({ response, code, message });
};

const extractPathname = (url: string): string => {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
};

const defaultAuditWrite =
  (logger: WorkspaceRuntimeLogger) =>
  (line: string): void => {
    logger.log({ level: "info", message: `audit ${line.trimEnd()}` });
  };

const handleUnexpectedError = ({
  response,
  error,
  options,
  requestId,
}: {
  response: ServerResponse;
  error: unknown;
  options: TestIntelligenceRequestHandlerOptions;
  requestId: string;
}): void => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  options.logger.log({
    level: "error",
    message: `request handler failure: ${message}`,
    requestId,
  });
  if (!response.headersSent) {
    writeErrorResponse({
      response,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred handling the request.",
    });
  } else if (!response.writableEnded) {
    response.end();
  }
};
