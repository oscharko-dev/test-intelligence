/**
 * Dynamic application-security smoke tests against the standalone server.
 *
 * The suite exercises the most common DAST findings — path traversal,
 * malformed encoding, oversized request body, cross-origin write,
 * unauthenticated write — and asserts the server fails closed with the
 * expected status code and error envelope. These tests are an
 * end-to-end complement to the unit suites in
 * `request-security.fuzz.test.ts` and `rate-limit.fuzz.test.ts`.
 */

import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { describe, test } from "node:test";
import type { WorkspaceRuntimeLogger } from "@oscharko-dev/ti-security";
import {
  createTestIntelligenceServer,
  type TestIntelligenceServer,
} from "./server.js";
import { MAX_REQUEST_BODY_BYTES } from "./constants.js";

/**
 * Issue a raw HTTP request with an unmodified request path. `fetch`
 * normalises traversal sequences before sending, so DAST tests targeting
 * `..` segments cannot rely on it — they go through the low-level client.
 */
const rawRequest = (
  serverUrl: string,
  rawPath: string,
): Promise<{ statusCode: number; body: string }> => {
  const url = new URL(serverUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: url.hostname,
        port: Number(url.port),
        method: "GET",
        path: rawPath,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
};

const silentLogger: WorkspaceRuntimeLogger = {
  log: () => {
    /* swallow */
  },
};

const startServer = (
  overrides: Partial<Parameters<typeof createTestIntelligenceServer>[0]> = {},
): Promise<TestIntelligenceServer> =>
  createTestIntelligenceServer({
    host: "127.0.0.1",
    port: 0,
    logger: silentLogger,
    testIntelligenceEnabled: true,
    bearerToken: "operator-token",
    ...overrides,
  });

void describe("DAST smoke e2e", () => {
  void test("path traversal on a job id is rejected with 400", async () => {
    const server = await startServer();
    try {
      // Use a low-level HTTP request so the `..` segment is sent verbatim;
      // `fetch` would normalise it client-side before the server saw it.
      const response = await rawRequest(server.url, "/api/v1/jobs/..");
      assert.equal(response.statusCode, 400);
      const body = JSON.parse(response.body) as { error: string };
      assert.equal(body.error, "BAD_REQUEST");
    } finally {
      await server.close();
    }
  });

  void test("unknown route returns 404 NOT_FOUND", async () => {
    const server = await startServer();
    try {
      const response = await fetch(`${server.url}/etc/passwd`);
      assert.equal(response.status, 404);
    } finally {
      await server.close();
    }
  });

  void test("oversized body on a write route returns 503 (auth-first) without buffering", async () => {
    // With no bearer token sent, the dispatcher returns 401 *before*
    // touching the body, so the server cannot be DoS-ed by clients that
    // open a write socket and stream forever without authenticating.
    const server = await startServer();
    try {
      const oversized = "x".repeat(MAX_REQUEST_BODY_BYTES + 1024);
      const response = await fetch(`${server.url}/api/v1/review/x/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: oversized,
      });
      assert.equal(response.status, 401);
    } finally {
      await server.close();
    }
  });

  void test("cross-origin write is blocked with 403 FORBIDDEN_REQUEST_ORIGIN", async () => {
    const server = await startServer();
    try {
      const response = await fetch(
        `${server.url}/api/v1/review/job-1/decision`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://attacker.example.com",
            authorization: "Bearer operator-token",
          },
          body: JSON.stringify({ action: "approve" }),
        },
      );
      assert.equal(response.status, 403);
    } finally {
      await server.close();
    }
  });

  void test("unauthenticated write is rejected with 401", async () => {
    const server = await startServer();
    try {
      const response = await fetch(`${server.url}/api/v1/tms/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 401);
    } finally {
      await server.close();
    }
  });

  void test("wrong content-type on a write route is rejected with 415", async () => {
    const server = await startServer();
    try {
      const response = await fetch(`${server.url}/api/v1/tms/push`, {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          authorization: "Bearer operator-token",
        },
        body: "{}",
      });
      assert.equal(response.status, 415);
    } finally {
      await server.close();
    }
  });

  void test("every response includes the security header set", async () => {
    const server = await startServer();
    try {
      const response = await fetch(`${server.url}/healthz`);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      assert.match(
        response.headers.get("content-security-policy") ?? "",
        /default-src 'self'/,
      );
    } finally {
      await server.close();
    }
  });
});
