/**
 * Path-decoding and path-safety helpers shared by every route parser.
 *
 * `safeDecode` returns the {@link INVALID_PATH_ENCODING} sentinel rather
 * than throwing on malformed percent-encoding — the caller decides how to
 * respond (the route parser turns this into `400 BAD_REQUEST`).
 *
 * `normalizePlatformPath` canonicalises backslash-separated paths to forward
 * slashes and rejects Windows absolute / UNC forms. These checks run before
 * any filesystem access and are exercised by both the unit and fuzz suites.
 */

/** Sentinel returned by {@link safeDecode} when the input is malformed. */
export const INVALID_PATH_ENCODING: unique symbol = Symbol(
  "INVALID_PATH_ENCODING",
);

export type SafeDecodeResult = string | typeof INVALID_PATH_ENCODING;

export const safeDecode = (raw: string): SafeDecodeResult => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return INVALID_PATH_ENCODING;
  }
};

export interface PlatformPathOk {
  readonly ok: true;
  readonly normalized: string;
}

export interface PlatformPathErr {
  readonly ok: false;
  readonly reason: string;
}

export type PlatformPathResult = PlatformPathOk | PlatformPathErr;

const WINDOWS_DRIVE_LETTER_RE = /^[A-Za-z]:[\\/]/u;
const UNC_PREFIX_RE = /^[\\/]{2}/u;

export const normalizePlatformPath = (input: string): PlatformPathResult => {
  if (WINDOWS_DRIVE_LETTER_RE.test(input)) {
    return { ok: false, reason: "Windows drive-letter paths are not allowed." };
  }
  if (UNC_PREFIX_RE.test(input)) {
    return { ok: false, reason: "UNC paths are not allowed." };
  }
  if (input.startsWith("/")) {
    return { ok: false, reason: "Absolute paths are not allowed." };
  }
  if (input.includes("\0")) {
    return { ok: false, reason: "Null bytes in path are not allowed." };
  }
  const normalized = input.replaceAll("\\", "/");
  return { ok: true, normalized };
};

/**
 * Stable-segment matcher used by every job-, source-, and queue-item-id
 * parser.
 */
const STABLE_SEGMENT_RE = /^[A-Za-z0-9_.-]{1,128}$/u;

export const isSafeIdSegment = (segment: string): boolean => {
  if (!STABLE_SEGMENT_RE.test(segment)) {
    return false;
  }
  // `.` and `..` pass the charset check but are path-traversal sentinels;
  // reject them explicitly so route IDs can be safely joined to file paths.
  if (segment === "." || segment === "..") {
    return false;
  }
  return true;
};

/**
 * Trim a single trailing slash from a pathname. Returns the original string
 * when no trailing slash is present. Used by the route parser so
 * `/api/v1/jobs/` and `/api/v1/jobs` route identically.
 */
export const stripTrailingSlash = (pathname: string): string => {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
};
