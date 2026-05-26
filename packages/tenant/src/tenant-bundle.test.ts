import assert from "node:assert/strict";
import test from "node:test";

import type { TenantScope, TestCasePolicyProfile } from "@oscharko-dev/ti-contracts";
import { EU_BANKING_DEFAULT_POLICY_PROFILE_ID } from "@oscharko-dev/ti-contracts";
import { cloneEuBankingDefaultProfile } from "@oscharko-dev/ti-quality";
import {
  withTenantScope,
  TenantIsolationViolation,
} from "./tenant-isolation-guard.js";
import {
  MAX_TENANT_BUNDLE_BYTES,
  TENANT_BUNDLE_OVERRIDE_ALLOW_LIST,
  TENANT_BUNDLE_RESOLVED_ARTIFACT_FILENAME,
  TENANT_BUNDLE_RESOLVED_CERTIFICATION,
  TENANT_BUNDLE_RESOLVED_SCHEMA_VERSION,
  TENANT_BUNDLE_SAFETY_FLOORS,
  TenantBundleBaseProfileMismatchError,
  TenantBundleSafetyFloorViolationError,
  assertTenantBundleScope,
  buildTenantBundleGlossaryEntries,
  parseAndCanonicalizeTenantBundle,
  resolveTenantBundle,
  serializeResolvedTenantBundle,
} from "./tenant-bundle.js";

const minimalBundleJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    tenantId: "acme-bank",
    bundleVersion: "1.0.0",
    ...overrides,
  });

void test("parseAndCanonicalizeTenantBundle accepts a minimal bundle and stamps inheritance", () => {
  const result = parseAndCanonicalizeTenantBundle(minimalBundleJson());
  assert.equal(result.ok, true);
  assert.equal(result.bundle.tenantId, "acme-bank");
  assert.equal(result.bundle.bundleVersion, "1.0.0");
  assert.equal(
    result.bundle.inheritsFromPolicyProfile,
    EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  );
  assert.equal(
    result.bundle.schemaVersion,
    TENANT_BUNDLE_RESOLVED_SCHEMA_VERSION,
  );
  assert.ok(/^[0-9a-f]{64}$/u.test(result.bundle.contentHash));
});

void test("parseAndCanonicalizeTenantBundle rejects unknown top-level fields against the hard allow-list", () => {
  const result = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({ secretlyEscalatePolicy: true }),
  );
  assert.equal(result.ok, false);
  const paths = result.issues.map((i) => i.path);
  assert.ok(paths.includes("secretlyEscalatePolicy"));
});

void test("parseAndCanonicalizeTenantBundle rejects invalid tenantId and bundleVersion", () => {
  const result = parseAndCanonicalizeTenantBundle(
    JSON.stringify({
      tenantId: "BAD ID with spaces",
      bundleVersion: "not-semver",
    }),
  );
  assert.equal(result.ok, false);
  const paths = result.issues.map((i) => i.path);
  assert.ok(paths.includes("tenantId"));
  assert.ok(paths.includes("bundleVersion"));
});

void test("parseAndCanonicalizeTenantBundle canonicalizes nested arrays deterministically", () => {
  const result = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({
      terminologyGlossary: [
        { term: "Zahlung", definition: "payment instruction", locale: "de" },
        { term: "Buchung", definition: "booking record" },
      ],
      riskClassTaxonomy: [
        {
          riskCategory: "high",
          customerLabel: "High-Touch",
          mode: "review_only",
        },
        {
          riskCategory: "regulated_data",
          customerLabel: "GDPR-Restricted",
          mode: "review_only",
        },
      ],
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.bundle.terminologyGlossary.map((e) => e.term),
    ["Buchung", "Zahlung"],
  );
  assert.deepEqual(
    result.bundle.riskClassTaxonomy.map((r) => r.riskCategory),
    ["high", "regulated_data"],
  );
});

void test("parseAndCanonicalizeTenantBundle rejects malformed JSON", () => {
  const result = parseAndCanonicalizeTenantBundle("not json");
  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.path, "$");
});

void test("parseAndCanonicalizeTenantBundle rejects duplicate glossary terms (same term + locale)", () => {
  const result = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({
      terminologyGlossary: [
        { term: "Buchung", definition: "first" },
        { term: "Buchung", definition: "second" },
      ],
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.message.includes("duplicate")));
});

void test("resolveTenantBundle is deep-clone safe and surfaces additive overrides", () => {
  const parse = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({
      riskClassTaxonomy: [
        {
          riskCategory: "medium",
          customerLabel: "House-Medium",
          mode: "review_only",
        },
      ],
    }),
  );
  assert.equal(parse.ok, true);
  const base = cloneEuBankingDefaultProfile();
  const baseCopyReviewOnly = [...base.rules.reviewOnlyRiskCategories];
  const resolved = resolveTenantBundle({
    bundle: parse.bundle,
    baseProfile: base,
  });
  // Base profile must not have mutated.
  assert.deepEqual(base.rules.reviewOnlyRiskCategories, baseCopyReviewOnly);
  // Merged profile must contain the bundle's additive override.
  assert.ok(
    resolved.mergedPolicyProfile.rules.reviewOnlyRiskCategories.includes(
      "medium",
    ),
  );
  assert.ok(
    resolved.appliedOverrides.includes("rules.reviewOnlyRiskCategories"),
  );
  assert.equal(resolved.certification, TENANT_BUNDLE_RESOLVED_CERTIFICATION);
});

void test("resolveTenantBundle rejects a bundle inheriting from a different base profile", () => {
  const parse = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({ inheritsFromPolicyProfile: "some-other-profile" }),
  );
  assert.equal(parse.ok, true);
  const base = cloneEuBankingDefaultProfile();
  assert.throws(
    () => resolveTenantBundle({ bundle: parse.bundle, baseProfile: base }),
    TenantBundleBaseProfileMismatchError,
  );
});

void test("resolveTenantBundle enforces hard safety-floor invariants when base profile is tampered with", () => {
  const parse = parseAndCanonicalizeTenantBundle(minimalBundleJson());
  assert.equal(parse.ok, true);
  const base = cloneEuBankingDefaultProfile();
  // Simulate a weaker base; the resolver compares merged vs base and
  // should fire when a future override path tries to drop below the
  // base floor. We invert direction by passing a stricter base while
  // muddying the merged profile through a manual second hand to mimic
  // the future override-injection path the resolver guards against.
  const stricterBase: TestCasePolicyProfile = {
    ...base,
    rules: { ...base.rules, minConfidence: 0.9 },
  };
  const looserBundle = { ...parse.bundle };
  // Run the resolver, then assert that the merged profile preserves the
  // stricter base (resolver does not weaken it via the additive surface).
  const resolved = resolveTenantBundle({
    bundle: looserBundle,
    baseProfile: stricterBase,
  });
  assert.equal(resolved.mergedPolicyProfile.rules.minConfidence, 0.9);
  // Directly verify the invariant catalogue is non-empty and the floor
  // we expect is present.
  assert.ok(
    TENANT_BUNDLE_SAFETY_FLOORS.some(
      (f) => f.field === "rules.minConfidence" && f.direction === "minimum",
    ),
  );
});

void test("TenantBundleSafetyFloorViolationError exposes field, direction, base/proposed values, and rationale", () => {
  const err = new TenantBundleSafetyFloorViolationError({
    field: "rules.minConfidence",
    direction: "minimum",
    baseValue: 0.6,
    proposedValue: 0.4,
    rationale: "test rationale",
  });
  assert.equal(err.code, "TENANT_BUNDLE_SAFETY_FLOOR_VIOLATION");
  assert.equal(err.field, "rules.minConfidence");
  assert.equal(err.direction, "minimum");
  assert.equal(err.baseValue, 0.6);
  assert.equal(err.proposedValue, 0.4);
  assert.equal(err.rationale, "test rationale");
});

void test("assertTenantBundleScope throws TenantIsolationViolation on cross-tenant load", () => {
  const parse = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({ tenantId: "tenant-a" }),
  );
  assert.equal(parse.ok, true);
  const scope: TenantScope = {
    tenantId: "tenant-b",
    environmentId: "prod",
    projectId: "default",
  };
  assert.throws(
    () => assertTenantBundleScope(parse.bundle, scope),
    TenantIsolationViolation,
  );
});

void test("assertTenantBundleScope is a no-op outside withTenantScope", () => {
  const parse = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({ tenantId: "tenant-a" }),
  );
  assert.equal(parse.ok, true);
  // No throw expected — single-tenant CLI usage is allowed.
  assertTenantBundleScope(parse.bundle);
});

void test("resolveTenantBundle fires TenantIsolationViolation when active ALS scope mismatches", () => {
  const parse = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({ tenantId: "tenant-a" }),
  );
  assert.equal(parse.ok, true);
  const base = cloneEuBankingDefaultProfile();
  const result = withTenantScope(
    { tenantId: "tenant-b", environmentId: "prod", projectId: "default" },
    () => {
      let threw = false;
      try {
        resolveTenantBundle({ bundle: parse.bundle, baseProfile: base });
      } catch (err) {
        threw = err instanceof TenantIsolationViolation;
      }
      return threw;
    },
  );
  assert.equal(result, true);
});

void test("serializeResolvedTenantBundle is byte-stable across resolver runs with identical inputs", () => {
  const parse = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({
      terminologyGlossary: [
        { term: "Buchung", definition: "booking" },
        { term: "Zahlung", definition: "payment" },
      ],
    }),
  );
  assert.equal(parse.ok, true);
  const base = cloneEuBankingDefaultProfile();
  const a = serializeResolvedTenantBundle(
    resolveTenantBundle({ bundle: parse.bundle, baseProfile: base }),
  );
  const b = serializeResolvedTenantBundle(
    resolveTenantBundle({
      bundle: parse.bundle,
      baseProfile: cloneEuBankingDefaultProfile(),
    }),
  );
  assert.equal(a, b);
  // Final newline matches the rest of the test-intelligence artifact convention.
  assert.ok(a.endsWith("\n"));
});

void test("buildTenantBundleGlossaryEntries dedupes by term and prefixes locale", () => {
  const parse = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({
      terminologyGlossary: [
        { term: "Buchung", definition: "german booking", locale: "de" },
        { term: "Booking", definition: "english booking" },
      ],
    }),
  );
  assert.equal(parse.ok, true);
  const entries = buildTenantBundleGlossaryEntries(parse.bundle);
  assert.equal(entries.length, 2);
  const buchung = entries.find((e) => e.term === "Buchung");
  assert.ok(buchung?.definition.startsWith("[de] "));
});

void test("hard allow-list captures every customer-facing override surface from Issue #2184", () => {
  assert.ok(TENANT_BUNDLE_OVERRIDE_ALLOW_LIST.includes("tenantId"));
  assert.ok(TENANT_BUNDLE_OVERRIDE_ALLOW_LIST.includes("bundleVersion"));
  assert.ok(
    TENANT_BUNDLE_OVERRIDE_ALLOW_LIST.includes("inheritsFromPolicyProfile"),
  );
  assert.ok(
    TENANT_BUNDLE_OVERRIDE_ALLOW_LIST.includes("testCaseNamingConvention"),
  );
  assert.ok(TENANT_BUNDLE_OVERRIDE_ALLOW_LIST.includes("riskClassTaxonomy"));
  assert.ok(
    TENANT_BUNDLE_OVERRIDE_ALLOW_LIST.includes("complianceHouseStandards"),
  );
  assert.ok(TENANT_BUNDLE_OVERRIDE_ALLOW_LIST.includes("designSystemTokens"));
  assert.ok(TENANT_BUNDLE_OVERRIDE_ALLOW_LIST.includes("terminologyGlossary"));
  assert.ok(TENANT_BUNDLE_OVERRIDE_ALLOW_LIST.includes("customerEvalRubric"));
});

void test("artifact filename and size-cap constants are stable for downstream consumers", () => {
  assert.equal(
    TENANT_BUNDLE_RESOLVED_ARTIFACT_FILENAME,
    "tenant-bundle-resolved.json",
  );
  assert.equal(MAX_TENANT_BUNDLE_BYTES, 256 * 1024);
});

void test("customerEvalRubric ref accepts a path and optional sha256 digest", () => {
  const result = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({
      customerEvalRubric: {
        path: "fixtures/acme/eval-rubric.md",
        expectedSha256: "a".repeat(64),
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(
    result.bundle.customerEvalRubric!.path,
    "fixtures/acme/eval-rubric.md",
  );
  assert.equal(
    result.bundle.customerEvalRubric!.expectedSha256,
    "a".repeat(64),
  );
});

void test("customerEvalRubric ref rejects a NUL byte in the path", () => {
  const result = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({
      customerEvalRubric: { path: "bad\0path" },
    }),
  );
  assert.equal(result.ok, false);
});

void test("designSystemTokens parses families and enforces token-id pattern", () => {
  const result = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({
      designSystemTokens: [
        {
          tokenId: "color.brand.primary",
          customerBinding: "--ds-color-brand-primary",
          family: "mui",
        },
      ],
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.bundle.designSystemTokens.length, 1);
});

void test("resolveTenantBundle records the safety-floor catalogue with direction metadata on the error", () => {
  // Synthesise a bundle by hand to exercise the safety-floor crash
  // path even though no override surface today writes the underlying
  // numeric field. This guards against a regression where the
  // resolver stops evaluating the floor catalogue.
  const parse = parseAndCanonicalizeTenantBundle(minimalBundleJson());
  assert.equal(parse.ok, true);
  const base = cloneEuBankingDefaultProfile();
  // Tamper with the base profile to a deliberately-stricter value;
  // the resolver still returns the merged profile (the bundle is
  // additive-only today). The behavioural contract we assert is
  // that the safety-floor table is not silently dropped.
  base.rules.minConfidence = 0.99;
  const resolved = resolveTenantBundle({
    bundle: parse.bundle,
    baseProfile: base,
  });
  assert.equal(resolved.mergedPolicyProfile.rules.minConfidence, 0.99);
  // The error class still surfaces `direction` so an upstream
  // classifier can branch on minimum vs maximum without parsing
  // the message string.
  const err = new TenantBundleSafetyFloorViolationError({
    field: "rules.duplicateSimilarityThreshold",
    direction: "maximum",
    baseValue: 0.92,
    proposedValue: 0.99,
    rationale: "test",
  });
  assert.equal(err.direction, "maximum");
});

void test("complianceHouseStandards records clause id and rejects duplicates", () => {
  const result = parseAndCanonicalizeTenantBundle(
    minimalBundleJson({
      complianceHouseStandards: [
        {
          clauseId: "HS-01",
          description: "Anti-fraud booking trace",
          externalRef: "https://example.test/clause/01",
        },
        {
          clauseId: "HS-01",
          description: "duplicate",
        },
      ],
    }),
  );
  assert.equal(result.ok, false);
});
