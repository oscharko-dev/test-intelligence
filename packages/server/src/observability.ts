/**
 * Operational observability for the standalone HTTP runtime.
 *
 * Three sinks are exposed:
 *   1. {@link createRequestLogger} — structured per-request log records
 *      flowing through the existing {@link WorkspaceRuntimeLogger}. Each
 *      record carries method, path, status, duration, and request ID.
 *   2. {@link createAuditLogger} — append-only audit lines for governance
 *      events (review decisions, evidence-verify outcomes, TMS pushes).
 *      Audit lines are JSON, one per line, and never leave the process.
 *   3. {@link createIncidentReporter} — adapter from operational warnings
 *      to the in-process `IncidentSink` (see incident-sink.ts).
 *
 * Consistent with the product's zero-telemetry posture, none of these
 * sinks open a network socket. All output is local: stdout/stderr for the
 * request logger by default, an operator-supplied writer for the audit
 * log, and an operator-supplied `IncidentSink` for the incident reporter.
 */

import { randomUUID } from "node:crypto";
import type { WorkspaceRuntimeLogger } from "@oscharko-dev/ti-security";

export interface RequestObservation {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly clientKey: string;
  readonly route?: string;
}

export interface RequestLogger {
  log(observation: RequestObservation): void;
  newRequestId(): string;
}

export const createRequestLogger = (
  logger: WorkspaceRuntimeLogger,
): RequestLogger => {
  return {
    log({ requestId, method, path, statusCode, durationMs, clientKey, route }) {
      const segments = [
        `method=${method}`,
        `path=${path}`,
        `status=${String(statusCode)}`,
        `durationMs=${String(durationMs)}`,
        `client=${clientKey}`,
      ];
      if (route !== undefined) {
        segments.push(`route=${route}`);
      }
      logger.log({
        level: statusCode >= 500 ? "error" : "info",
        message: segments.join(" "),
        requestId,
        method,
        path,
        statusCode,
      });
    },
    newRequestId() {
      return randomUUID();
    },
  };
};

export interface AuditEvent {
  readonly action: string;
  readonly subject: string;
  readonly outcome: "ok" | "denied" | "failed";
  readonly principal?: string;
  readonly requestId?: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export interface AuditLogger {
  record(event: AuditEvent): void;
}

export interface CreateAuditLoggerInput {
  readonly write: (line: string) => void;
  readonly now?: () => string;
}

export const createAuditLogger = ({
  write,
  now = () => new Date().toISOString(),
}: CreateAuditLoggerInput): AuditLogger => {
  return {
    record(event) {
      const line = JSON.stringify({
        ts: now(),
        action: event.action,
        subject: event.subject,
        outcome: event.outcome,
        ...(event.principal !== undefined
          ? { principal: event.principal }
          : {}),
        ...(event.requestId !== undefined
          ? { requestId: event.requestId }
          : {}),
        ...(event.details !== undefined ? { details: event.details } : {}),
      });
      write(`${line}\n`);
    },
  };
};

export interface IncidentReporter {
  warn(event: { code: string; message: string; requestId?: string }): void;
  fail(event: { code: string; message: string; requestId?: string }): void;
}

export const createIncidentReporter = (
  logger: WorkspaceRuntimeLogger,
): IncidentReporter => {
  return {
    warn(event) {
      logger.log({
        level: "warn",
        message: `incident:${event.code} ${event.message}`,
        ...(event.requestId !== undefined
          ? { requestId: event.requestId }
          : {}),
      });
    },
    fail(event) {
      logger.log({
        level: "error",
        message: `incident:${event.code} ${event.message}`,
        ...(event.requestId !== undefined
          ? { requestId: event.requestId }
          : {}),
      });
    },
  };
};
