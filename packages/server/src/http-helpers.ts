/**
 * Transport-level helpers used by every route handler.
 *
 * Three concerns live here:
 *   1. Reading and bounding JSON request bodies (`readJsonBody`).
 *   2. Writing JSON / SSE responses with a uniform security-header set
 *      (`writeJsonResponse`, `writeErrorResponse`, `writeSseFrame`,
 *      `writeSseRetry`).
 *   3. Reading the client identity used by the rate limiter
 *      (`resolveClientKey`).
 *
 * Every response goes through {@link applySecurityHeaders} so the CSP, HSTS,
 * X-Content-Type-Options, and Referrer-Policy posture is consistent.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEFAULT_CONTENT_SECURITY_POLICY,
  resolveStrictTransportSecurity,
} from "./constants.js";
import {
  statusForErrorCode,
  type TestIntelligenceErrorCode,
  type TestIntelligenceErrorEnvelope,
} from "./error-codes.js";

export interface SecurityHeaderOptions {
  readonly strictTransportSecurity?: string | undefined;
  readonly contentSecurityPolicy?: string;
}

export const applySecurityHeaders = (
  response: ServerResponse,
  options: SecurityHeaderOptions = {},
): void => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    options.contentSecurityPolicy ?? DEFAULT_CONTENT_SECURITY_POLICY,
  );
  const hsts =
    options.strictTransportSecurity ?? resolveStrictTransportSecurity();
  if (hsts !== undefined) {
    response.setHeader("Strict-Transport-Security", hsts);
  }
};

export const writeJsonResponse = ({
  response,
  statusCode,
  payload,
  extraHeaders,
}: {
  response: ServerResponse;
  statusCode: number;
  payload: unknown;
  extraHeaders?: Readonly<Record<string, string>>;
}): void => {
  applySecurityHeaders(response);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (extraHeaders !== undefined) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      response.setHeader(name, value);
    }
  }
  response.statusCode = statusCode;
  response.end(JSON.stringify(payload));
};

export const writeErrorResponse = ({
  response,
  code,
  message,
  extraHeaders,
  statusCode,
}: {
  response: ServerResponse;
  code: TestIntelligenceErrorCode;
  message: string;
  extraHeaders?: Readonly<Record<string, string>>;
  statusCode?: number;
}): void => {
  const envelope: TestIntelligenceErrorEnvelope = { error: code, message };
  writeJsonResponse({
    response,
    statusCode: statusCode ?? statusForErrorCode(code),
    payload: envelope,
    ...(extraHeaders !== undefined ? { extraHeaders } : {}),
  });
};

export interface ReadJsonBodyOk {
  readonly ok: true;
  readonly value: unknown;
}

export interface ReadJsonBodyErr {
  readonly ok: false;
  readonly code: "PAYLOAD_TOO_LARGE" | "BAD_REQUEST";
  readonly message: string;
}

export type ReadJsonBodyResult = ReadJsonBodyOk | ReadJsonBodyErr;

export const readJsonBody = async ({
  request,
  maxBytes,
}: {
  request: IncomingMessage;
  maxBytes: number;
}): Promise<ReadJsonBodyResult> => {
  const chunks: Buffer[] = [];
  let received = 0;

  for await (const chunk of request) {
    const buf =
      typeof chunk === "string"
        ? Buffer.from(chunk, "utf8")
        : (chunk as Buffer);
    received += buf.length;
    if (received > maxBytes) {
      return {
        ok: false,
        code: "PAYLOAD_TOO_LARGE",
        message: `Request body exceeds ${maxBytes} bytes.`,
      };
    }
    chunks.push(buf);
  }

  if (chunks.length === 0) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: "Request body is empty.",
    };
  }

  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: "Request body is not valid JSON.",
    };
  }
};

export interface SseWriter {
  writeEvent(input: { event: string; data: unknown; id?: string }): void;
  writeRetry(retryMs: number): void;
  end(): void;
}

export const beginSseResponse = (
  response: ServerResponse,
  options: SecurityHeaderOptions = {},
): SseWriter => {
  applySecurityHeaders(response, options);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.statusCode = 200;
  response.flushHeaders();

  return {
    writeEvent({ event, data, id }) {
      const lines: string[] = [];
      if (id !== undefined) {
        lines.push(`id: ${id}`);
      }
      lines.push(`event: ${event}`);
      const serialized = JSON.stringify(data);
      // `JSON.stringify` with no spacing never emits a literal newline, so
      // the payload is always a single `data:` line. We still split on `\n`
      // to remain spec-compliant if a caller ever pre-serializes with
      // embedded newlines (the SSE spec requires multi-line splitting).
      for (const line of serialized.split("\n")) {
        lines.push(`data: ${line}`);
      }
      lines.push("", "");
      response.write(lines.join("\n"));
    },
    writeRetry(retryMs) {
      response.write(`retry: ${String(retryMs)}\n\n`);
    },
    end() {
      response.end();
    },
  };
};

const FORWARDED_FOR_HEADER = "x-forwarded-for";

/**
 * Resolve the rate-limit client key. Prefers the first hop in
 * `X-Forwarded-For` when present (so a reverse-proxy deployment scopes
 * limits per real client) and falls back to the socket remote address.
 */
export const resolveClientKey = (request: IncomingMessage): string => {
  const forwarded = request.headers[FORWARDED_FOR_HEADER];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof raw === "string" && raw.length > 0) {
    const first = raw.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return first;
    }
  }
  return request.socket.remoteAddress ?? "unknown";
};
