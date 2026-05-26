/**
 * Shared interfaces for the request handler module split.
 *
 * Extracting these types keeps the dispatcher (`request-handler.ts`) and
 * the default route handlers (`route-handlers.ts`) under the 400-LOC file
 * budget without creating an import cycle: both modules import this leaf.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkspaceRuntimeLogger } from "@oscharko-dev/ti-security";
import type { AuditLogger } from "./observability.js";
import type { Route } from "./test-intelligence-routes.js";

export interface RouteHandlerContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly route: Route;
  readonly requestId: string;
  readonly clientKey: string;
  readonly audit: AuditLogger;
  readonly logger: WorkspaceRuntimeLogger;
}

export type RouteHandler = (
  context: RouteHandlerContext,
) => Promise<void> | void;

export interface TestIntelligenceRequestHandlerOptions {
  /** Bind host (used for same-origin enforcement on write routes). */
  readonly host: string;
  /** Bind port (used for same-origin enforcement on write routes). */
  readonly port: number;
  /**
   * Configured server bearer token. `undefined` makes every write route
   * fail-closed with `503 AUTHENTICATION_UNAVAILABLE`.
   */
  readonly bearerToken?: string;
  /** Operator-provided structured logger. */
  readonly logger: WorkspaceRuntimeLogger;
  /** Optional audit-log writer; defaults to logging through `logger`. */
  readonly auditWrite?: (line: string) => void;
  /** Optional per-route handler overrides for tests / advanced operators. */
  readonly routeHandlers?: Partial<Record<Route["kind"], RouteHandler>>;
  /** Rate-limit budget per client per minute. */
  readonly requestsPerMinute?: number;
  /** Clock seam for the rate limiter (defaults to `Date.now`). */
  readonly nowMs?: () => number;
  /** Test-intelligence startup feature gate. */
  readonly testIntelligenceEnabled: boolean;
  /**
   * Allowed CORS preflight origins. Defaults to the bound host:port. The
   * standalone server is loopback-only by default so the empty origin
   * policy is intentional.
   */
  readonly allowedCorsOrigins?: readonly string[];
}

export interface TestIntelligenceRequestHandler {
  (request: IncomingMessage, response: ServerResponse): void;
}
