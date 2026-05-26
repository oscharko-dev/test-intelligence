/**
 * End-to-end CORS preflight tests against the standalone server.
 *
 * The standalone runtime is API-only; the operator UI is shipped under
 * Issue #22. These tests assert the preflight contract every browser
 * client depends on: an `OPTIONS` request returns 204, advertises the
 * supported methods/headers, and is independent of the test-intelligence
 * feature gate (preflight must always succeed regardless of write-route
 * configuration).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { WorkspaceRuntimeLogger } from "@oscharko-dev/ti-security";
import { createTestIntelligenceServer } from "./server.js";

const silentLogger: WorkspaceRuntimeLogger = {
  log: () => {
    /* swallow */
  },
};

void describe("CORS preflight e2e", () => {
  void test("OPTIONS /api/v1/jobs returns 204 with permissive CORS headers", async () => {
    const server = await createTestIntelligenceServer({
      host: "127.0.0.1",
      port: 0,
      logger: silentLogger,
      testIntelligenceEnabled: true,
      allowedCorsOrigins: ["http://127.0.0.1:1983"],
    });
    try {
      const response = await fetch(`${server.url}/api/v1/jobs`, {
        method: "OPTIONS",
        headers: {
          origin: "http://127.0.0.1:1983",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type, authorization",
        },
      });
      assert.equal(response.status, 204);
      assert.equal(
        response.headers.get("access-control-allow-origin"),
        "http://127.0.0.1:1983",
      );
      assert.match(
        response.headers.get("access-control-allow-methods") ?? "",
        /POST/,
      );
      assert.match(
        response.headers.get("access-control-allow-headers") ?? "",
        /Authorization/i,
      );
    } finally {
      await server.close();
    }
  });

  void test("preflight succeeds even when the write route is feature-gated off", async () => {
    const server = await createTestIntelligenceServer({
      host: "127.0.0.1",
      port: 0,
      logger: silentLogger,
      testIntelligenceEnabled: false,
      allowedCorsOrigins: ["http://127.0.0.1:1983"],
    });
    try {
      const response = await fetch(
        `${server.url}/api/v1/review/job-1/decision`,
        { method: "OPTIONS" },
      );
      assert.equal(response.status, 204);
    } finally {
      await server.close();
    }
  });

  void test("preflight without configured origin returns 204 but no allow-origin header", async () => {
    const server = await createTestIntelligenceServer({
      host: "127.0.0.1",
      port: 0,
      logger: silentLogger,
      testIntelligenceEnabled: true,
    });
    try {
      const response = await fetch(`${server.url}/api/v1/jobs`, {
        method: "OPTIONS",
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    } finally {
      await server.close();
    }
  });
});
