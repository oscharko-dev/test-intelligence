import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_GENERATE_TEST_CASE_MODES,
  formatZodError,
  GenerateTestCasesRequestSchema,
} from "./schemas.js";

void test("GenerateTestCasesRequestSchema accepts a minimal valid request", () => {
  const result = GenerateTestCasesRequestSchema.safeParse({
    sourceJobId: "ti-0123456789abcdef",
    mode: "deterministic_llm",
  });
  assert.equal(result.success, true);
  assert.equal(result.data.sourceJobId, "ti-0123456789abcdef");
  assert.equal(result.data.mode, "deterministic_llm");
});

void test("GenerateTestCasesRequestSchema accepts every allowed mode", () => {
  for (const mode of ALLOWED_GENERATE_TEST_CASE_MODES) {
    const result = GenerateTestCasesRequestSchema.safeParse({
      sourceJobId: "ti-0123456789abcdef",
      mode,
    });
    assert.equal(result.success, true, `mode '${mode}' was rejected`);
  }
});

void test("GenerateTestCasesRequestSchema rejects an empty sourceJobId", () => {
  const result = GenerateTestCasesRequestSchema.safeParse({
    sourceJobId: "",
    mode: "offline_eval",
  });
  assert.equal(result.success, false);
  const issues = formatZodError(result.error);
  assert.ok(issues.some((issue) => issue.path === "sourceJobId"));
});

void test("GenerateTestCasesRequestSchema rejects a missing sourceJobId", () => {
  const result = GenerateTestCasesRequestSchema.safeParse({
    mode: "offline_eval",
  });
  assert.equal(result.success, false);
  const issues = formatZodError(result.error);
  assert.ok(issues.some((issue) => issue.path === "sourceJobId"));
});

void test("GenerateTestCasesRequestSchema rejects an unknown mode", () => {
  const result = GenerateTestCasesRequestSchema.safeParse({
    sourceJobId: "ti-0123456789abcdef",
    mode: "not_a_real_mode",
  });
  assert.equal(result.success, false);
  const issues = formatZodError(result.error);
  assert.ok(issues.some((issue) => issue.path === "mode"));
});

void test("GenerateTestCasesRequestSchema rejects unknown properties", () => {
  const result = GenerateTestCasesRequestSchema.safeParse({
    sourceJobId: "ti-0123456789abcdef",
    mode: "deterministic_llm",
    extra: "unexpected",
  });
  assert.equal(result.success, false);
});

void test("GenerateTestCasesRequestSchema rejects a non-string sourceJobId", () => {
  const result = GenerateTestCasesRequestSchema.safeParse({
    sourceJobId: 42,
    mode: "deterministic_llm",
  });
  assert.equal(result.success, false);
  const issues = formatZodError(result.error);
  assert.ok(issues.some((issue) => issue.path === "sourceJobId"));
});

void test("formatZodError returns dotted paths and non-empty messages", () => {
  const result = GenerateTestCasesRequestSchema.safeParse({
    sourceJobId: "",
    mode: "bad",
  });
  assert.equal(result.success, false);
  const issues = formatZodError(result.error);
  assert.equal(issues.length >= 1, true);
  for (const issue of issues) {
    assert.equal(typeof issue.path, "string");
    assert.equal(typeof issue.message, "string");
    assert.ok(issue.message.length > 0);
  }
});

void test("formatZodError emits a root-level empty path for a non-object body", () => {
  const result = GenerateTestCasesRequestSchema.safeParse("not-an-object");
  assert.equal(result.success, false);
  const issues = formatZodError(result.error);
  assert.ok(issues.some((issue) => issue.path === ""));
});
