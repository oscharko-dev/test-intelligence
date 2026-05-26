import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseTestIntelligenceRoute } from "./test-intelligence-routes.js";

void describe("parseTestIntelligenceRoute - root", () => {
  void test("OPTIONS always returns cors_preflight regardless of path", () => {
    const result = parseTestIntelligenceRoute({
      method: "OPTIONS",
      pathname: "/anything",
    });
    assert.equal(result.ok, true);
    assert.equal(result.route.kind, "cors_preflight");
  });

  void test("GET /healthz", () => {
    const r = parseTestIntelligenceRoute({
      method: "GET",
      pathname: "/healthz",
    });
    assert.equal(r.ok, true);
    assert.equal(r.route.kind, "healthz");
  });

  void test("POST /healthz is method_not_allowed", () => {
    const r = parseTestIntelligenceRoute({
      method: "POST",
      pathname: "/healthz",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "method_not_allowed");
    assert.deepEqual(r.allowedMethods, ["GET"]);
  });

  void test("GET /readyz", () => {
    const r = parseTestIntelligenceRoute({
      method: "GET",
      pathname: "/readyz",
    });
    assert.equal(r.ok, true);
    assert.equal(r.route.kind, "readyz");
  });

  void test("GET /openapi.json", () => {
    const r = parseTestIntelligenceRoute({
      method: "GET",
      pathname: "/openapi.json",
    });
    assert.equal(r.ok, true);
    assert.equal(r.route.kind, "openapi");
  });

  void test("unknown path returns unknown_route", () => {
    const r = parseTestIntelligenceRoute({
      method: "GET",
      pathname: "/nope",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_route");
  });
});

void describe("parseTestIntelligenceRoute - jobs", () => {
  void test("POST /api/v1/jobs is submit_job", () => {
    const r = parseTestIntelligenceRoute({
      method: "POST",
      pathname: "/api/v1/jobs",
    });
    assert.equal(r.ok, true);
    assert.equal(r.route.kind, "submit_job");
  });

  void test("trailing slash is tolerated", () => {
    const r = parseTestIntelligenceRoute({
      method: "POST",
      pathname: "/api/v1/jobs/",
    });
    assert.equal(r.ok, true);
    assert.equal(r.route.kind, "submit_job");
  });

  void test("GET /api/v1/jobs/{id} is job_status", () => {
    const r = parseTestIntelligenceRoute({
      method: "GET",
      pathname: "/api/v1/jobs/abc123",
    });
    assert.equal(r.ok, true);
    assert.equal(r.route.kind, "job_status");
    // assert.equal with strict equality narrows the discriminated union;
    // the field access is type-safe without a further conditional guard.
    const route = r.route as Extract<typeof r.route, { kind: "job_status" }>;
    assert.equal(route.jobId, "abc123");
  });

  void test("GET /api/v1/jobs/{id}/events is job_events", () => {
    const r = parseTestIntelligenceRoute({
      method: "GET",
      pathname: "/api/v1/jobs/abc123/events",
    });
    assert.equal(r.ok, true);
    assert.equal(r.route.kind, "job_events");
  });

  for (const [subject, kind] of [
    ["evidence", "verify_evidence"],
    ["audit-dossier", "verify_audit_dossier"],
    ["provenance", "verify_provenance"],
    ["seal", "verify_seal"],
  ] as const) {
    void test(`POST /api/v1/jobs/{id}/${subject}/verify is ${kind}`, () => {
      const r = parseTestIntelligenceRoute({
        method: "POST",
        pathname: `/api/v1/jobs/abc/${subject}/verify`,
      });
      assert.equal(r.ok, true);
      assert.equal(r.route.kind, kind);
    });
  }

  void test("unsafe job id is rejected", () => {
    const r = parseTestIntelligenceRoute({
      method: "GET",
      pathname: "/api/v1/jobs/..",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unsafe_id_segment");
  });

  void test("unknown verify subroute returns unknown_route", () => {
    const r = parseTestIntelligenceRoute({
      method: "POST",
      pathname: "/api/v1/jobs/abc/unknown/verify",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_route");
  });

  void test("wrong method on submit returns method_not_allowed", () => {
    const r = parseTestIntelligenceRoute({
      method: "GET",
      pathname: "/api/v1/jobs",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "method_not_allowed");
  });
});

void describe("parseTestIntelligenceRoute - review", () => {
  void test("GET /api/v1/review/{jobId} is review_snapshot", () => {
    const r = parseTestIntelligenceRoute({
      method: "GET",
      pathname: "/api/v1/review/job-1",
    });
    assert.equal(r.ok, true);
    assert.equal(r.route.kind, "review_snapshot");
  });

  void test("POST /api/v1/review/{jobId}/decision is review_decision", () => {
    const r = parseTestIntelligenceRoute({
      method: "POST",
      pathname: "/api/v1/review/job-1/decision",
    });
    assert.equal(r.ok, true);
    assert.equal(r.route.kind, "review_decision");
  });

  void test("GET on decision is method_not_allowed", () => {
    const r = parseTestIntelligenceRoute({
      method: "GET",
      pathname: "/api/v1/review/job-1/decision",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "method_not_allowed");
  });
});

void describe("parseTestIntelligenceRoute - singleton routes", () => {
  for (const [path, kind] of [
    ["/api/v1/tms/push", "tms_push"],
    ["/api/v1/execution/pull", "execution_pull"],
    ["/api/v1/onboard", "onboard"],
    ["/api/v1/figma-export", "figma_export"],
  ] as const) {
    void test(`POST ${path} is ${kind}`, () => {
      const r = parseTestIntelligenceRoute({
        method: "POST",
        pathname: path,
      });
      assert.equal(r.ok, true);
      assert.equal(r.route.kind, kind);
    });

    void test(`GET ${path} is method_not_allowed`, () => {
      const r = parseTestIntelligenceRoute({
        method: "GET",
        pathname: path,
      });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "method_not_allowed");
    });
  }

  void test("unknown tms subpath is unknown_route", () => {
    const r = parseTestIntelligenceRoute({
      method: "POST",
      pathname: "/api/v1/tms/destroy",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_route");
  });
});
