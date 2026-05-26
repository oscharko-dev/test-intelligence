/**
 * Public API for the Test Intelligence HTTP server package
 * (`@oscharko-dev/ti-server`).
 *
 * The barrel exposes the HTTP server factory, the route/handler types
 * operators need to wire request handlers, and the package-identity
 * constants previously owned by the repository-root `src/index.ts`.
 *
 * The identity constants (`PACKAGE_NAME`, `PACKAGE_VERSION`,
 * `resolveReleaseStage`, `getPackageIdentity`) describe the published
 * `@oscharko-dev/test-intelligence` build at runtime; they live here
 * because the OpenAPI document built by `openapi.ts` embeds
 * `PACKAGE_VERSION` in its `info.version` field, so version metadata and
 * the server factory ship as one unit.
 */

export {
  type PackageIdentity,
  type ReleaseStage,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  resolveReleaseStage,
  getPackageIdentity,
} from "./package-identity.js";

// HTTP server factory and types — the primary integration surface.
export {
  createTestIntelligenceServer,
  type CreateTestIntelligenceServerOptions,
  type TestIntelligenceServer,
} from "./server.js";

export type {
  RouteHandler,
  RouteHandlerContext,
  TestIntelligenceRequestHandler,
  TestIntelligenceRequestHandlerOptions,
} from "./request-handler.js";

export type { Route } from "./test-intelligence-routes.js";
export type {
  TestIntelligenceErrorCode,
  TestIntelligenceErrorEnvelope,
} from "./error-codes.js";
