import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  WorkspaceRuntimeLogInput,
  WorkspaceRuntimeLogger,
} from "@oscharko-dev/ti-security";
import {
  createAuditLogger,
  createIncidentReporter,
  createRequestLogger,
} from "./observability.js";

const captureLogger = (): {
  logger: WorkspaceRuntimeLogger;
  records: WorkspaceRuntimeLogInput[];
} => {
  const records: WorkspaceRuntimeLogInput[] = [];
  return {
    logger: { log: (input) => records.push(input) },
    records,
  };
};

void describe("createRequestLogger", () => {
  void test("formats info-level records for 2xx responses", () => {
    const { logger, records } = captureLogger();
    const reqLog = createRequestLogger(logger);
    reqLog.log({
      requestId: "abc",
      method: "GET",
      path: "/healthz",
      statusCode: 200,
      durationMs: 12,
      clientKey: "127.0.0.1",
    });
    assert.equal(records.length, 1);
    const first = records[0]!;
    assert.equal(first.level, "info");
    assert.equal(first.requestId, "abc");
    assert.equal(first.method, "GET");
    assert.equal(first.path, "/healthz");
    assert.equal(first.statusCode, 200);
    assert.match(first.message, /durationMs=12/);
  });

  void test("uses error level for 5xx", () => {
    const { logger, records } = captureLogger();
    createRequestLogger(logger).log({
      requestId: "x",
      method: "POST",
      path: "/api/v1/jobs",
      statusCode: 500,
      durationMs: 5,
      clientKey: "ip",
    });
    assert.equal(records[0]!.level, "error");
  });

  void test("includes the route label when present", () => {
    const { logger, records } = captureLogger();
    createRequestLogger(logger).log({
      requestId: "x",
      method: "GET",
      path: "/api/v1/jobs/abc",
      statusCode: 200,
      durationMs: 1,
      clientKey: "ip",
      route: "job.status",
    });
    assert.match(records[0]!.message, /route=job.status/);
  });

  void test("newRequestId returns distinct UUID-like values", () => {
    const reqLog = createRequestLogger(captureLogger().logger);
    const a = reqLog.newRequestId();
    const b = reqLog.newRequestId();
    assert.notEqual(a, b);
    assert.match(a, /^[0-9a-f-]{36}$/);
  });
});

void describe("createAuditLogger", () => {
  void test("emits one JSON line per record", () => {
    const lines: string[] = [];
    const audit = createAuditLogger({
      write: (line) => lines.push(line),
      now: () => "2026-05-23T00:00:00.000Z",
    });
    audit.record({
      action: "review.decide",
      subject: "queue-item-1",
      outcome: "ok",
      principal: "operator",
      requestId: "req-1",
      details: { decision: "approve" },
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.endsWith("\n"), true);
    const parsed = JSON.parse(lines[0]!.trim()) as Record<string, unknown>;
    assert.equal(parsed["action"], "review.decide");
    assert.equal(parsed["subject"], "queue-item-1");
    assert.equal(parsed["outcome"], "ok");
    assert.equal(parsed["principal"], "operator");
    assert.deepEqual(parsed["details"], { decision: "approve" });
  });

  void test("omits optional fields when not provided", () => {
    const lines: string[] = [];
    const audit = createAuditLogger({
      write: (line) => lines.push(line),
      now: () => "2026-05-23T00:00:00.000Z",
    });
    audit.record({
      action: "evidence.verify",
      subject: "job-1",
      outcome: "failed",
    });
    const parsed = JSON.parse(lines[0]!.trim()) as Record<string, unknown>;
    assert.equal("principal" in parsed, false);
    assert.equal("requestId" in parsed, false);
    assert.equal("details" in parsed, false);
  });
});

void describe("createIncidentReporter", () => {
  void test("warn() logs at warn level with code-prefixed message", () => {
    const { logger, records } = captureLogger();
    createIncidentReporter(logger).warn({
      code: "RATE_LIMITED",
      message: "client exceeded budget",
      requestId: "r1",
    });
    assert.equal(records[0]!.level, "warn");
    assert.match(records[0]!.message, /^incident:RATE_LIMITED /);
    assert.equal(records[0]!.requestId, "r1");
  });

  void test("fail() logs at error level", () => {
    const { logger, records } = captureLogger();
    createIncidentReporter(logger).fail({
      code: "LLM_GATEWAY_FAILED",
      message: "upstream timeout",
    });
    assert.equal(records[0]!.level, "error");
  });
});
