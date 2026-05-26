import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeCustomContextMarkdown } from "@oscharko-dev/ti-multi-source";

void test("custom-context-markdown-canonicalization: equivalent formatting normalizes to stable bytes and hashes", () => {
  const a = canonicalizeCustomContextMarkdown("## Scope\r\n\r\n- PSD2\tready\r\n");
  const b = canonicalizeCustomContextMarkdown("## Scope\n\n\n- PSD2  ready\n\n");
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.value.bodyMarkdown, b.value.bodyMarkdown);
  assert.equal(a.value.bodyPlain, b.value.bodyPlain);
  assert.equal(a.value.markdownContentHash, b.value.markdownContentHash);
  assert.equal(a.value.plainContentHash, b.value.plainContentHash);
});
