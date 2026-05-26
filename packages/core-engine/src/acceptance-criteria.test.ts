import assert from "node:assert/strict";
import test from "node:test";

import { extractAcceptanceCriteriaFromMarkdown } from "./acceptance-criteria.js";

void test("extractAcceptanceCriteriaFromMarkdown extracts numbered German criteria", () => {
  const requirements = extractAcceptanceCriteriaFromMarkdown({
    sourceId: "custom-context-markdown",
    screenIds: ["screen-1"],
    markdown: [
      "# Jira Story",
      "",
      "## Akzeptanzkriterien",
      "1. Die Maske zeigt den Abschnitt Finanzierungsbedarf.",
      "2. Wenn Netto ausgewählt ist, wird die Umsatzsteuer separat dargestellt.",
      "3. Der Wert darf maximal 45.000 EUR betragen.",
      "",
      "## Notizen",
      "- Nicht mehr Teil der Kriterien.",
    ].join("\n"),
  });

  assert.deepEqual(
    requirements.map((requirement) => requirement.requirementId),
    ["AC-001", "AC-002", "AC-003"],
  );
  assert.deepEqual(
    requirements.map((requirement) => requirement.verificationMode),
    ["visual", "automated", "automated"],
  );
  assert.equal(requirements[0]?.screenId, "screen-1");
  assert.deepEqual(requirements[0]?.sourceRefs, ["custom-context-markdown"]);
});

void test("extractAcceptanceCriteriaFromMarkdown falls back to explicit AC labels", () => {
  const requirements = extractAcceptanceCriteriaFromMarkdown({
    sourceId: "story",
    markdown: [
      "Beschreibung ohne eigene Überschrift.",
      "AC-17: Auswahloptionen sind eindeutig beschriftet.",
      "AC 18: Klärungsbedarf ist dokumentiert.",
    ].join("\n"),
  });

  assert.deepEqual(
    requirements.map((requirement) => requirement.text),
    [
      "Auswahloptionen sind eindeutig beschriftet.",
      "Klärungsbedarf ist dokumentiert.",
    ],
  );
  assert.deepEqual(
    requirements.map((requirement) => requirement.verificationMode),
    ["automated", "manual_review"],
  );
});

void test("extractAcceptanceCriteriaFromMarkdown accepts punctuated AC headings without misattributing multi-screen context", () => {
  const requirements = extractAcceptanceCriteriaFromMarkdown({
    sourceId: "story",
    screenIds: ["screen-1", "screen-2"],
    markdown: [
      "# Jira Story",
      "",
      "## Akzeptanzkriterien:",
      "- Die Auswahloptionen sind sichtbar.",
      "",
      "## Acceptance Criteria (DoD)",
      "- Saving is blocked until mandatory inputs are valid.",
    ].join("\n"),
  });

  assert.deepEqual(
    requirements.map((requirement) => requirement.text),
    [
      "Die Auswahloptionen sind sichtbar.",
      "Saving is blocked until mandatory inputs are valid.",
    ],
  );
  assert.equal(
    requirements.every((requirement) => requirement.screenId === undefined),
    true,
  );
});
