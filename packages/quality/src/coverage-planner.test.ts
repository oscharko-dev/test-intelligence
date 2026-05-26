import assert from "node:assert/strict";
import test from "node:test";

import {
  COVERAGE_PLAN_SCHEMA_VERSION,
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  type TestDesignModel,
} from "@oscharko-dev/ti-contracts";
import { buildCoveragePlan } from "./coverage-planner.js";

const buildModel = (): TestDesignModel => ({
  schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
  jobId: "job-1",
  sourceHash: "hash",
  screens: [
    {
      screenId: "screen-1",
      name: "Loan Request",
      elements: [],
      actions: [],
      validations: [],
      calculations: [],
      visualRefs: ["visual:screen-1"],
      sourceRefs: ["figma"],
    },
  ],
  requirements: [
    {
      requirementId: "AC-001",
      kind: "acceptance_criterion",
      text: "Wenn Netto ausgewählt ist, wird die Umsatzsteuer separat dargestellt.",
      screenId: "screen-1",
      sourceRefs: ["custom-context-markdown"],
      verificationMode: "automated",
    },
    {
      requirementId: "AC-002",
      kind: "acceptance_criterion",
      text: "Die Pflichtangaben sind visuell dargestellt.",
      screenId: "screen-1",
      sourceRefs: ["custom-context-markdown"],
      verificationMode: "visual",
    },
  ],
  businessRules: [],
  calculationConstraints: [],
  assumptions: [],
  openQuestions: [],
  riskSignals: [],
});

void test("buildCoveragePlan promotes acceptance criteria to mandatory coverage requirements", () => {
  const plan = buildCoveragePlan({ model: buildModel() });

  assert.equal(plan.schemaVersion, COVERAGE_PLAN_SCHEMA_VERSION);
  const acceptanceCriteria = plan.minimumCases.filter(
    (requirement) => requirement.reasonCode === "acceptance_criterion",
  );
  const byTargetId = new Map(
    acceptanceCriteria.map((requirement) => [
      requirement.targetIds[0],
      requirement,
    ]),
  );

  assert.equal(acceptanceCriteria.length, 2);
  assert.equal(byTargetId.get("AC-001")?.technique, "decision_table");
  assert.equal(byTargetId.get("AC-002")?.technique, "initial_state");
  assert.deepEqual(byTargetId.get("AC-001")?.sourceRefs, [
    "custom-context-markdown",
  ]);
  assert.deepEqual(byTargetId.get("AC-001")?.visualRefs, ["visual:screen-1"]);
});
