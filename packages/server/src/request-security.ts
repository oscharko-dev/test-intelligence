/**
 * Per-request transport-security helpers.
 *
 * Two boundaries live here:
 *   1. Bearer-token validation (constant-time over sha256 digests).
 *   2. Same-origin / Content-Type validation for write routes.
 *
 * Production handlers never compare bearer tokens directly; they always go
 * through {@link validateBearerToken} so the timing-safe path is the only
 * path. Missing operator configuration (`bearerToken === undefined`)
 * intentionally returns `503 AUTHENTICATION_UNAVAILABLE` rather than `401`
 * so an unconfigured deployment can be distinguished from a wrong-token
 * client.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*(?:;|$))/i;
const ALLOWED_SEC_FETCH_SITE_VALUES = new Set(["same-origin", "same-site"]);
const TEST_INTELLIGENCE_BEARER_REALM = "test-intelligence";

export interface RequestSecurityOk {
  readonly ok: true;
}

export interface RequestSecurityErr {
  readonly ok: false;
  readonly statusCode: number;
  readonly payload: {
    readonly error: "FORBIDDEN_REQUEST_ORIGIN" | "UNSUPPORTED_MEDIA_TYPE";
    readonly message: string;
  };
}

export type RequestSecurityResult = RequestSecurityOk | RequestSecurityErr;

export interface BearerAuthOk {
  readonly ok: true;
  readonly principal: { readonly scheme: "bearer" };
}

export interface BearerAuthErr {
  readonly ok: false;
  readonly statusCode: 401 | 503;
  readonly payload: {
    readonly error: "UNAUTHORIZED" | "AUTHENTICATION_UNAVAILABLE";
    readonly message: string;
  };
  readonly wwwAuthenticate?: string;
}

export type BearerAuthResult = BearerAuthOk | BearerAuthErr;

const getHeaderValue = (
  value: string | string[] | undefined,
): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
};

const normalizeOrigin = (value: string | undefined): string | undefined => {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

const normalizeOriginHost = (host: string): string => {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
};

const isLoopbackLikeHost = (host: string): boolean => {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "[::]"
  );
};

export const getAllowedWriteOrigins = ({
  host,
  port,
}: {
  host: string;
  port: number;
}): Set<string> => {
  const allowed = new Set<string>([
    `http://${normalizeOriginHost(host)}:${port}`,
  ]);
  if (isLoopbackLikeHost(host)) {
    allowed.add(`http://127.0.0.1:${port}`);
    allowed.add(`http://localhost:${port}`);
    allowed.add(`http://[::1]:${port}`);
  }
  return allowed;
};

export const validateWriteRequest = ({
  request,
  host,
  port,
}: {
  request: IncomingMessage;
  host: string;
  port: number;
}): RequestSecurityResult => {
  const contentType = getHeaderValue(request.headers["content-type"]);
  if (
    contentType === undefined ||
    !JSON_CONTENT_TYPE_PATTERN.test(contentType)
  ) {
    return {
      ok: false,
      statusCode: 415,
      payload: {
        error: "UNSUPPORTED_MEDIA_TYPE",
        message: "Write routes require 'Content-Type: application/json'.",
      },
    };
  }

  const originHeader = getHeaderValue(request.headers.origin);
  const refererHeader = getHeaderValue(request.headers.referer);
  const secFetchSite = getHeaderValue(request.headers["sec-fetch-site"])
    ?.trim()
    .toLowerCase();
  const allowedOrigins = getAllowedWriteOrigins({ host, port });

  if (
    secFetchSite !== undefined &&
    !ALLOWED_SEC_FETCH_SITE_VALUES.has(secFetchSite)
  ) {
    return forbiddenOrigin(
      "Cross-site browser requests to test-intelligence write routes are blocked.",
    );
  }

  if (originHeader !== undefined) {
    const origin = normalizeOrigin(originHeader);
    if (origin === undefined || !allowedOrigins.has(origin)) {
      return forbiddenOrigin(
        "Only same-origin browser requests may access test-intelligence write routes.",
      );
    }
  }

  if (refererHeader !== undefined) {
    const refererOrigin = normalizeOrigin(refererHeader);
    if (refererOrigin === undefined || !allowedOrigins.has(refererOrigin)) {
      return forbiddenOrigin(
        "Only same-origin browser requests may access test-intelligence write routes.",
      );
    }
  }

  return { ok: true };
};

const forbiddenOrigin = (message: string): RequestSecurityErr => ({
  ok: false,
  statusCode: 403,
  payload: { error: "FORBIDDEN_REQUEST_ORIGIN", message },
});

const normalizeConfiguredBearerToken = (
  value: string | undefined,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const readBearerToken = (
  request: IncomingMessage,
): string | undefined => {
  const authorization = getHeaderValue(request.headers.authorization);
  if (authorization === undefined) {
    return undefined;
  }

  const expectedScheme = "bearer";
  if (authorization.length <= expectedScheme.length) {
    return undefined;
  }

  for (let index = 0; index < expectedScheme.length; index += 1) {
    const code = authorization.charCodeAt(index);
    const lowered =
      code >= 0x41 && code <= 0x5a
        ? String.fromCharCode(code + 0x20)
        : authorization[index];
    if (lowered !== expectedScheme[index]) {
      return undefined;
    }
  }

  let tokenStart = expectedScheme.length;
  while (tokenStart < authorization.length) {
    const code = authorization.charCodeAt(tokenStart);
    if (code !== 0x20 && code !== 0x09) {
      break;
    }
    tokenStart += 1;
  }

  if (
    tokenStart === expectedScheme.length ||
    tokenStart >= authorization.length
  ) {
    return undefined;
  }

  let tokenEnd = authorization.length;
  while (tokenEnd > tokenStart) {
    const code = authorization.charCodeAt(tokenEnd - 1);
    if (code !== 0x20 && code !== 0x09) {
      break;
    }
    tokenEnd -= 1;
  }

  return tokenEnd > tokenStart
    ? authorization.slice(tokenStart, tokenEnd)
    : undefined;
};

const tokensMatch = (expected: string, candidate: string): boolean => {
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const candidateDigest = createHash("sha256")
    .update(candidate, "utf8")
    .digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
};

export const validateBearerToken = ({
  request,
  bearerToken,
  routeLabel,
}: {
  request: IncomingMessage;
  bearerToken: string | undefined;
  routeLabel: string;
}): BearerAuthResult => {
  const configuredToken = normalizeConfiguredBearerToken(bearerToken);
  if (configuredToken === undefined) {
    return {
      ok: false,
      statusCode: 503,
      payload: {
        error: "AUTHENTICATION_UNAVAILABLE",
        message: `${routeLabel} writes are disabled until server bearer authentication is configured.`,
      },
    };
  }

  const receivedToken = readBearerToken(request);
  if (
    receivedToken !== undefined &&
    tokensMatch(configuredToken, receivedToken)
  ) {
    return { ok: true, principal: { scheme: "bearer" } };
  }

  return {
    ok: false,
    statusCode: 401,
    payload: {
      error: "UNAUTHORIZED",
      message: `${routeLabel} writes require a valid Bearer token.`,
    },
    wwwAuthenticate: `Bearer realm="${TEST_INTELLIGENCE_BEARER_REALM}"`,
  };
};
