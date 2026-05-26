import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { API_ROUTE_PREFIX } from "./constants.js";
import { buildOpenApiDocument } from "./openapi.js";
import {
  parseTestIntelligenceRoute,
  type Route,
} from "./test-intelligence-routes.js";

/**
 * Sample paths that exercise every route variant the parser recognises.
 * The OpenAPI document MUST contain a `paths` entry for each. The mapping
 * uses concrete sample IDs that the parser would accept; the document
 * itself templates `{jobId}` in the schema.
 */
const ROUTE_SAMPLES: ReadonlyArray<{
  method: string;
  sample: string;
  template: string;
  expectKind: Route["kind"];
}> = [
  {
    method: "GET",
    sample: "/healthz",
    template: "/healthz",
    expectKind: "healthz",
  },
  {
    method: "GET",
    sample: "/readyz",
    template: "/readyz",
    expectKind: "readyz",
  },
  {
    method: "GET",
    sample: "/openapi.json",
    template: "/openapi.json",
    expectKind: "openapi",
  },
  {
    method: "POST",
    sample: `${API_ROUTE_PREFIX}/jobs`,
    template: `${API_ROUTE_PREFIX}/jobs`,
    expectKind: "submit_job",
  },
  {
    method: "GET",
    sample: `${API_ROUTE_PREFIX}/jobs/sample`,
    template: `${API_ROUTE_PREFIX}/jobs/{jobId}`,
    expectKind: "job_status",
  },
  {
    method: "GET",
    sample: `${API_ROUTE_PREFIX}/jobs/sample/events`,
    template: `${API_ROUTE_PREFIX}/jobs/{jobId}/events`,
    expectKind: "job_events",
  },
  {
    method: "POST",
    sample: `${API_ROUTE_PREFIX}/jobs/sample/evidence/verify`,
    template: `${API_ROUTE_PREFIX}/jobs/{jobId}/evidence/verify`,
    expectKind: "verify_evidence",
  },
  {
    method: "POST",
    sample: `${API_ROUTE_PREFIX}/jobs/sample/audit-dossier/verify`,
    template: `${API_ROUTE_PREFIX}/jobs/{jobId}/audit-dossier/verify`,
    expectKind: "verify_audit_dossier",
  },
  {
    method: "POST",
    sample: `${API_ROUTE_PREFIX}/jobs/sample/provenance/verify`,
    template: `${API_ROUTE_PREFIX}/jobs/{jobId}/provenance/verify`,
    expectKind: "verify_provenance",
  },
  {
    method: "POST",
    sample: `${API_ROUTE_PREFIX}/jobs/sample/seal/verify`,
    template: `${API_ROUTE_PREFIX}/jobs/{jobId}/seal/verify`,
    expectKind: "verify_seal",
  },
  {
    method: "GET",
    sample: `${API_ROUTE_PREFIX}/review/sample`,
    template: `${API_ROUTE_PREFIX}/review/{jobId}`,
    expectKind: "review_snapshot",
  },
  {
    method: "POST",
    sample: `${API_ROUTE_PREFIX}/review/sample/decision`,
    template: `${API_ROUTE_PREFIX}/review/{jobId}/decision`,
    expectKind: "review_decision",
  },
  {
    method: "POST",
    sample: `${API_ROUTE_PREFIX}/tms/push`,
    template: `${API_ROUTE_PREFIX}/tms/push`,
    expectKind: "tms_push",
  },
  {
    method: "POST",
    sample: `${API_ROUTE_PREFIX}/execution/pull`,
    template: `${API_ROUTE_PREFIX}/execution/pull`,
    expectKind: "execution_pull",
  },
  {
    method: "POST",
    sample: `${API_ROUTE_PREFIX}/onboard`,
    template: `${API_ROUTE_PREFIX}/onboard`,
    expectKind: "onboard",
  },
  {
    method: "POST",
    sample: `${API_ROUTE_PREFIX}/figma-export`,
    template: `${API_ROUTE_PREFIX}/figma-export`,
    expectKind: "figma_export",
  },
];

void describe("buildOpenApiDocument - structural invariants", () => {
  const doc = buildOpenApiDocument();

  void test("declares OpenAPI 3.1.0", () => {
    assert.equal(doc.openapi, "3.1.0");
  });

  void test("info section identifies the standalone API", () => {
    assert.equal(doc.info.title, "Test Intelligence API");
    assert.ok(doc.info.version.length > 0);
  });

  void test("bearer security scheme is declared", () => {
    const bearer = doc.components.securitySchemes["bearerAuth"] as {
      type?: string;
      scheme?: string;
    };
    assert.equal(bearer.type, "http");
    assert.equal(bearer.scheme, "bearer");
  });

  void test("Error schema declares error and message", () => {
    const schema = doc.components.schemas["Error"] as {
      required?: readonly string[];
    };
    assert.deepEqual([...(schema.required ?? [])].sort(), ["error", "message"]);
  });
});

void describe("buildOpenApiDocument - parser drift guard", () => {
  const doc = buildOpenApiDocument();

  for (const sample of ROUTE_SAMPLES) {
    void test(`${sample.method} ${sample.sample} → ${sample.expectKind} is in paths`, () => {
      const parsed = parseTestIntelligenceRoute({
        method: sample.method,
        pathname: sample.sample,
      });
      assert.equal(parsed.ok, true);
      assert.equal(parsed.route.kind, sample.expectKind);
      const entry = doc.paths[sample.template] as
        | Record<string, unknown>
        | undefined;
      assert.ok(
        entry !== undefined,
        `Expected paths['${sample.template}'] in OpenAPI document.`,
      );
      assert.ok(
        sample.method === "GET"
          ? "get" in entry
          : sample.method === "POST"
            ? "post" in entry
            : false,
      );
    });
  }

  void test("every templated path is reachable by the parser", () => {
    for (const template of Object.keys(doc.paths)) {
      const concrete = template.replaceAll("{jobId}", "sample");
      const candidates = ["GET", "POST"];
      const reached = candidates.some(
        (method) =>
          parseTestIntelligenceRoute({ method, pathname: concrete }).ok,
      );
      assert.ok(reached, `Path '${template}' is not reachable by the parser.`);
    }
  });

  void test("write routes declare bearerAuth security", () => {
    const writeTemplates = [
      `${API_ROUTE_PREFIX}/jobs`,
      `${API_ROUTE_PREFIX}/jobs/{jobId}/evidence/verify`,
      `${API_ROUTE_PREFIX}/review/{jobId}/decision`,
      `${API_ROUTE_PREFIX}/tms/push`,
    ];
    for (const template of writeTemplates) {
      const post = (doc.paths[template] as { post?: { security?: unknown[] } })
        .post;
      assert.ok(post !== undefined, `Missing POST for ${template}.`);
      assert.ok(
        post.security !== undefined && post.security.length > 0,
        `Missing bearerAuth on ${template}.`,
      );
    }
  });
});
