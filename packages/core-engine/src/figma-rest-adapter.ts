/**
 * Figma REST adapter for the test-intelligence production runner
 * (Issues #1733, #1734).
 *
 * Goals enforced here:
 *   - SSRF defence: only `api.figma.com` over `https:`. URL parsing rejects
 *     non-figma hostnames, http://, embedded credentials, and missing
 *     fileKey before any network call.
 *   - Token discipline: the access token is forwarded ONLY as the
 *     `X-Figma-Token` header on outbound requests. Errors are routed through
 *     `redactHighRiskSecrets` + `sanitizeErrorMessage` so neither the token
 *     nor any token-shaped value smuggled into the response body leaks.
 *   - Failure-class disjointness: `auth_failed` (401/403, fail-closed),
 *     `not_found` (404), `rate_limited` (429), `transport` (5xx, retry once),
 *     `timeout`, `parse_error` (malformed JSON body).
 *   - Retry budget: at most one retry on a transient class. 429 retries honor
 *     Figma's Retry-After header when it stays within the local retry budget.
 *     Auth/4xx never retry. Default per-request timeout 30s.
 *
 * Why we do not import the existing `figma-source.ts`: that module lives in
 * `src/job-engine/` and `lint:boundaries` blocks `src/test-intelligence/`
 * from depending on `src/job-engine/`. The test-intelligence runner needs a
 * minimal, hardened fetcher that fits this air-gap-friendly module pattern;
 * a future consolidation is tracked separately.
 */

import {
  redactHighRiskSecrets,
  sanitizeErrorMessage,
  sha256Hex,
} from "@oscharko-dev/ti-security";
import { readFile } from "node:fs/promises";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import * as tls from "node:tls";

const FIGMA_REST_HOST = "api.figma.com" as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FIGMA_RETRY_AFTER_SECONDS = 1;
const MAX_FIGMA_RETRY_AFTER_SECONDS = 60;
const FIGMA_URL_DESIGN_PATH_RE = /^\/(?:design|file|proto)\/([^/]+)/u;
const FIGMA_NODE_ID_RE = /^[A-Za-z0-9_.:;-]+$/u;
const URI_LIKE_RE =
  /(?:\b[A-Za-z][A-Za-z0-9+.-]*:\/\/|\b(?:mailto|tel|sms|urn|data|javascript):)\S+/iu;
const URI_LIKE_GLOBAL_RE =
  /(?:\b[A-Za-z][A-Za-z0-9+.-]*:\/\/|\b(?:mailto|tel|sms|urn|data|javascript):)\S+/giu;
const FIGMA_TOKEN_LIKE_GLOBAL_RE = /\bfigd_[A-Za-z0-9_-]{8,}\b/giu;
const DEFAULT_FIGMA_IMAGE_SCALE = 2;
const ALLOWED_FIGMA_CDN_HOSTS: readonly string[] = [
  "figma.com",
  ".figma.com",
  "figma-alpha-api.s3.us-west-2.amazonaws.com",
  "figma-alpha-api.s3.amazonaws.com",
];

/** Failure classes returned by {@link FigmaRestFetchError.errorClass}. */
export type FigmaRestFetchErrorClass =
  | "auth_failed"
  | "not_found"
  | "rate_limited"
  | "transport"
  | "timeout"
  | "parse_error"
  | "ssrf_refused"
  | "request_invalid";

/**
 * Stable error class with a discriminant + retryable flag. Mirrors the
 * shape used by the LLM gateway client so the production runner can
 * surface a uniform `failureClass` envelope to callers.
 */
export class FigmaRestFetchError extends Error {
  readonly errorClass: FigmaRestFetchErrorClass;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly figmaPlanTier?: string;
  readonly figmaRateLimitType?: string;
  readonly figmaUpgradeLinkDigest?: string;

  constructor(input: {
    errorClass: FigmaRestFetchErrorClass;
    message: string;
    retryable: boolean;
    status?: number;
    retryAfterSeconds?: number;
    figmaPlanTier?: string;
    figmaRateLimitType?: string;
    figmaUpgradeLinkDigest?: string;
    cause?: unknown;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "FigmaRestFetchError";
    this.errorClass = input.errorClass;
    this.retryable = input.retryable;
    if (input.status !== undefined) {
      this.status = input.status;
    }
    if (input.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = input.retryAfterSeconds;
    }
    if (input.figmaPlanTier !== undefined) {
      this.figmaPlanTier = input.figmaPlanTier;
    }
    if (input.figmaRateLimitType !== undefined) {
      this.figmaRateLimitType = input.figmaRateLimitType;
    }
    if (input.figmaUpgradeLinkDigest !== undefined) {
      this.figmaUpgradeLinkDigest = input.figmaUpgradeLinkDigest;
    }
  }
}

/** Parsed canonical view of a Figma file/document used downstream. */
export interface FigmaRestFileSnapshot {
  /** Figma file display name. */
  name: string;
  /** ISO-8601 timestamp of the file's last modification, when present. */
  lastModified?: string;
  /** Upstream Figma file version, when present. */
  version?: string;
  /** Source key used to fetch the file. */
  fileKey: string;
  /** When fetched node-scoped, the requested node id; otherwise undefined. */
  nodeId?: string;
  /** The root document. For node-scoped fetches, the requested subtree. */
  document: FigmaRestNode;
}

/** Minimal Figma REST node shape consumed by the normalizer. */
export interface FigmaRestNode {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  characters?: string;
  componentPropertyDefinitions?: Record<string, unknown>;
  children?: FigmaRestNode[];
  absoluteBoundingBox?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
}

export interface FetchFigmaFileForTestIntelligenceInput {
  fileKey: string;
  accessToken: string;
  nodeId?: string;
  /**
   * Optional REST depth for bootstrap imports. Kept bounded so callers can
   * discover page/top-level node structure without fetching huge boards.
   */
  depth?: number;
  /** Override for tests; production defaults to the hardened trusted fetch. */
  fetchImpl?: typeof fetch;
  /** Optional PEM CA bundle for enterprise TLS interception. */
  caCertPath?: string;
  /** Wall-clock timeout in ms (defaults to 30_000). */
  timeoutMs?: number;
  /** Hard upper bound on the response body, in bytes (defaults to 32 MiB). */
  maxResponseBytes?: number;
  /** Observer used by resumable import orchestration to persist safe metadata. */
  onRateLimited?: FigmaRestRateLimitObserver;
  /** Observer invoked before each live Figma REST request attempt. */
  onFigmaRestRequest?: FigmaRestRequestObserver;
  /** Override for tests so 429 handling can be verified without wall-clock waits. */
  sleepMs?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface FetchFigmaScreenCapturesForTestIntelligenceInput {
  fileKey: string;
  accessToken: string;
  screens: ReadonlyArray<{ screenId: string; screenName?: string }>;
  fetchImpl?: typeof fetch;
  caCertPath?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  scale?: number;
  /** Observer invoked before each live Figma REST request attempt. */
  onFigmaRestRequest?: FigmaRestRequestObserver;
}

export interface FigmaRestRateLimitMetadata {
  retryAfterSeconds?: number;
  figmaPlanTier?: string;
  figmaRateLimitType?: string;
  figmaUpgradeLinkDigest?: string;
}

export type FigmaRestRateLimitObserver = (
  metadata: Readonly<FigmaRestRateLimitMetadata>,
) => void;

export type FigmaRestRequestObserver = () => void;

export interface FetchFigmaNodesForTestIntelligenceInput {
  fileKey: string;
  accessToken: string;
  nodeIds: readonly string[];
  fetchImpl?: typeof fetch;
  caCertPath?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  onRateLimited?: FigmaRestRateLimitObserver;
  onFigmaRestRequest?: FigmaRestRequestObserver;
  sleepMs?: (ms: number) => Promise<void>;
}

export interface FigmaRestNodeBatchSnapshot {
  name: string;
  lastModified?: string;
  version?: string;
  fileKey: string;
  nodes: ReadonlyMap<string, FigmaRestNode>;
}

export interface FetchFigmaImageMetadataForTestIntelligenceInput {
  fileKey: string;
  accessToken: string;
  nodeIds: readonly string[];
  fetchImpl?: typeof fetch;
  caCertPath?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  scale?: number;
  onRateLimited?: FigmaRestRateLimitObserver;
  onFigmaRestRequest?: FigmaRestRequestObserver;
  sleepMs?: (ms: number) => Promise<void>;
}

export interface FigmaRestImageMetadataRecord {
  nodeId: string;
  renderable: boolean;
  imageUrlDigest?: string;
  reason?: "missing" | "null";
}

export interface FigmaRestImageMetadataBatch {
  fileKey: string;
  images: readonly FigmaRestImageMetadataRecord[];
}

/** Parse a public Figma URL and extract the (fileKey, nodeId?) pair. */
export const parseFigmaUrl = (
  rawUrl: string,
): { fileKey: string; nodeId?: string } => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "figmaUrl is not a valid URL",
      retryable: false,
    });
  }
  if (url.protocol !== "https:") {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: `figmaUrl must use https:// (got ${url.protocol})`,
      retryable: false,
    });
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname !== "www.figma.com" &&
    hostname !== "figma.com" &&
    hostname !== "api.figma.com"
  ) {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: `figmaUrl host must be figma.com (got ${hostname})`,
      retryable: false,
    });
  }
  const match = FIGMA_URL_DESIGN_PATH_RE.exec(url.pathname);
  if (!match || !match[1]) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "figmaUrl is missing a Figma file key",
      retryable: false,
    });
  }
  const fileKey = decodeURIComponent(match[1]);
  const rawNodeId = url.searchParams.get("node-id") ?? undefined;
  const nodeId =
    rawNodeId === undefined || rawNodeId.length === 0
      ? undefined
      : rawNodeId.replace(/-/gu, ":");
  if (nodeId !== undefined && !FIGMA_NODE_ID_RE.test(nodeId)) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: `figmaUrl node-id is invalid (${redactIdentifierForDiagnostics(nodeId)})`,
      retryable: false,
    });
  }
  return nodeId === undefined ? { fileKey } : { fileKey, nodeId };
};

/**
 * Fetch a Figma file (or node-scoped subtree) via the Figma REST API.
 *
 * Retry policy: at most one retry, and only when the first attempt failed
 * with a transient class (5xx, 429, timeout, transport). Non-transient
 * classes (auth_failed, not_found, parse_error, ssrf_refused) fail closed.
 */
export const fetchFigmaFileForTestIntelligence = async (
  input: FetchFigmaFileForTestIntelligenceInput,
): Promise<FigmaRestFileSnapshot> => {
  const fileKey = input.fileKey.trim();
  if (fileKey.length === 0) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "fileKey is required",
      retryable: false,
    });
  }
  if (typeof input.accessToken !== "string" || input.accessToken.length === 0) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "accessToken is required",
      retryable: false,
    });
  }
  const fetchImpl = resolveFigmaFetch(input.fetchImpl, input.caCertPath);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const depth = resolveFigmaDepth(input.depth);
  const nodeId =
    input.nodeId === undefined
      ? undefined
      : normalizeNodeIds([input.nodeId])[0];
  const url = buildFigmaRestUrl(
    nodeId === undefined
      ? depth === undefined
        ? { fileKey }
        : { fileKey, depth }
      : depth === undefined
        ? { fileKey, nodeId }
        : { fileKey, nodeId, depth },
  );
  // Hard gate: the constructed URL must point at api.figma.com over https.
  // If a future change introduces a path-template bug, this assertion fails
  // closed before any token leaves the process.
  const constructed = new URL(url);
  if (
    constructed.protocol !== "https:" ||
    constructed.hostname.toLowerCase() !== FIGMA_REST_HOST
  ) {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: `internal URL guard refused destination ${constructed.host}`,
      retryable: false,
    });
  }

  const dispatchInput =
    nodeId === undefined
      ? {
          url,
          accessToken: input.accessToken,
          fileKey,
          timeoutMs,
          maxResponseBytes,
          fetchImpl,
          ...(input.onRateLimited !== undefined
            ? { onRateLimited: input.onRateLimited }
            : {}),
          ...(input.onFigmaRestRequest !== undefined
            ? { onFigmaRestRequest: input.onFigmaRestRequest }
            : {}),
          ...(input.sleepMs !== undefined ? { sleepMs: input.sleepMs } : {}),
        }
      : {
          url,
          accessToken: input.accessToken,
          fileKey,
          nodeId,
          timeoutMs,
          maxResponseBytes,
          fetchImpl,
          ...(input.onRateLimited !== undefined
            ? { onRateLimited: input.onRateLimited }
            : {}),
          ...(input.onFigmaRestRequest !== undefined
            ? { onFigmaRestRequest: input.onFigmaRestRequest }
            : {}),
          ...(input.sleepMs !== undefined ? { sleepMs: input.sleepMs } : {}),
        };
  let lastError: FigmaRestFetchError | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let result: FigmaRestFileSnapshot | FigmaRestFetchError;
    try {
      result = await dispatchOnce(dispatchInput);
    } catch (err) {
      result = new FigmaRestFetchError({
        errorClass: "transport",
        message: redactBoundedMessage(
          sanitizeErrorMessage({ error: err, fallback: "transport failure" }),
        ),
        retryable: true,
        cause: err,
      });
    }
    if (!(result instanceof FigmaRestFetchError)) {
      return result;
    }
    recordRateLimitMetadataFromError(result, input.onRateLimited);
    lastError = result;
    if (!result.retryable || attempt === 2) {
      throw result;
    }
    if (!(await waitBeforeRetryingFigmaRequest(result, input.sleepMs))) {
      throw result;
    }
  }
  throw (
    lastError ??
    new FigmaRestFetchError({
      errorClass: "transport",
      message: "no attempts executed",
      retryable: false,
    })
  );
};

/**
 * Parse the PNG IHDR chunk and return decoded pixel dimensions. Returns
 * `undefined` when the buffer does not look like a PNG — callers fall back
 * to the byte-based estimator path (Issue #1930).
 */
const parsePngPixelDimensions = (
  buffer: Uint8Array,
): { widthPx: number; heightPx: number } | undefined => {
  const PNG_SIGNATURE_LENGTH = 8;
  const IHDR_CHUNK_TYPE_OFFSET = 12;
  const IHDR_WIDTH_OFFSET = 16;
  const IHDR_HEIGHT_OFFSET = 20;
  const MINIMUM_IHDR_END = 24;
  if (buffer.length < MINIMUM_IHDR_END) return undefined;
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a
  ) {
    return undefined;
  }
  void PNG_SIGNATURE_LENGTH;
  if (
    buffer[IHDR_CHUNK_TYPE_OFFSET] !== 0x49 ||
    buffer[IHDR_CHUNK_TYPE_OFFSET + 1] !== 0x48 ||
    buffer[IHDR_CHUNK_TYPE_OFFSET + 2] !== 0x44 ||
    buffer[IHDR_CHUNK_TYPE_OFFSET + 3] !== 0x52
  ) {
    return undefined;
  }
  const view = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const widthPx = view.readUInt32BE(IHDR_WIDTH_OFFSET);
  const heightPx = view.readUInt32BE(IHDR_HEIGHT_OFFSET);
  if (
    !Number.isInteger(widthPx) ||
    widthPx <= 0 ||
    !Number.isInteger(heightPx) ||
    heightPx <= 0
  ) {
    return undefined;
  }
  return { widthPx, heightPx };
};

export const fetchFigmaScreenCapturesForTestIntelligence = async (
  input: FetchFigmaScreenCapturesForTestIntelligenceInput,
): Promise<
  Array<{
    screenId: string;
    screenName?: string;
    mimeType: "image/png";
    base64Data: string;
    widthPx?: number;
    heightPx?: number;
  }>
> => {
  const fileKey = input.fileKey.trim();
  if (fileKey.length === 0) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "fileKey is required",
      retryable: false,
    });
  }
  if (typeof input.accessToken !== "string" || input.accessToken.length === 0) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "accessToken is required",
      retryable: false,
    });
  }
  const fetchImpl = resolveFigmaFetch(input.fetchImpl, input.caCertPath);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const scale = clampImageScale(input.scale ?? DEFAULT_FIGMA_IMAGE_SCALE);
  const screens = input.screens.map((screen) => {
    const screenId = screen.screenId.trim();
    if (screenId.length === 0) {
      throw new FigmaRestFetchError({
        errorClass: "request_invalid",
        message: "screenId is required",
        retryable: false,
      });
    }
    return {
      screenId,
      ...(screen.screenName !== undefined
        ? { screenName: screen.screenName }
        : {}),
    };
  });
  const imageUrls = await fetchFigmaRenderableImageUrls({
    fileKey,
    screenIds: screens.map((screen) => screen.screenId),
    accessToken: input.accessToken,
    fetchImpl,
    timeoutMs,
    maxResponseBytes,
    scale,
    ...(input.onFigmaRestRequest !== undefined
      ? { onFigmaRestRequest: input.onFigmaRestRequest }
      : {}),
  });
  return Promise.all(
    screens.map(async (screen) => {
      const imageUrl = imageUrls.get(screen.screenId);
      if (imageUrl === undefined) {
        throw new FigmaRestFetchError({
          errorClass: "not_found",
          message: `Figma image export returned no renderable screenshot for screen '${screen.screenId}'`,
          retryable: false,
        });
      }
      const pngBytes = await fetchFigmaScreenshotBytes({
        imageUrl,
        fetchImpl,
        timeoutMs,
        maxResponseBytes,
      });
      const dimensions = parsePngPixelDimensions(pngBytes);
      return {
        screenId: screen.screenId,
        ...(screen.screenName !== undefined
          ? { screenName: screen.screenName }
          : {}),
        mimeType: "image/png" as const,
        base64Data: Buffer.from(pngBytes).toString("base64"),
        ...(dimensions !== undefined
          ? { widthPx: dimensions.widthPx, heightPx: dimensions.heightPx }
          : {}),
      };
    }),
  );
};

export const fetchFigmaNodesForTestIntelligence = async (
  input: FetchFigmaNodesForTestIntelligenceInput,
): Promise<FigmaRestNodeBatchSnapshot> => {
  const fileKey = normalizeRequiredFigmaInput("fileKey", input.fileKey);
  const accessToken = normalizeRequiredFigmaInput(
    "accessToken",
    input.accessToken,
  );
  const nodeIds = normalizeNodeIds(input.nodeIds);
  const nodes = new Map<string, FigmaRestNode>();
  if (nodeIds.length === 0) {
    return { name: fileKey, fileKey, nodes };
  }
  const fetchImpl = resolveFigmaFetch(input.fetchImpl, input.caCertPath);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const url = buildFigmaNodesLookupUrl({ fileKey, nodeIds });
  assertFigmaApiUrlIsSafe(url);
  const response = await dispatchHttpRequest({
    url,
    accessToken,
    fetchImpl,
    timeoutMs,
    ...(input.onRateLimited !== undefined
      ? { onRateLimited: input.onRateLimited }
      : {}),
    ...(input.onFigmaRestRequest !== undefined
      ? { onFigmaRestRequest: input.onFigmaRestRequest }
      : {}),
    ...(input.sleepMs !== undefined ? { sleepMs: input.sleepMs } : {}),
  });
  const payload = await readBoundedJsonObject({
    response,
    maxResponseBytes,
    parseErrorMessage: "Figma REST node batch response body is not valid JSON",
    shapeErrorMessage: "Figma REST node batch response is not a JSON object",
  });
  const rawNodes = payload.nodes;
  if (typeof rawNodes !== "object" || rawNodes === null) {
    throw new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma REST node batch response is missing 'nodes'",
      retryable: false,
    });
  }
  for (const nodeId of nodeIds) {
    const entry = (rawNodes as Record<string, unknown>)[nodeId];
    if (typeof entry !== "object" || entry === null) {
      throw new FigmaRestFetchError({
        errorClass: "not_found",
        message: `Figma REST returned no node entry for '${redactIdentifierForDiagnostics(nodeId)}'`,
        retryable: false,
      });
    }
    const document = (entry as Record<string, unknown>).document;
    if (typeof document !== "object" || document === null) {
      throw new FigmaRestFetchError({
        errorClass: "parse_error",
        message: `Figma REST node entry '${redactIdentifierForDiagnostics(nodeId)}' has no 'document'`,
        retryable: false,
      });
    }
    nodes.set(nodeId, document as FigmaRestNode);
  }
  const name = typeof payload.name === "string" ? payload.name : fileKey;
  const lastModified =
    typeof payload.lastModified === "string" ? payload.lastModified : undefined;
  const version =
    typeof payload.version === "string" ? payload.version : undefined;
  return {
    name,
    ...(lastModified !== undefined ? { lastModified } : {}),
    ...(version !== undefined ? { version } : {}),
    fileKey,
    nodes,
  };
};

export const fetchFigmaImageMetadataForTestIntelligence = async (
  input: FetchFigmaImageMetadataForTestIntelligenceInput,
): Promise<FigmaRestImageMetadataBatch> => {
  const fileKey = normalizeRequiredFigmaInput("fileKey", input.fileKey);
  const accessToken = normalizeRequiredFigmaInput(
    "accessToken",
    input.accessToken,
  );
  const nodeIds = normalizeNodeIds(input.nodeIds);
  if (nodeIds.length === 0) return { fileKey, images: [] };
  const fetchImpl = resolveFigmaFetch(input.fetchImpl, input.caCertPath);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const scale = clampImageScale(input.scale ?? DEFAULT_FIGMA_IMAGE_SCALE);
  const url = buildFigmaImageLookupUrl({ fileKey, screenIds: nodeIds, scale });
  assertFigmaApiUrlIsSafe(url);
  const response = await dispatchHttpRequest({
    url,
    accessToken,
    fetchImpl,
    timeoutMs,
    ...(input.onRateLimited !== undefined
      ? { onRateLimited: input.onRateLimited }
      : {}),
    ...(input.onFigmaRestRequest !== undefined
      ? { onFigmaRestRequest: input.onFigmaRestRequest }
      : {}),
    ...(input.sleepMs !== undefined ? { sleepMs: input.sleepMs } : {}),
  });
  const payload = await readBoundedJsonObject({
    response,
    maxResponseBytes,
    parseErrorMessage: "Figma image metadata response body is not valid JSON",
    shapeErrorMessage: "Figma image metadata response is not a JSON object",
  });
  if (typeof payload.images !== "object" || payload.images === null) {
    throw new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma image metadata response is missing an images map",
      retryable: false,
    });
  }
  const rawImages = payload.images as Record<string, unknown>;
  const images = nodeIds.map((nodeId): FigmaRestImageMetadataRecord => {
    const imageUrl = rawImages[nodeId];
    if (imageUrl === undefined) {
      return { nodeId, renderable: false, reason: "missing" };
    }
    if (imageUrl === null) {
      return { nodeId, renderable: false, reason: "null" };
    }
    if (typeof imageUrl !== "string" || imageUrl.trim().length === 0) {
      throw new FigmaRestFetchError({
        errorClass: "parse_error",
        message: `Figma image metadata for '${redactIdentifierForDiagnostics(nodeId)}' is not a URL string`,
        retryable: false,
      });
    }
    assertFigmaCdnUrlIsSafe(imageUrl);
    return {
      nodeId,
      renderable: true,
      imageUrlDigest: sha256Hex({ kind: "figma_image_url", imageUrl }),
    };
  });
  return { fileKey, images };
};

const buildFigmaRestUrl = (input: {
  fileKey: string;
  nodeId?: string;
  depth?: number;
}): string => {
  const file = encodeURIComponent(input.fileKey);
  const params =
    input.depth === undefined
      ? ""
      : `?${new URLSearchParams({ depth: String(input.depth) }).toString()}`;
  if (input.nodeId === undefined) {
    return `https://${FIGMA_REST_HOST}/v1/files/${file}${params}`;
  }
  const search = new URLSearchParams({ ids: input.nodeId });
  if (input.depth !== undefined) {
    search.set("depth", String(input.depth));
  }
  return `https://${FIGMA_REST_HOST}/v1/files/${file}/nodes?${search.toString()}`;
};

const buildFigmaNodesLookupUrl = (input: {
  fileKey: string;
  nodeIds: readonly string[];
}): string => {
  const params = new URLSearchParams({
    ids: input.nodeIds.join(","),
  });
  return `https://${FIGMA_REST_HOST}/v1/files/${encodeURIComponent(input.fileKey)}/nodes?${params.toString()}`;
};

const assertFigmaApiUrlIsSafe = (url: string): void => {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== FIGMA_REST_HOST
  ) {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: `internal URL guard refused destination ${parsed.host}`,
      retryable: false,
    });
  }
};

const normalizeRequiredFigmaInput = (
  label: "fileKey" | "accessToken",
  value: string,
): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: `${label} is required`,
      retryable: false,
    });
  }
  return normalized;
};

const normalizeNodeIds = (nodeIds: readonly string[]): readonly string[] => {
  const normalized = nodeIds.map((nodeId) => nodeId.trim());
  const unique = [...new Set(normalized)];
  if (unique.some((nodeId) => nodeId.length === 0)) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "nodeIds must not contain empty values",
      retryable: false,
    });
  }
  const invalid = unique.find(
    (nodeId) => !FIGMA_NODE_ID_RE.test(nodeId) || URI_LIKE_RE.test(nodeId),
  );
  if (invalid !== undefined) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: `nodeId is invalid (${redactIdentifierForDiagnostics(invalid)})`,
      retryable: false,
    });
  }
  return unique;
};

const redactIdentifierForDiagnostics = (value: string): string =>
  redactBoundedMessage(value).replace(URI_LIKE_GLOBAL_RE, "[URI_REDACTED]");

const resolveFigmaDepth = (depth: number | undefined): number | undefined => {
  if (depth === undefined) return undefined;
  if (!Number.isInteger(depth) || depth <= 0 || depth > 10) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "depth must be an integer between 1 and 10",
      retryable: false,
    });
  }
  return depth;
};

const buildFigmaImageLookupUrl = (input: {
  fileKey: string;
  screenIds: readonly string[];
  scale: number;
}): string => {
  const params = new URLSearchParams({
    ids: input.screenIds.join(","),
    format: "png",
    scale: String(input.scale),
  });
  return `https://${FIGMA_REST_HOST}/v1/images/${encodeURIComponent(input.fileKey)}?${params.toString()}`;
};

const clampImageScale = (value: number): number =>
  Math.max(0.5, Math.min(3, value));

const resolveFigmaFetch = (
  fetchImpl: typeof fetch | undefined,
  caCertPath: string | undefined,
): typeof fetch => {
  if (fetchImpl !== undefined) return fetchImpl;
  return createTrustedFigmaFetch(caCertPath);
};

const buildFigmaRateLimitMetadata = (
  response: Response,
): FigmaRestRateLimitMetadata => {
  const retryAfterSeconds = parseRetryAfterSeconds(
    response.headers.get("retry-after"),
  );
  const planTier = sanitizeRateLimitHeaderLabel(
    response.headers.get("x-figma-plan-tier"),
  );
  const rateLimitType = sanitizeRateLimitHeaderLabel(
    response.headers.get("x-figma-rate-limit-type"),
  );
  const upgradeLink = nonEmptyHeader(
    response.headers.get("x-figma-upgrade-link"),
  );
  return {
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    ...(planTier !== undefined ? { figmaPlanTier: planTier } : {}),
    ...(rateLimitType !== undefined
      ? { figmaRateLimitType: rateLimitType }
      : {}),
    ...(upgradeLink !== undefined
      ? {
          figmaUpgradeLinkDigest: sha256Hex({
            kind: "figma_upgrade_link",
            figmaUpgradeLink: upgradeLink,
          }),
        }
      : {}),
  };
};

const buildFigmaRateLimitMessage = (
  metadata: FigmaRestRateLimitMetadata,
): string => {
  const details: string[] = [];
  if (metadata.retryAfterSeconds !== undefined) {
    details.push(`retry after ${metadata.retryAfterSeconds}s`);
  }
  if (metadata.figmaRateLimitType !== undefined) {
    details.push(`limit type ${metadata.figmaRateLimitType}`);
  }
  if (metadata.figmaPlanTier !== undefined) {
    details.push(`plan ${metadata.figmaPlanTier}`);
  }
  return details.length === 0
    ? "Figma REST returned 429 (rate limited)"
    : `Figma REST returned 429 (rate limited; ${details.join("; ")})`;
};

const parseRetryAfterSeconds = (value: string | null): number | undefined => {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.ceil(numeric);
  }
  const retryAt = Date.parse(trimmed);
  if (!Number.isNaN(retryAt)) {
    return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  }
  return undefined;
};

const nonEmptyHeader = (value: string | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const sanitizeRateLimitHeaderLabel = (
  value: string | null,
): string | undefined => {
  const sanitized = nonEmptyHeader(value);
  if (sanitized === undefined) return undefined;
  const redacted = redactBoundedMessage(sanitized)
    .replace(/[^\w.[\]-]+/gu, "_")
    .slice(0, 120);
  return redacted.length === 0 ? undefined : redacted;
};

const waitBeforeRetryingFigmaRequest = async (
  error: FigmaRestFetchError,
  sleepImpl: (ms: number) => Promise<void> = sleep,
): Promise<boolean> => {
  if (error.errorClass !== "rate_limited") return true;
  const retryAfterSeconds =
    error.retryAfterSeconds ?? DEFAULT_FIGMA_RETRY_AFTER_SECONDS;
  if (retryAfterSeconds > MAX_FIGMA_RETRY_AFTER_SECONDS) {
    return false;
  }
  if (retryAfterSeconds > 0) {
    await sleepImpl(retryAfterSeconds * 1000);
  }
  return true;
};

const recordRateLimitMetadataFromError = (
  error: FigmaRestFetchError,
  observer: FigmaRestRateLimitObserver | undefined,
): void => {
  if (observer === undefined || error.errorClass !== "rate_limited") return;
  observer({
    ...(error.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: error.retryAfterSeconds }
      : {}),
    ...(error.figmaPlanTier !== undefined
      ? { figmaPlanTier: error.figmaPlanTier }
      : {}),
    ...(error.figmaRateLimitType !== undefined
      ? { figmaRateLimitType: error.figmaRateLimitType }
      : {}),
    ...(error.figmaUpgradeLinkDigest !== undefined
      ? { figmaUpgradeLinkDigest: error.figmaUpgradeLinkDigest }
      : {}),
  });
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const headersToRecord = (
  headers: RequestInit["headers"] | undefined,
): Record<string, string> => {
  if (headers === undefined) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    headers as Record<string, string | readonly string[] | undefined>,
  )) {
    if (value === undefined) continue;
    out[key] = typeof value === "string" ? value : value.join(", ");
  }
  return out;
};

const responseHeadersToRecord = (
  headers: import("node:http").IncomingHttpHeaders,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
};

const resolveRequestUrl = (input: string | URL | Request): URL => {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
};

const readRuntimeCaBundlePath = (
  caCertPath: string | undefined,
): string | undefined => {
  const configured =
    caCertPath?.trim() || process.env.NODE_EXTRA_CA_CERTS?.trim();
  return configured === undefined || configured.length === 0
    ? undefined
    : configured;
};

type RuntimeTlsModule = typeof tls & {
  getCACertificates?: (source?: "default" | "system") => readonly string[];
};

const readRuntimeCaCertificates = (
  source: "default" | "system",
): readonly string[] => {
  // Node 22.14 satisfies our engines range but does not expose this API yet.
  // Keep the namespace lookup lazy so the published CLI can load there.
  const getRuntimeCaCertificates = (tls as RuntimeTlsModule).getCACertificates;
  if (typeof getRuntimeCaCertificates === "function") {
    try {
      return getRuntimeCaCertificates(source);
    } catch {
      return [];
    }
  }
  return source === "default" ? tls.rootCertificates : [];
};

const runtimeProvidesSystemCaCertificates = (): boolean =>
  typeof (tls as RuntimeTlsModule).getCACertificates === "function";

const loadFigmaCaCertificates = async (
  caCertPath: string | undefined,
): Promise<string[]> => {
  const certificates = new Set<string>();
  for (const source of ["default", "system"] as const) {
    for (const certificate of readRuntimeCaCertificates(source)) {
      if (certificate.trim().length > 0) certificates.add(certificate);
    }
  }
  const runtimeCaBundlePath = readRuntimeCaBundlePath(caCertPath);
  if (runtimeCaBundlePath !== undefined) {
    certificates.add(await readFile(runtimeCaBundlePath, "utf8"));
  }
  return [...certificates];
};

const createTrustedFigmaFetch = (
  caCertPath: string | undefined,
): typeof fetch => {
  if (
    readRuntimeCaBundlePath(caCertPath) === undefined &&
    !runtimeProvidesSystemCaCertificates()
  ) {
    return fetch;
  }
  let agentPromise: Promise<HttpsAgent> | undefined;
  const resolveAgent = (): Promise<HttpsAgent> => {
    agentPromise ??= loadFigmaCaCertificates(caCertPath).then(
      (ca) => new HttpsAgent({ ca, keepAlive: true, maxSockets: 32 }),
    );
    return agentPromise;
  };
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = resolveRequestUrl(input);
    const request = input instanceof Request ? input : undefined;
    if (url.protocol !== "https:") {
      throw new TypeError(
        `trusted Figma fetch only supports https URLs: ${url.protocol}`,
      );
    }
    if (
      init?.body !== undefined ||
      (request !== undefined && request.body !== null)
    ) {
      throw new TypeError("custom CA fetch does not support request bodies");
    }
    const agent = await resolveAgent();
    return await new Promise<Response>((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          agent,
          headers: headersToRecord(init?.headers ?? request?.headers),
          method: init?.method ?? request?.method ?? "GET",
          signal: init?.signal ?? request?.signal ?? undefined,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.once("error", reject);
          res.once("end", () => {
            const status = res.statusCode ?? 0;
            if (init?.redirect === "error" && status >= 300 && status <= 399) {
              reject(new TypeError("redirect refused by fetch policy"));
              return;
            }
            const responseInit: ResponseInit =
              res.statusMessage === undefined
                ? {
                    headers: responseHeadersToRecord(res.headers),
                    status,
                  }
                : {
                    headers: responseHeadersToRecord(res.headers),
                    status,
                    statusText: res.statusMessage,
                  };
            resolve(new Response(Buffer.concat(chunks), responseInit));
          });
        },
      );
      req.once("error", reject);
      req.end();
    });
  }) as typeof fetch;
};

const isFigmaRestApiUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === FIGMA_REST_HOST
    );
  } catch {
    return false;
  }
};

const notifyFigmaRestRequest = (
  rawUrl: string,
  observer: FigmaRestRequestObserver | undefined,
): void => {
  if (observer !== undefined && isFigmaRestApiUrl(rawUrl)) {
    observer();
  }
};

const dispatchOnce = async (input: {
  url: string;
  accessToken: string;
  fileKey: string;
  nodeId?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl: typeof fetch;
  onRateLimited?: FigmaRestRateLimitObserver;
  onFigmaRestRequest?: FigmaRestRequestObserver;
  sleepMs?: (ms: number) => Promise<void>;
}): Promise<FigmaRestFileSnapshot | FigmaRestFetchError> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  let response: Response;
  try {
    notifyFigmaRestRequest(input.url, input.onFigmaRestRequest);
    response = await input.fetchImpl(input.url, {
      method: "GET",
      headers: {
        "x-figma-token": input.accessToken,
        accept: "application/json",
      },
      redirect: "error",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && /aborted/iu.test(err.message)) {
      return new FigmaRestFetchError({
        errorClass: "timeout",
        message: `Figma REST request timed out after ${input.timeoutMs}ms`,
        retryable: true,
      });
    }
    return new FigmaRestFetchError({
      errorClass: "transport",
      message: normalizeFigmaTransportErrorMessage(err),
      retryable: true,
      cause: err,
    });
  }
  try {
    const status = response.status;
    if (status === 401 || status === 403) {
      await drainBody(response);
      return new FigmaRestFetchError({
        errorClass: "auth_failed",
        message: `Figma REST returned ${status}: access token rejected`,
        retryable: false,
        status,
      });
    }
    if (status === 404) {
      await drainBody(response);
      return new FigmaRestFetchError({
        errorClass: "not_found",
        message: `Figma REST returned 404 for fileKey '${redactBoundedMessage(input.fileKey)}'`,
        retryable: false,
        status,
      });
    }
    if (status === 429) {
      const rateLimitMetadata = buildFigmaRateLimitMetadata(response);
      await drainBody(response);
      return new FigmaRestFetchError({
        errorClass: "rate_limited",
        message: buildFigmaRateLimitMessage(rateLimitMetadata),
        retryable: true,
        status,
        ...rateLimitMetadata,
      });
    }
    if (status >= 500 && status <= 599) {
      await drainBody(response);
      return new FigmaRestFetchError({
        errorClass: "transport",
        message: `Figma REST returned ${status}`,
        retryable: true,
        status,
      });
    }
    if (status >= 400) {
      const bodyText = await readBoundedText(response, input.maxResponseBytes);
      return new FigmaRestFetchError({
        errorClass: "request_invalid",
        message: `Figma REST returned ${status}: ${redactBoundedMessage(bodyText)}`,
        retryable: false,
        status,
      });
    }
    const bodyText = await readBoundedText(response, input.maxResponseBytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText) as unknown;
    } catch {
      return new FigmaRestFetchError({
        errorClass: "parse_error",
        message: "Figma REST response body is not valid JSON",
        retryable: false,
        status,
      });
    }
    return interpretFigmaResponse(
      input.nodeId === undefined
        ? { payload: parsed, fileKey: input.fileKey }
        : { payload: parsed, fileKey: input.fileKey, nodeId: input.nodeId },
    );
  } finally {
    clearTimeout(timer);
  }
};

const drainBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    /* best-effort */
  }
};

const readBoundedText = async (
  response: Response,
  maxBytes: number,
): Promise<string> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const expectedBytes = Number(contentLength);
    if (Number.isFinite(expectedBytes) && expectedBytes > maxBytes) {
      await drainBody(response);
      throw new FigmaRestFetchError({
        errorClass: "transport",
        message: `Figma REST response exceeds ${maxBytes} bytes`,
        retryable: false,
      });
    }
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new FigmaRestFetchError({
          errorClass: "transport",
          message: `Figma REST response exceeds ${maxBytes} bytes`,
          retryable: false,
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
};

const readBoundedBytes = async (
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const expectedBytes = Number(contentLength);
    if (Number.isFinite(expectedBytes) && expectedBytes > maxBytes) {
      await drainBody(response);
      throw new FigmaRestFetchError({
        errorClass: "transport",
        message: `${label} exceeds ${maxBytes} bytes`,
        retryable: false,
      });
    }
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new FigmaRestFetchError({
          errorClass: "transport",
          message: `${label} exceeds ${maxBytes} bytes`,
          retryable: false,
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const readBoundedJsonObject = async (input: {
  response: Response;
  maxResponseBytes: number;
  parseErrorMessage: string;
  shapeErrorMessage: string;
}): Promise<Record<string, unknown>> => {
  const bodyText = await readBoundedText(
    input.response,
    input.maxResponseBytes,
  );
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText) as unknown;
  } catch {
    throw new FigmaRestFetchError({
      errorClass: "parse_error",
      message: input.parseErrorMessage,
      retryable: false,
    });
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new FigmaRestFetchError({
      errorClass: "parse_error",
      message: input.shapeErrorMessage,
      retryable: false,
    });
  }
  return payload as Record<string, unknown>;
};

const interpretFigmaResponse = (input: {
  payload: unknown;
  fileKey: string;
  nodeId?: string;
}): FigmaRestFileSnapshot | FigmaRestFetchError => {
  if (
    typeof input.payload !== "object" ||
    input.payload === null ||
    Array.isArray(input.payload)
  ) {
    return new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma REST response body is not a JSON object",
      retryable: false,
    });
  }
  const record = input.payload as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : input.fileKey;
  const lastModified =
    typeof record.lastModified === "string" ? record.lastModified : undefined;
  const version =
    typeof record.version === "string" ? record.version : undefined;

  if (input.nodeId !== undefined) {
    const nodes = record.nodes;
    if (typeof nodes !== "object" || nodes === null) {
      return new FigmaRestFetchError({
        errorClass: "parse_error",
        message: "Figma REST node-scoped response is missing 'nodes'",
        retryable: false,
      });
    }
    const entry = (nodes as Record<string, unknown>)[input.nodeId];
    if (typeof entry !== "object" || entry === null) {
      return new FigmaRestFetchError({
        errorClass: "not_found",
        message: `Figma REST returned no node entry for '${redactIdentifierForDiagnostics(input.nodeId)}'`,
        retryable: false,
      });
    }
    const document = (entry as Record<string, unknown>).document;
    if (typeof document !== "object" || document === null) {
      return new FigmaRestFetchError({
        errorClass: "parse_error",
        message: `Figma REST node entry '${redactIdentifierForDiagnostics(input.nodeId)}' has no 'document'`,
        retryable: false,
      });
    }
    return {
      name,
      ...(lastModified !== undefined ? { lastModified } : {}),
      ...(version !== undefined ? { version } : {}),
      fileKey: input.fileKey,
      nodeId: input.nodeId,
      document: document as FigmaRestNode,
    };
  }

  const document = record.document;
  if (typeof document !== "object" || document === null) {
    return new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma REST file response is missing 'document'",
      retryable: false,
    });
  }
  return {
    name,
    ...(lastModified !== undefined ? { lastModified } : {}),
    ...(version !== undefined ? { version } : {}),
    fileKey: input.fileKey,
    document: document as FigmaRestNode,
  };
};

const fetchFigmaRenderableImageUrls = async (input: {
  fileKey: string;
  screenIds: readonly string[];
  accessToken: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
  scale: number;
  onFigmaRestRequest?: FigmaRestRequestObserver;
}): Promise<Map<string, string>> => {
  const url = buildFigmaImageLookupUrl({
    fileKey: input.fileKey,
    screenIds: input.screenIds,
    scale: input.scale,
  });
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== FIGMA_REST_HOST
  ) {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: "internal URL guard refused Figma image lookup destination",
      retryable: false,
    });
  }
  const response = await dispatchHttpRequest({
    url,
    accessToken: input.accessToken,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    ...(input.onFigmaRestRequest !== undefined
      ? { onFigmaRestRequest: input.onFigmaRestRequest }
      : {}),
  });
  const bodyText = await readBoundedText(response, input.maxResponseBytes);
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText) as unknown;
  } catch {
    throw new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma image lookup response body is not valid JSON",
      retryable: false,
    });
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    typeof (payload as Record<string, unknown>).images !== "object" ||
    (payload as Record<string, unknown>).images === null
  ) {
    throw new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma image lookup response is missing an images map",
      retryable: false,
    });
  }
  const images = (payload as Record<string, unknown>).images as Record<
    string,
    unknown
  >;
  const imageUrls = new Map<string, string>();
  for (const screenId of input.screenIds) {
    const imageUrl = images[screenId];
    if (typeof imageUrl !== "string" || imageUrl.trim().length === 0) {
      throw new FigmaRestFetchError({
        errorClass: "not_found",
        message: `Figma image export returned no renderable screenshot for screen '${screenId}'`,
        retryable: false,
      });
    }
    assertFigmaCdnUrlIsSafe(imageUrl);
    imageUrls.set(screenId, imageUrl);
  }
  return imageUrls;
};

const fetchFigmaScreenshotBytes = async (input: {
  imageUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
}): Promise<Uint8Array> => {
  assertFigmaCdnUrlIsSafe(input.imageUrl);
  const response = await dispatchHttpRequest({
    url: input.imageUrl,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });
  const bytes = await readBoundedBytes(
    response,
    input.maxResponseBytes,
    "Figma screenshot response",
  );
  if (!isValidPngBytes(bytes)) {
    throw new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma image export returned an invalid PNG",
      retryable: false,
    });
  }
  return bytes;
};

const dispatchHttpRequest = async (input: {
  url: string;
  accessToken?: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  onRateLimited?: FigmaRestRateLimitObserver;
  onFigmaRestRequest?: FigmaRestRequestObserver;
  sleepMs?: (ms: number) => Promise<void>;
}): Promise<Response> => {
  let lastError: FigmaRestFetchError | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      notifyFigmaRestRequest(input.url, input.onFigmaRestRequest);
      const response = await input.fetchImpl(input.url, {
        method: "GET",
        headers:
          input.accessToken === undefined
            ? { accept: "application/json" }
            : {
                "x-figma-token": input.accessToken,
                accept: "application/json",
              },
        redirect: "error",
        signal: controller.signal,
      });
      const handled = await handleHttpStatus(response, {
        retryableTransportMessage: "Figma REST returned a transient error",
      });
      if (!(handled instanceof FigmaRestFetchError)) {
        return handled;
      }
      recordRateLimitMetadataFromError(handled, input.onRateLimited);
      lastError = handled;
      if (!handled.retryable || attempt === 2) {
        throw handled;
      }
      if (!(await waitBeforeRetryingFigmaRequest(handled, input.sleepMs))) {
        throw handled;
      }
    } catch (err) {
      const normalized =
        err instanceof FigmaRestFetchError
          ? err
          : new FigmaRestFetchError({
              errorClass:
                err instanceof Error && /aborted/iu.test(err.message)
                  ? "timeout"
                  : "transport",
              message:
                err instanceof Error && /aborted/iu.test(err.message)
                  ? `Figma REST request timed out after ${input.timeoutMs}ms`
                  : normalizeFigmaTransportErrorMessage(err),
              retryable: true,
              cause: err,
            });
      lastError = normalized;
      recordRateLimitMetadataFromError(normalized, input.onRateLimited);
      if (!normalized.retryable || attempt === 2) {
        throw normalized;
      }
      if (!(await waitBeforeRetryingFigmaRequest(normalized, input.sleepMs))) {
        throw normalized;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw (
    lastError ??
    new FigmaRestFetchError({
      errorClass: "transport",
      message: "no attempts executed",
      retryable: false,
    })
  );
};

const handleHttpStatus = async (
  response: Response,
  input: { retryableTransportMessage: string },
): Promise<Response | FigmaRestFetchError> => {
  const status = response.status;
  if (status === 401 || status === 403) {
    await drainBody(response);
    return new FigmaRestFetchError({
      errorClass: "auth_failed",
      message: `Figma REST returned ${status}: access token rejected`,
      retryable: false,
      status,
    });
  }
  if (status === 404) {
    await drainBody(response);
    return new FigmaRestFetchError({
      errorClass: "not_found",
      message: "Figma REST returned 404",
      retryable: false,
      status,
    });
  }
  if (status === 429) {
    const rateLimitMetadata = buildFigmaRateLimitMetadata(response);
    await drainBody(response);
    return new FigmaRestFetchError({
      errorClass: "rate_limited",
      message: buildFigmaRateLimitMessage(rateLimitMetadata),
      retryable: true,
      status,
      ...rateLimitMetadata,
    });
  }
  if (status >= 500 && status <= 599) {
    await drainBody(response);
    return new FigmaRestFetchError({
      errorClass: "transport",
      message: input.retryableTransportMessage,
      retryable: true,
      status,
    });
  }
  if (status >= 400) {
    await drainBody(response);
    return new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: `Figma REST returned ${status}`,
      retryable: false,
      status,
    });
  }
  return response;
};

const isAllowedFigmaCdnHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return ALLOWED_FIGMA_CDN_HOSTS.some((entry) => {
    if (entry.startsWith(".")) {
      return host.endsWith(entry);
    }
    return host === entry;
  });
};

const assertFigmaCdnUrlIsSafe = (imageUrl: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: "Figma screenshot URL is not a valid URL",
      retryable: false,
    });
  }
  if (parsed.protocol !== "https:") {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: `Figma screenshot URL must use https:// (got ${parsed.protocol})`,
      retryable: false,
    });
  }
  if (!isAllowedFigmaCdnHost(parsed.hostname)) {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: `Figma screenshot URL host "${parsed.hostname}" is not in the Figma CDN allowlist`,
      retryable: false,
    });
  }
  return parsed;
};

const isValidPngBytes = (bytes: Uint8Array): boolean => {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
};

const MAX_REDACTED_MESSAGE_LENGTH = 240;

const TLS_LOCAL_ISSUER_CODES = new Set([
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
]);

const getErrorCode = (input: unknown): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const code = (input as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

const getErrorCause = (input: unknown): unknown =>
  input instanceof Error ? input.cause : undefined;

const isTlsTrustFailure = (input: unknown): boolean => {
  const code = getErrorCode(input);
  if (code !== undefined && TLS_LOCAL_ISSUER_CODES.has(code)) return true;
  const cause = getErrorCause(input);
  return cause === undefined ? false : isTlsTrustFailure(cause);
};

const normalizeFigmaTransportErrorMessage = (input: unknown): string => {
  if (isTlsTrustFailure(input)) {
    return "Figma REST TLS trust validation failed. Configure NODE_EXTRA_CA_CERTS or the Workbench NODE_EXTRA_CA_CERTS path with an operator-approved CA bundle.";
  }
  return redactBoundedMessage(
    sanitizeErrorMessage({
      error: input,
      fallback: "Figma REST transport failure",
    }),
  );
};

const redactBoundedMessage = (input: string): string => {
  const redacted = redactHighRiskSecrets(input, "[REDACTED]")
    .replace(FIGMA_TOKEN_LIKE_GLOBAL_RE, "[REDACTED]")
    .replace(URI_LIKE_GLOBAL_RE, "[URI_REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  if (redacted.length <= MAX_REDACTED_MESSAGE_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_REDACTED_MESSAGE_LENGTH)}...`;
};
