import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { describe, test } from "node:test";
import {
  getAllowedWriteOrigins,
  readBearerToken,
  validateBearerToken,
  validateWriteRequest,
} from "./request-security.js";

const makeRequest = (
  headers: Record<string, string | string[]>,
): IncomingMessage => {
  return { headers } as unknown as IncomingMessage;
};

void describe("getAllowedWriteOrigins", () => {
  void test("includes loopback aliases for 127.0.0.1", () => {
    const set = getAllowedWriteOrigins({ host: "127.0.0.1", port: 1983 });
    assert.ok(set.has("http://127.0.0.1:1983"));
    assert.ok(set.has("http://localhost:1983"));
    assert.ok(set.has("http://[::1]:1983"));
  });

  void test("returns only the configured origin for non-loopback hosts", () => {
    const set = getAllowedWriteOrigins({ host: "10.0.0.5", port: 8080 });
    assert.deepEqual([...set], ["http://10.0.0.5:8080"]);
  });

  void test("wraps bare IPv6 hosts in brackets", () => {
    const set = getAllowedWriteOrigins({ host: "::1", port: 1983 });
    assert.ok(set.has("http://[::1]:1983"));
  });
});

void describe("validateWriteRequest", () => {
  const baseArgs = { host: "127.0.0.1", port: 1983 };

  void test("rejects missing Content-Type", () => {
    const result = validateWriteRequest({
      request: makeRequest({}),
      ...baseArgs,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 415);
    assert.equal(result.payload.error, "UNSUPPORTED_MEDIA_TYPE");
  });

  void test("rejects non-JSON Content-Type", () => {
    const result = validateWriteRequest({
      request: makeRequest({ "content-type": "text/plain" }),
      ...baseArgs,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 415);
  });

  void test("accepts application/json with no browser metadata", () => {
    const result = validateWriteRequest({
      request: makeRequest({ "content-type": "application/json" }),
      ...baseArgs,
    });
    assert.equal(result.ok, true);
  });

  void test("accepts application/json with charset parameter", () => {
    const result = validateWriteRequest({
      request: makeRequest({
        "content-type": "application/json; charset=utf-8",
      }),
      ...baseArgs,
    });
    assert.equal(result.ok, true);
  });

  void test("rejects cross-site sec-fetch-site", () => {
    const result = validateWriteRequest({
      request: makeRequest({
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
      }),
      ...baseArgs,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 403);
  });

  void test("rejects mismatched Origin header", () => {
    const result = validateWriteRequest({
      request: makeRequest({
        "content-type": "application/json",
        origin: "https://attacker.example.com",
      }),
      ...baseArgs,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 403);
  });

  void test("accepts loopback Origin header", () => {
    const result = validateWriteRequest({
      request: makeRequest({
        "content-type": "application/json",
        origin: "http://127.0.0.1:1983",
      }),
      ...baseArgs,
    });
    assert.equal(result.ok, true);
  });

  void test("rejects mismatched Referer", () => {
    const result = validateWriteRequest({
      request: makeRequest({
        "content-type": "application/json",
        referer: "https://attacker.example.com/page",
      }),
      ...baseArgs,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 403);
  });
});

void describe("readBearerToken", () => {
  void test("returns undefined when Authorization header is absent", () => {
    assert.equal(readBearerToken(makeRequest({})), undefined);
  });

  void test("returns undefined when scheme is not Bearer", () => {
    assert.equal(
      readBearerToken(makeRequest({ authorization: "Basic abc" })),
      undefined,
    );
  });

  void test("accepts case-insensitive Bearer scheme", () => {
    assert.equal(
      readBearerToken(makeRequest({ authorization: "bearer token123" })),
      "token123",
    );
    assert.equal(
      readBearerToken(makeRequest({ authorization: "BEARER token123" })),
      "token123",
    );
  });

  void test("trims whitespace around the token", () => {
    assert.equal(
      readBearerToken(makeRequest({ authorization: "Bearer    token123 " })),
      "token123",
    );
  });

  void test("returns undefined for empty token", () => {
    assert.equal(
      readBearerToken(makeRequest({ authorization: "Bearer " })),
      undefined,
    );
  });

  void test("returns undefined when no whitespace after scheme", () => {
    assert.equal(
      readBearerToken(makeRequest({ authorization: "Bearertoken" })),
      undefined,
    );
  });
});

void describe("validateBearerToken", () => {
  const routeLabel = "/api/v1/review";

  void test("returns 503 when bearer token is not configured", () => {
    const result = validateBearerToken({
      request: makeRequest({}),
      bearerToken: undefined,
      routeLabel,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error, "AUTHENTICATION_UNAVAILABLE");
  });

  void test("returns 503 when configured token is empty after trimming", () => {
    const result = validateBearerToken({
      request: makeRequest({}),
      bearerToken: "   ",
      routeLabel,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 503);
  });

  void test("returns 401 when no token is sent", () => {
    const result = validateBearerToken({
      request: makeRequest({}),
      bearerToken: "configured-token",
      routeLabel,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 401);
    assert.equal(result.wwwAuthenticate, 'Bearer realm="test-intelligence"');
  });

  void test("returns 401 when the wrong token is sent", () => {
    const result = validateBearerToken({
      request: makeRequest({ authorization: "Bearer wrong" }),
      bearerToken: "configured-token",
      routeLabel,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 401);
  });

  void test("returns ok when the token matches", () => {
    const result = validateBearerToken({
      request: makeRequest({ authorization: "Bearer configured-token" }),
      bearerToken: "configured-token",
      routeLabel,
    });
    assert.equal(result.ok, true);
    assert.equal(result.principal.scheme, "bearer");
  });
});
