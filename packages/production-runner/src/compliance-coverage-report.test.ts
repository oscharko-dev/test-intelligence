import assert from "node:assert/strict";
import test from "node:test";

import {
  buildComplianceCoverageReport,
  COMPLIANCE_COVERAGE_REPORT_SCHEMA_VERSION,
} from "./compliance-coverage-report.js";
import {
  COMPLIANCE_ANNOTATION_SCHEMA_VERSION,
  type ComplianceAnnotationArtifact,
} from "./compliance-annotator-agent.js";
import type { ComplianceFrameworkId } from "./compliance-rules.js";

const buildAnnotations = (
  overrides: Partial<ComplianceAnnotationArtifact>,
): ComplianceAnnotationArtifact => {
  const activeFrameworks: readonly ComplianceFrameworkId[] = ["PSD2"];
  return Object.freeze({
    schemaVersion: COMPLIANCE_ANNOTATION_SCHEMA_VERSION,
    jobId: "job-1",
    generatedAt: "2026-01-01T00:00:00Z",
    activeFrameworks,
    entries: [],
    ...overrides,
  });
};

void test("empty annotations produce a 0% report with no covered rules", () => {
  const report = buildComplianceCoverageReport({
    annotations: buildAnnotations({}),
    totalTestCases: 0,
  });
  assert.equal(report.schemaVersion, COMPLIANCE_COVERAGE_REPORT_SCHEMA_VERSION);
  assert.equal(report.overallCoverageRatio, 0);
  assert.equal(report.totalTestCases, 0);
  assert.equal(report.annotatedTestCases, 0);
  const psd2 = report.frameworks[0];
  assert.ok(psd2);
  assert.ok(psd2!.totalRules > 0);
  assert.equal(psd2!.coveredRules, 0);
  assert.equal(psd2!.hasUncoveredErrorRule, true);
  assert.equal(report.hasUncoveredErrorRule, true);
});

void test("a satisfying annotation marks the rule as covered", () => {
  const annotations = buildAnnotations({
    activeFrameworks: ["PSD2"],
    entries: [
      Object.freeze({
        testCaseId: "tc-1",
        appliesTo: Object.freeze(["PSD2-SCA-Art-97"]),
        matches: Object.freeze([
          {
            ruleId: "PSD2-SCA-Art-97",
            framework: "PSD2" as ComplianceFrameworkId,
            satisfiesMandatoryTestClass: true,
          },
        ]),
        subprocessorRefs: Object.freeze([]),
      }),
    ],
  });
  const report = buildComplianceCoverageReport({
    annotations,
    totalTestCases: 1,
  });
  const psd2 = report.frameworks[0]!;
  const sca = psd2.rules.find((r) => r.ruleId === "PSD2-SCA-Art-97");
  assert.ok(sca);
  assert.equal(sca!.covered, true);
  assert.equal(sca!.applicableCases, 1);
  assert.equal(sca!.satisfyingCases, 1);
  assert.equal(report.annotatedTestCases, 1);
});

void test("non-satisfying applicable matches do not flip coverage", () => {
  const annotations = buildAnnotations({
    activeFrameworks: ["PSD2"],
    entries: [
      Object.freeze({
        testCaseId: "tc-1",
        appliesTo: Object.freeze(["PSD2-SCA-Art-97"]),
        matches: Object.freeze([
          {
            ruleId: "PSD2-SCA-Art-97",
            framework: "PSD2" as ComplianceFrameworkId,
            satisfiesMandatoryTestClass: false,
          },
        ]),
        subprocessorRefs: Object.freeze([]),
      }),
    ],
  });
  const report = buildComplianceCoverageReport({
    annotations,
    totalTestCases: 1,
  });
  const sca = report.frameworks[0]!.rules.find(
    (r) => r.ruleId === "PSD2-SCA-Art-97",
  );
  assert.ok(sca);
  assert.equal(sca!.covered, false);
  assert.equal(sca!.applicableCases, 1);
  assert.equal(sca!.satisfyingCases, 0);
  assert.equal(report.frameworks[0]!.hasUncoveredErrorRule, true);
});

void test("frameworks output is sorted by framework id", () => {
  const annotations = buildAnnotations({
    activeFrameworks: ["GDPR", "PSD2"],
  });
  const report = buildComplianceCoverageReport({
    annotations,
    totalTestCases: 0,
  });
  assert.deepEqual(
    report.frameworks.map((f) => f.framework),
    ["GDPR", "PSD2"],
  );
});

void test("report is deeply frozen", () => {
  const report = buildComplianceCoverageReport({
    annotations: buildAnnotations({}),
    totalTestCases: 0,
  });
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.frameworks));
  for (const framework of report.frameworks) {
    assert.ok(Object.isFrozen(framework));
    assert.ok(Object.isFrozen(framework.rules));
  }
});
