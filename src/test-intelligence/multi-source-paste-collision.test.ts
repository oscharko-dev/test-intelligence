import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMultiSourceTestIntentEnvelope,
  validateMultiSourceTestIntentEnvelope,
} from "@oscharko-dev/ti-multi-source";
import { ingestJiraPaste } from "@oscharko-dev/ti-multi-source";

const ingest = async (fixture: string) => {
  const body = await readFile(
    new URL(`../../packages/core-engine/src/fixtures/${fixture}`, import.meta.url),
    "utf8",
  );
  const result = ingestJiraPaste({
    request: { jobId: "job-paste-collision", format: "plain_text", body },
    authorHandle: "alice",
    capturedAt: "2026-04-27T10:00:00.000Z",
  });
  assert.equal(result.ok, true);
  return result.result.sourceRef;
};

void test("multi-source-paste-collision: same Jira issue with different pasted bytes raises paste_collision", async () => {
  const a = await ingest("adversarial-paste-collision-a.paste.txt");
  const b = await ingest("adversarial-paste-collision-b.paste.txt");
  assert.notEqual(a.contentHash, b.contentHash);
  assert.equal(a.canonicalIssueKey, b.canonicalIssueKey);

  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      { ...a, sourceId: "jira-paste-a" },
      { ...b, sourceId: "jira-paste-b" },
    ],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const validation = validateMultiSourceTestIntentEnvelope(envelope);
  assert.equal(validation.ok, false);
  assert.equal(
    validation.issues.some(
      (issue) => issue.code === "duplicate_jira_paste_collision",
    ),
    true,
  );
});
