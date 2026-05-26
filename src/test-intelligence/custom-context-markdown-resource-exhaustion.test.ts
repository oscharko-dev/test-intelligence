import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CUSTOM_CONTEXT_RAW_MARKDOWN_BYTES,
  canonicalizeCustomContextMarkdown,
} from "@oscharko-dev/ti-multi-source";

void test("custom-context-markdown-resource-exhaustion: oversized and pathological Markdown fails closed", () => {
  const oversized = "a".repeat(MAX_CUSTOM_CONTEXT_RAW_MARKDOWN_BYTES + 1);
  const oversizedResult = canonicalizeCustomContextMarkdown(oversized);
  assert.equal(oversizedResult.ok, false);
  assert.equal(oversizedResult.issues[0]?.code, "markdown_raw_too_large");

  const canonicalTooLarge = canonicalizeCustomContextMarkdown(
    "row\n".repeat(6_000),
  );
  assert.equal(canonicalTooLarge.ok, false);
  assert.equal(
    canonicalTooLarge.issues.some(
      (issue) => issue.code === "markdown_canonical_too_large",
    ),
    true,
  );

  const malformed = canonicalizeCustomContextMarkdown(
    "Key: PAY-1\nMalformed byte \uFFFD",
  );
  assert.equal(malformed.ok, false);
  assert.equal(
    malformed.issues.some(
      (issue) => issue.code === "markdown_malformed_utf8",
    ),
    true,
  );
});
