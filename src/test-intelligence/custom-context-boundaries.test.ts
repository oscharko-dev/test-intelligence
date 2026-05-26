import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CUSTOM_CONTEXT_ATTRIBUTE_COUNT,
  validateCustomContextAttributes,
} from "@oscharko-dev/ti-multi-source";
import { canonicalizeCustomContextMarkdown } from "@oscharko-dev/ti-multi-source";

void test("custom-context-boundaries: markdown raw-byte cap fails closed for oversized payloads", () => {
  const result = canonicalizeCustomContextMarkdown("A".repeat(33 * 1024));
  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((issue) => issue.code === "markdown_raw_too_large"),
    true,
  );
});

void test("custom-context-boundaries: attribute count and duplicate keys reject oversize input", () => {
  const tooMany = validateCustomContextAttributes(
    Array.from(
      { length: MAX_CUSTOM_CONTEXT_ATTRIBUTE_COUNT + 1 },
      (_, index) => ({
        key: `field_${index}`,
        value: "ok",
      }),
    ),
  );
  assert.equal(tooMany.ok, false);
  assert.equal(
    tooMany.issues.some(
      (issue) => issue.code === "custom_context_attribute_count_invalid",
    ),
    true,
  );

  const duplicate = validateCustomContextAttributes([
    {
      key: "test_environment",
      value: "prod",
    },
    {
      key: "test_environment",
      value: "prod",
    },
  ]);
  assert.equal(duplicate.ok, false);
  assert.equal(
    duplicate.issues.some(
      (issue) => issue.code === "custom_context_attribute_duplicate",
    ),
    true,
  );
});
