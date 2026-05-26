/**
 * Primitive structural-validation helpers for `generated-test-case-validator`.
 *
 * These leaf helpers carry no knowledge of the `GeneratedTestCase` shape;
 * they validate individual JSON primitives and accumulate errors. The
 * compound, shape-aware validators live in `generated-test-case-validator.ts`.
 * This module depends one-directionally on `src/contracts/` only through the
 * caller; it imports nothing.
 */

/**
 * Validation error with a JSON-pointer-style path to the offending field.
 */
export interface GeneratedTestCaseValidationError {
  path: string;
  message: string;
}

/** Outcome of a `GeneratedTestCaseList` structural validation. */
export interface GeneratedTestCaseValidationResult {
  valid: boolean;
  errors: GeneratedTestCaseValidationError[];
}

/** Type guard: `value` is a plain (non-array) object. */
export const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

/** Records an error unless `value` is a non-empty string. */
export const expectString = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({ path, message: "expected non-empty string" });
  }
};

/** Records an error unless `value` strictly equals the expected literal. */
export const expectConst = <T extends string>(
  value: unknown,
  expected: T,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (value !== expected) {
    errors.push({ path, message: `expected "${expected}"` });
  }
};

/** Records an error unless `value` is one of the allowed enum members. */
export const expectEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.push({
      path,
      message: `expected one of ${allowed.join(", ")}`,
    });
  }
};

/** Records errors unless `value` is an array of strings. */
export const expectStringArray = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (!Array.isArray(value)) {
    errors.push({ path, message: "expected array" });
    return;
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      errors.push({ path: `${path}[${i}]`, message: "expected string" });
    }
  }
};

/** Records an error unless `value` is a sha256 hex digest. */
export const expectHash = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    errors.push({ path, message: "expected sha256 hex digest" });
  }
};

/** Records an error unless `value` is a number in the closed unit interval. */
export const expectUnitIntervalNumber = (
  value: unknown,
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  if (typeof value !== "number" || value < 0 || value > 1) {
    errors.push({ path, message: "expected number in [0, 1]" });
  }
};

/** Records an error for the first key of `value` outside the allowed set. */
export const expectExactKeys = (
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  errors: GeneratedTestCaseValidationError[],
): void => {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push({ path, message: `unexpected property "${key}"` });
      return;
    }
  }
};
