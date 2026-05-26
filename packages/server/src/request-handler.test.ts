import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, test } from "node:test";
import type { WorkspaceRuntimeLogger } from "@oscharko-dev/ti-security";
import { createTestIntelligenceRequestHandler } from "./request-handler.js";
import type {
  RouteHandler,
  RouteHandlerContext,
  TestIntelligenceRequestHandlerOptions,
} from "./request-handler-types.js";

interface Capture {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
}

const makeResponse = (): { capture: Capture; response: ServerResponse } => {
  const capture: Capture = {
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
      /* no-op */
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
    get headersSent() {
      return capture.statusCode !== 0;
    },
    get writableEnded() {
      return capture.ended;
    },
  } as unknown as ServerResponse;
  return { capture, response };
};

const makeRequest = (
  method: string,
  url: string,
  options: {
    headers?: Record<string, string>;
    body?: string;
    remoteAddress?: string;
  } = {},
): IncomingMessage => {
  const stream = Readable.from(
    options.body !== undefined
      ? Buffer.from(options.body, "utf8")
      : Buffer.from(""),
  );
  Object.assign(stream, {
    method,
    url,
    headers: options.headers ?? {},
    socket: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
  });
  return stream as unknown as IncomingMessage;
};

const silentLogger: WorkspaceRuntimeLogger = {
  log: () => {
    /* swallow */
  },
};

const baseOptions = (
  overrides: Partial<TestIntelligenceRequestHandlerOptions> = {},
): TestIntelligenceRequestHandlerOptions => ({
  host: "127.0.0.1",
  port: 1983,
  logger: silentLogger,
  testIntelligenceEnabled: true,
  ...overrides,
});

const dispatchAndWait = (
  options: TestIntelligenceRequestHandlerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const handler = createTestIntelligenceRequestHandler(options);
  handler(request, response);
  return new Promise((resolve) => setImmediate(resolve));
};

void describe("createTestIntelligenceRequestHandler - readonly routes", () => {
  void test("GET /healthz returns 200 with status payload", async () => {
    const { capture, response } = makeResponse();
    await dispatchAndWait(
      baseOptions(),
      makeRequest("GET", "/healthz"),
      response,
    );
    assert.equal(capture.statusCode, 200);
    const body = JSON.parse(capture.body) as { status: string };
    assert.equal(body.status, "ok");
  });

  void test("GET /readyz reports feature-gate and auth config", async () => {
    const { capture, response } = makeResponse();
    await dispatchAndWait(
      baseOptions({ bearerToken: "tok", testIntelligenceEnabled: false }),
      makeRequest("GET", "/readyz"),
      response,
    );
    assert.equal(capture.statusCode, 200);
    const body = JSON.parse(capture.body) as {
      featureGate: string;
      authConfigured: boolean;
    };
    assert.equal(body.featureGate, "disabled");
    assert.equal(body.authConfigured, true);
  });

  void test("OPTIONS returns 204 with CORS headers", async () => {
    const { capture, response } = makeResponse();
    await dispatchAndWait(
      baseOptions({ allowedCorsOrigins: ["http://127.0.0.1:1983"] }),
      makeRequest("OPTIONS", "/api/v1/jobs"),
      response,
    );
    assert.equal(capture.statusCode, 204);
    assert.equal(
      capture.headers["access-control-allow-origin"],
      "http://127.0.0.1:1983",
    );
  });

  void test("unknown route returns 404 NOT_FOUND", async () => {
    const { capture, response } = makeResponse();
    await dispatchAndWait(baseOptions(), makeRequest("GET", "/nope"), response);
    assert.equal(capture.statusCode, 404);
    const body = JSON.parse(capture.body) as { error: string };
    assert.equal(body.error, "NOT_FOUND");
  });

  void test("unsafe job id returns 400 BAD_REQUEST", async () => {
    const { capture, response } = makeResponse();
    await dispatchAndWait(
      baseOptions(),
      makeRequest("GET", "/api/v1/jobs/.."),
      response,
    );
    assert.equal(capture.statusCode, 400);
  });

  void test("wrong method returns 405 with Allow header", async () => {
    const { capture, response } = makeResponse();
    await dispatchAndWait(
      baseOptions(),
      makeRequest("DELETE", "/healthz"),
      response,
    );
    assert.equal(capture.statusCode, 405);
    assert.equal(capture.headers["allow"], "GET");
  });
});

void describe("createTestIntelligenceRequestHandler - write gates", () => {
  void test("POST /api/v1/jobs without feature gate returns 403", async () => {
    const { capture, response } = makeResponse();
    await dispatchAndWait(
      baseOptions({ testIntelligenceEnabled: false }),
      makeRequest("POST", "/api/v1/jobs", {
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      response,
    );
    assert.equal(capture.statusCode, 403);
    const body = JSON.parse(capture.body) as { error: string };
    assert.equal(body.error, "FEATURE_GATE_DISABLED");
  });

  void test("POST /api/v1/jobs without bearer config returns 503", async () => {
    const { capture, response } = makeResponse();
    await dispatchAndWait(
      baseOptions(),
      makeRequest("POST", "/api/v1/jobs", {
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      response,
    );
    assert.equal(capture.statusCode, 503);
    const body = JSON.parse(capture.body) as { error: string };
    assert.equal(body.error, "AUTHENTICATION_UNAVAILABLE");
  });

  void test("POST /api/v1/jobs with wrong bearer returns 401", async () => {
    const { capture, response } = makeResponse();
    await dispatchAndWait(
      baseOptions({ bearerToken: "expected" }),
      makeRequest("POST", "/api/v1/jobs", {
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wrong",
        },
        body: "{}",
      }),
      response,
    );
    assert.equal(capture.statusCode, 401);
    assert.match(capture.headers["www-authenticate"] ?? "", /^Bearer realm=/);
  });

  void test("POST /api/v1/jobs without JSON content-type returns 415", async () => {
    const { capture, response } = makeResponse();
    await dispatchAndWait(
      baseOptions({ bearerToken: "tok" }),
      makeRequest("POST", "/api/v1/jobs", {
        headers: { authorization: "Bearer tok" },
        body: "{}",
      }),
      response,
    );
    assert.equal(capture.statusCode, 415);
  });

  void test("POST /api/v1/jobs with correct bearer dispatches to handler", async () => {
    const { capture, response } = makeResponse();
    const handlerSeen: string[] = [];
    const submitHandler: RouteHandler = ({
      response: res,
    }: RouteHandlerContext) => {
      handlerSeen.push("submit_job");
      res.statusCode = 202;
      res.end(JSON.stringify({ accepted: true }));
    };
    await dispatchAndWait(
      baseOptions({
        bearerToken: "tok",
        routeHandlers: { submit_job: submitHandler },
      }),
      makeRequest("POST", "/api/v1/jobs", {
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tok",
        },
        body: "{}",
      }),
      response,
    );
    assert.deepEqual(handlerSeen, ["submit_job"]);
    assert.equal(capture.statusCode, 202);
  });

  void test("read routes do not require bearer auth", async () => {
    const { capture, response } = makeResponse();
    await dispatchAndWait(
      baseOptions(),
      makeRequest("GET", "/api/v1/review/job-1"),
      response,
    );
    assert.equal(capture.statusCode, 503);
    const body = JSON.parse(capture.body) as { error: string };
    assert.equal(body.error, "LLM_GATEWAY_UNCONFIGURED");
  });
});

void describe("createTestIntelligenceRequestHandler - rate limiting", () => {
  void test("returns 429 after the per-window budget is exhausted", async () => {
    const handler = createTestIntelligenceRequestHandler(
      baseOptions({ requestsPerMinute: 2, nowMs: () => 1_000 }),
    );
    for (let i = 0; i < 2; i += 1) {
      const { response } = makeResponse();
      handler(makeRequest("GET", "/healthz"), response);
    }
    const { capture, response } = makeResponse();
    handler(makeRequest("GET", "/healthz"), response);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(capture.statusCode, 429);
    assert.equal(capture.headers["retry-after"] !== undefined, true);
  });
});

void describe("createTestIntelligenceRequestHandler - error path", () => {
  void test("a throwing handler returns 500 INTERNAL_ERROR", async () => {
    const { capture, response } = makeResponse();
    const throwing: RouteHandler = () => {
      throw new Error("boom");
    };
    await dispatchAndWait(
      baseOptions({
        bearerToken: "tok",
        routeHandlers: { submit_job: throwing },
      }),
      makeRequest("POST", "/api/v1/jobs", {
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tok",
        },
        body: "{}",
      }),
      response,
    );
    assert.equal(capture.statusCode, 500);
    const body = JSON.parse(capture.body) as { error: string };
    assert.equal(body.error, "INTERNAL_ERROR");
  });
});
