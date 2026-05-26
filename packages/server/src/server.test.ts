import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { WorkspaceRuntimeLogger } from "@oscharko-dev/ti-security";
import { createTestIntelligenceServer } from "./server.js";

const silentLogger: WorkspaceRuntimeLogger = {
  log: () => {
    /* swallow */
  },
};

const httpGet = async (
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: string; headers: Headers }> => {
  const response = await fetch(url, init);
  const body = await response.text();
  return { status: response.status, body, headers: response.headers };
};

void describe("createTestIntelligenceServer - lifecycle", () => {
  void test("binds to an ephemeral port and exposes a URL", async () => {
    const server = await createTestIntelligenceServer({
      host: "127.0.0.1",
      port: 0,
      logger: silentLogger,
      testIntelligenceEnabled: true,
    });
    try {
      assert.ok(server.port > 0);
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(server.host, "127.0.0.1");
      assert.ok(server.startedAt > 0);
    } finally {
      await server.close();
    }
  });

  void test("GET /healthz returns 200", async () => {
    const server = await createTestIntelligenceServer({
      host: "127.0.0.1",
      port: 0,
      logger: silentLogger,
      testIntelligenceEnabled: true,
    });
    try {
      const result = await httpGet(`${server.url}/healthz`);
      assert.equal(result.status, 200);
      const body = JSON.parse(result.body) as { status: string };
      assert.equal(body.status, "ok");
    } finally {
      await server.close();
    }
  });

  void test("GET /readyz reports configuration", async () => {
    const server = await createTestIntelligenceServer({
      host: "127.0.0.1",
      port: 0,
      logger: silentLogger,
      bearerToken: "tok",
      testIntelligenceEnabled: false,
    });
    try {
      const result = await httpGet(`${server.url}/readyz`);
      assert.equal(result.status, 200);
      const body = JSON.parse(result.body) as {
        featureGate: string;
        authConfigured: boolean;
      };
      assert.equal(body.featureGate, "disabled");
      assert.equal(body.authConfigured, true);
    } finally {
      await server.close();
    }
  });

  void test("POST /api/v1/review/{job}/decision without bearer returns 503", async () => {
    const server = await createTestIntelligenceServer({
      host: "127.0.0.1",
      port: 0,
      logger: silentLogger,
      testIntelligenceEnabled: true,
    });
    try {
      const result = await httpGet(
        `${server.url}/api/v1/review/job-1/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        },
      );
      assert.equal(result.status, 503);
    } finally {
      await server.close();
    }
  });

  void test("CSP and nosniff headers are present on every response", async () => {
    const server = await createTestIntelligenceServer({
      host: "127.0.0.1",
      port: 0,
      logger: silentLogger,
      testIntelligenceEnabled: true,
    });
    try {
      const result = await httpGet(`${server.url}/healthz`);
      assert.equal(result.headers.get("x-content-type-options"), "nosniff");
      assert.match(
        result.headers.get("content-security-policy") ?? "",
        /default-src 'self'/,
      );
    } finally {
      await server.close();
    }
  });
});
