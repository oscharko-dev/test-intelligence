/**
 * OpenAPI 3.1 document for the standalone Test Intelligence HTTP surface.
 *
 * The document is the source of truth: the drift-guard test
 * (`openapi.test.ts`) asserts that every route surfaced by
 * {@link parseTestIntelligenceRoute} appears in `paths` here.
 */

import { API_ROUTE_PREFIX } from "./constants.js";
import { PACKAGE_VERSION } from "./package-identity.js";

export interface OpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly servers: ReadonlyArray<{ readonly url: string }>;
  readonly components: {
    readonly securitySchemes: Readonly<Record<string, unknown>>;
    readonly schemas: Readonly<Record<string, unknown>>;
  };
  readonly paths: Readonly<Record<string, unknown>>;
}

const ERROR_ENVELOPE_SCHEMA: Readonly<Record<string, unknown>> = {
  type: "object",
  required: ["error", "message"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
  },
  additionalProperties: false,
};

const READYZ_SCHEMA: Readonly<Record<string, unknown>> = {
  type: "object",
  required: ["status", "featureGate", "authConfigured", "checkedAt"],
  properties: {
    status: { type: "string", enum: ["ready"] },
    featureGate: { type: "string", enum: ["enabled", "disabled"] },
    authConfigured: { type: "boolean" },
    checkedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
};

const HEALTHZ_SCHEMA: Readonly<Record<string, unknown>> = {
  type: "object",
  required: ["status", "checkedAt"],
  properties: {
    status: { type: "string", enum: ["ok"] },
    checkedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
};

const errorResponse = (
  description: string,
): Readonly<Record<string, unknown>> => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
    },
  },
});

const writeRoute = (
  summary: string,
  operationId: string,
): Readonly<Record<string, unknown>> => ({
  post: {
    summary,
    operationId,
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { type: "object" } } },
    },
    responses: {
      "200": { description: "Operation completed." },
      "401": errorResponse("Bearer token is missing or incorrect."),
      "403": errorResponse("Feature gate or origin policy denied the call."),
      "413": errorResponse("Request body exceeded the configured limit."),
      "415": errorResponse("Content-Type is not application/json."),
      "429": errorResponse("Per-client rate limit was exceeded."),
      "503": errorResponse("Server is not configured for this route."),
    },
  },
});

const readRoute = (
  summary: string,
  operationId: string,
  responseSchemaRef: string,
): Readonly<Record<string, unknown>> => ({
  get: {
    summary,
    operationId,
    responses: {
      "200": {
        description: "Result.",
        content: {
          "application/json": { schema: { $ref: responseSchemaRef } },
        },
      },
      "404": errorResponse("Resource not found."),
      "429": errorResponse("Per-client rate limit was exceeded."),
    },
  },
});

const jobScopedWriteRoute = (
  summary: string,
  operationId: string,
): Readonly<Record<string, unknown>> => {
  const route = writeRoute(summary, operationId) as {
    post: Record<string, unknown>;
  };
  route.post["parameters"] = [
    {
      name: "jobId",
      in: "path",
      required: true,
      schema: { type: "string", pattern: "^[A-Za-z0-9_.-]{1,128}$" },
    },
  ];
  return route;
};

const buildPaths = (): Readonly<Record<string, unknown>> => ({
  "/healthz": readRoute(
    "Liveness probe.",
    "getHealthz",
    "#/components/schemas/Healthz",
  ),
  "/readyz": readRoute(
    "Readiness probe.",
    "getReadyz",
    "#/components/schemas/Readyz",
  ),
  "/openapi.json": readRoute(
    "Return this OpenAPI document.",
    "getOpenapi",
    "#/components/schemas/Error",
  ),
  [`${API_ROUTE_PREFIX}/jobs`]: writeRoute(
    "Submit a Test Intelligence run.",
    "submitJob",
  ),
  [`${API_ROUTE_PREFIX}/jobs/{jobId}`]: readRoute(
    "Read a job's status.",
    "getJobStatus",
    "#/components/schemas/Error",
  ),
  [`${API_ROUTE_PREFIX}/jobs/{jobId}/events`]: readRoute(
    "Server-Sent Events stream of a job's phase events.",
    "streamJobEvents",
    "#/components/schemas/Error",
  ),
  [`${API_ROUTE_PREFIX}/jobs/{jobId}/evidence/verify`]: jobScopedWriteRoute(
    "Verify a job's evidence manifest.",
    "verifyJobEvidence",
  ),
  [`${API_ROUTE_PREFIX}/jobs/{jobId}/audit-dossier/verify`]:
    jobScopedWriteRoute(
      "Verify a job's audit dossier bundle.",
      "verifyJobAuditDossier",
    ),
  [`${API_ROUTE_PREFIX}/jobs/{jobId}/provenance/verify`]: jobScopedWriteRoute(
    "Verify a job's provenance document.",
    "verifyJobProvenance",
  ),
  [`${API_ROUTE_PREFIX}/jobs/{jobId}/seal/verify`]: jobScopedWriteRoute(
    "Verify a job's seal bundle.",
    "verifyJobSeal",
  ),
  [`${API_ROUTE_PREFIX}/review/{jobId}`]: readRoute(
    "Read the review snapshot for a job.",
    "getReviewSnapshot",
    "#/components/schemas/Error",
  ),
  [`${API_ROUTE_PREFIX}/review/{jobId}/decision`]: jobScopedWriteRoute(
    "Record a review decision.",
    "recordReviewDecision",
  ),
  [`${API_ROUTE_PREFIX}/tms/push`]: writeRoute(
    "Push completed test cases to a configured TMS adapter.",
    "pushToTms",
  ),
  [`${API_ROUTE_PREFIX}/execution/pull`]: writeRoute(
    "Pull execution evidence from a TMS adapter.",
    "pullExecutionEvidence",
  ),
  [`${API_ROUTE_PREFIX}/onboard`]: writeRoute(
    "Run tenant onboarding.",
    "runTenantOnboarding",
  ),
  [`${API_ROUTE_PREFIX}/figma-export`]: writeRoute(
    "Fetch a Figma file as a TI ingest payload.",
    "exportFigmaForTestIntelligence",
  ),
});

export const buildOpenApiDocument = (): OpenApiDocument => ({
  openapi: "3.1.0",
  info: {
    title: "Test Intelligence API",
    version: PACKAGE_VERSION,
    description:
      "Standalone HTTP surface for the Test Intelligence runtime. " +
      "Every write route is bearer-protected and fails closed when the " +
      "test-intelligence feature gate is disabled.",
  },
  servers: [{ url: "http://127.0.0.1:1983" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
      },
    },
    schemas: {
      Error: ERROR_ENVELOPE_SCHEMA,
      Readyz: READYZ_SCHEMA,
      Healthz: HEALTHZ_SCHEMA,
    },
  },
  paths: buildPaths(),
});
