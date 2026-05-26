import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, test } from "node:test";
import {
  applySecurityHeaders,
  beginSseResponse,
  readJsonBody,
  resolveClientKey,
  writeErrorResponse,
  writeJsonResponse,
} from "./http-helpers.js";

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
}

const makeResponse = (): {
  capture: CapturedResponse;
  response: ServerResponse;
} => {
  const capture: CapturedResponse = {
    statusCode: 0,
    headers: {},
    body: "",
    ended: false,
  };
  const response = {
    set statusCode(value: number) {
      capture.statusCode = value;
    },
    get statusCode() {
      return capture.statusCode;
    },
    setHeader(name: string, value: string) {
      capture.headers[name.toLowerCase()] = value;
    },
    flushHeaders() {
      /* no-op for tests */
    },
    write(chunk: string | Buffer) {
      capture.body +=
        typeof chunk === "string" ? chunk : chunk.toString("utf8");
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) {
        capture.body +=
          typeof chunk === "string" ? chunk : chunk.toString("utf8");
      }
      capture.ended = true;
    },
  } as unknown as ServerResponse;
  return { capture, response };
};

const makeJsonRequest = (
  body: string,
  options: { remoteAddress?: string; headers?: Record<string, string> } = {},
): IncomingMessage => {
  const stream = Readable.from(Buffer.from(body, "utf8"));
  Object.assign(stream, {
    headers: options.headers ?? {},
    socket: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
  });
  return stream as unknown as IncomingMessage;
};

void describe("applySecurityHeaders", () => {
  void test("sets the default header set", () => {
    const { capture, response } = makeResponse();
    applySecurityHeaders(response);
    assert.equal(capture.headers["x-content-type-options"], "nosniff");
    assert.equal(capture.headers["referrer-policy"], "no-referrer");
    assert.match(
      capture.headers["content-security-policy"] ?? "",
      /default-src 'self'/,
    );
  });

  void test("sets HSTS when an explicit value is provided", () => {
    const { capture, response } = makeResponse();
    applySecurityHeaders(response, { strictTransportSecurity: "max-age=60" });
    assert.equal(capture.headers["strict-transport-security"], "max-age=60");
  });

  void test("CSP can be overridden", () => {
    const { capture, response } = makeResponse();
    applySecurityHeaders(response, {
      contentSecurityPolicy: "default-src 'none'",
    });
    assert.equal(
      capture.headers["content-security-policy"],
      "default-src 'none'",
    );
  });
});

void describe("writeJsonResponse", () => {
  void test("writes a JSON body with security headers and 200 by default", () => {
    const { capture, response } = makeResponse();
    writeJsonResponse({
      response,
      statusCode: 200,
      payload: { ok: true },
    });
    assert.equal(capture.statusCode, 200);
    assert.equal(
      capture.headers["content-type"],
      "application/json; charset=utf-8",
    );
    assert.deepEqual(JSON.parse(capture.body), { ok: true });
    assert.equal(capture.ended, true);
  });

  void test("emits extraHeaders alongside defaults", () => {
    const { capture, response } = makeResponse();
    writeJsonResponse({
      response,
      statusCode: 201,
      payload: {},
      extraHeaders: { Location: "/api/v1/jobs/abc" },
    });
    assert.equal(capture.headers["location"], "/api/v1/jobs/abc");
  });
});

void describe("writeErrorResponse", () => {
  void test("maps error code to canonical status", () => {
    const { capture, response } = makeResponse();
    writeErrorResponse({
      response,
      code: "UNAUTHORIZED",
      message: "Token required.",
    });
    assert.equal(capture.statusCode, 401);
    const body = JSON.parse(capture.body) as { error: string };
    assert.equal(body.error, "UNAUTHORIZED");
  });

  void test("statusCode override is respected", () => {
    const { capture, response } = makeResponse();
    writeErrorResponse({
      response,
      code: "VERIFICATION_FAILED",
      message: "Report-only mode.",
      statusCode: 200,
    });
    assert.equal(capture.statusCode, 200);
  });
});

void describe("readJsonBody", () => {
  void test("parses a small JSON body", async () => {
    const request = makeJsonRequest('{"hello":1}');
    const result = await readJsonBody({ request, maxBytes: 1_024 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { hello: 1 });
  });

  void test("rejects empty bodies", async () => {
    const request = makeJsonRequest("");
    const result = await readJsonBody({ request, maxBytes: 1_024 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "BAD_REQUEST");
  });

  void test("rejects invalid JSON", async () => {
    const request = makeJsonRequest("{not json");
    const result = await readJsonBody({ request, maxBytes: 1_024 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "BAD_REQUEST");
  });

  void test("rejects oversize bodies before parsing", async () => {
    const request = makeJsonRequest("a".repeat(2_048));
    const result = await readJsonBody({ request, maxBytes: 1_024 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "PAYLOAD_TOO_LARGE");
  });
});

void describe("beginSseResponse", () => {
  void test("frames events deterministically with id and event lines", () => {
    const { capture, response } = makeResponse();
    const sse = beginSseResponse(response);
    sse.writeEvent({ event: "phase", data: { stage: "plan" }, id: "1" });
    sse.writeEvent({ event: "phase", data: { stage: "judge" }, id: "2" });
    sse.end();
    const lines = capture.body.split("\n");
    assert.equal(lines[0], "id: 1");
    assert.equal(lines[1], "event: phase");
    assert.equal(lines[2], 'data: {"stage":"plan"}');
    assert.equal(capture.ended, true);
  });

  void test("writes a retry frame on demand", () => {
    const { capture, response } = makeResponse();
    const sse = beginSseResponse(response);
    sse.writeRetry(5_000);
    assert.match(capture.body, /^retry: 5000\n\n/);
  });

  void test("emits exactly one data: line for compact JSON payloads", () => {
    const { capture, response } = makeResponse();
    const sse = beginSseResponse(response);
    sse.writeEvent({
      event: "msg",
      data: { multi: "line1\nline2" },
      id: "x",
    });
    const occurrences = capture.body.match(/^data: /gm) ?? [];
    // JSON.stringify escapes \n to backslash-n, so compact serialization
    // never emits a literal newline in the data payload.
    assert.equal(occurrences.length, 1);
    assert.match(capture.body, /data: \{"multi":"line1\\nline2"\}/);
  });
});

void describe("resolveClientKey", () => {
  void test("returns the socket address when no forwarded header is set", () => {
    const request = makeJsonRequest("", { remoteAddress: "10.0.0.1" });
    assert.equal(resolveClientKey(request), "10.0.0.1");
  });

  void test("prefers the first hop in x-forwarded-for", () => {
    const request = makeJsonRequest("", {
      remoteAddress: "10.0.0.1",
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    assert.equal(resolveClientKey(request), "203.0.113.5");
  });

  void test("falls back to unknown when nothing is available", () => {
    const stream = Readable.from(Buffer.from(""));
    Object.assign(stream, { headers: {}, socket: {} });
    assert.equal(
      resolveClientKey(stream as unknown as IncomingMessage),
      "unknown",
    );
  });
});
