/**
 * Standalone Test Intelligence HTTP server factory.
 *
 * `createTestIntelligenceServer` constructs a Node `http.Server` wired to
 * the request dispatcher and returns a small lifecycle object the operator
 * can use to read the bound address, observe the startup timestamp, and
 * shut down gracefully.
 *
 * This module exposes only the standalone Test Intelligence HTTP surface
 * defined in
 * `packages/server/src/test-intelligence-routes.ts`.
 */

import { createServer, type Server } from "node:http";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  resolveTestIntelligenceEnabled,
} from "./constants.js";
import { createTestIntelligenceRequestHandler } from "./request-handler.js";
import type {
  RouteHandler,
  TestIntelligenceRequestHandlerOptions,
} from "./request-handler-types.js";
import { buildOpenApiDocument } from "./openapi.js";
import { writeJsonResponse } from "./http-helpers.js";
import type { WorkspaceRuntimeLogger } from "@oscharko-dev/ti-security";

export interface CreateTestIntelligenceServerOptions {
  /** Bind host (defaults to {@link DEFAULT_HOST} — loopback). */
  readonly host?: string;
  /** Bind port (defaults to {@link DEFAULT_PORT}; pass 0 for ephemeral). */
  readonly port?: number;
  /**
   * Configured operator bearer token. Without it every write route returns
   * `503 AUTHENTICATION_UNAVAILABLE`.
   */
  readonly bearerToken?: string;
  /**
   * Operator-provided structured logger. The factory does NOT create a
   * default file sink — leaving logging to the operator is part of the
   * zero-telemetry posture.
   */
  readonly logger: WorkspaceRuntimeLogger;
  /** Optional audit-log line writer. Defaults to `logger.log({level:"info"})`. */
  readonly auditWrite?: (line: string) => void;
  /** Optional per-route handler overrides for tests / advanced wiring. */
  readonly routeHandlers?: TestIntelligenceRequestHandlerOptions["routeHandlers"];
  /** Rate-limit budget per client per minute. */
  readonly requestsPerMinute?: number;
  /** Allowed CORS origins for preflight responses. */
  readonly allowedCorsOrigins?: readonly string[];
  /**
   * Resolved test-intelligence feature gate. Defaults to
   * {@link resolveTestIntelligenceEnabled}. Pass `false` to force the
   * server up in a read-only posture.
   */
  readonly testIntelligenceEnabled?: boolean;
  /** Process env (test seam). */
  readonly env?: NodeJS.ProcessEnv;
}

export interface TestIntelligenceServer {
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly startedAt: number;
  readonly close: () => Promise<void>;
}

export const createTestIntelligenceServer = async (
  options: CreateTestIntelligenceServerOptions,
): Promise<TestIntelligenceServer> => {
  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  const testIntelligenceEnabled =
    options.testIntelligenceEnabled ??
    resolveTestIntelligenceEnabled(options.env);

  const openApiHandler: RouteHandler = ({ response }) => {
    writeJsonResponse({
      response,
      statusCode: 200,
      payload: buildOpenApiDocument(),
    });
  };

  const mergedRouteHandlers: TestIntelligenceRequestHandlerOptions["routeHandlers"] =
    {
      openapi: openApiHandler,
      ...(options.routeHandlers ?? {}),
    };

  const handler = createTestIntelligenceRequestHandler({
    host,
    port: requestedPort,
    logger: options.logger,
    testIntelligenceEnabled,
    requestsPerMinute:
      options.requestsPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE,
    routeHandlers: mergedRouteHandlers,
    ...(options.bearerToken !== undefined
      ? { bearerToken: options.bearerToken }
      : {}),
    ...(options.auditWrite !== undefined
      ? { auditWrite: options.auditWrite }
      : {}),
    ...(options.allowedCorsOrigins !== undefined
      ? { allowedCorsOrigins: options.allowedCorsOrigins }
      : {}),
  });

  const server = createServer((request, response) => {
    handler(request, response);
  });

  await listen(server, host, requestedPort);
  const address = server.address();
  const boundPort =
    address !== null && typeof address === "object"
      ? address.port
      : requestedPort;
  const url = `http://${formatHost(host)}:${String(boundPort)}`;
  const startedAt = Date.now();

  return {
    server,
    host,
    port: boundPort,
    url,
    startedAt,
    close: () => closeServer(server),
  };
};

const listen = (server: Server, host: string, port: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
};

const closeServer = (server: Server): Promise<void> => {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const formatHost = (host: string): string => {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
};

export type { RouteHandler } from "./request-handler-types.js";
