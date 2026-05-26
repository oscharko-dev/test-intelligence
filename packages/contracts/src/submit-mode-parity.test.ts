/**
 * Compile-time ↔ runtime parity for the public contract enums.
 *
 * Each `ALLOWED_*` runtime array must stay in exact lockstep with its
 * derived union type. The `as const satisfies Record<Union, true>`
 * exhaustiveness objects fail at compile time if a union grows or shrinks
 * without the runtime array being updated; the `satisfies readonly Union[]`
 * clauses fail if the array gains a value the type does not accept. The
 * runtime assertions then confirm the array contents at execution time.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_GENERATED_TEST_CASE_CATEGORIES,
  ALLOWED_GENERATED_TEST_CASE_POLARITIES,
  ALLOWED_REGULATORY_RELEVANCE_DOMAINS,
  type GeneratedTestCaseCategory,
  type GeneratedTestCasePolarity,
  type RegulatoryRelevanceDomain,
} from "./index.js";
import {
  ALLOWED_GENERATE_TEST_CASE_MODES,
  GenerateTestCasesRequestSchema,
  type GenerateTestCasesRequest,
} from "./schemas.js";

const POLARITY_EXHAUSTIVE = {
  positive: true,
  negative: true,
  boundary: true,
  validation: true,
  navigation: true,
  accessibility: true,
} as const satisfies Record<GeneratedTestCasePolarity, true>;

const CATEGORY_EXHAUSTIVE = {
  positive_path: true,
  negative_path: true,
  boundary_value: true,
  validation_rule: true,
  navigation_flow: true,
  accessibility: true,
} as const satisfies Record<GeneratedTestCaseCategory, true>;

const REGULATORY_DOMAIN_EXHAUSTIVE = {
  banking: true,
  insurance: true,
  general: true,
} as const satisfies Record<RegulatoryRelevanceDomain, true>;

const GENERATE_MODE_EXHAUSTIVE = {
  deterministic_llm: true,
  offline_eval: true,
} as const satisfies Record<GenerateTestCasesRequest["mode"], true>;

const POLARITIES_TYPED =
  ALLOWED_GENERATED_TEST_CASE_POLARITIES satisfies readonly GeneratedTestCasePolarity[];
const CATEGORIES_TYPED =
  ALLOWED_GENERATED_TEST_CASE_CATEGORIES satisfies readonly GeneratedTestCaseCategory[];
const REGULATORY_DOMAINS_TYPED =
  ALLOWED_REGULATORY_RELEVANCE_DOMAINS satisfies readonly RegulatoryRelevanceDomain[];
const GENERATE_MODES_TYPED =
  ALLOWED_GENERATE_TEST_CASE_MODES satisfies readonly GenerateTestCasesRequest["mode"][];

void test("parity: ALLOWED_GENERATED_TEST_CASE_POLARITIES matches GeneratedTestCasePolarity", () => {
  const runtime = new Set<string>(POLARITIES_TYPED);
  const typeLevel = new Set<string>(Object.keys(POLARITY_EXHAUSTIVE));
  assert.deepEqual([...runtime].sort(), [...typeLevel].sort());
});

void test("parity: ALLOWED_GENERATED_TEST_CASE_CATEGORIES matches GeneratedTestCaseCategory", () => {
  const runtime = new Set<string>(CATEGORIES_TYPED);
  const typeLevel = new Set<string>(Object.keys(CATEGORY_EXHAUSTIVE));
  assert.deepEqual([...runtime].sort(), [...typeLevel].sort());
});

void test("parity: ALLOWED_REGULATORY_RELEVANCE_DOMAINS matches RegulatoryRelevanceDomain", () => {
  const runtime = new Set<string>(REGULATORY_DOMAINS_TYPED);
  const typeLevel = new Set<string>(Object.keys(REGULATORY_DOMAIN_EXHAUSTIVE));
  assert.deepEqual([...runtime].sort(), [...typeLevel].sort());
});

void test("parity: ALLOWED_GENERATE_TEST_CASE_MODES matches the request schema mode enum", () => {
  const runtime = new Set<string>(GENERATE_MODES_TYPED);
  const typeLevel = new Set<string>(Object.keys(GENERATE_MODE_EXHAUSTIVE));
  assert.deepEqual([...runtime].sort(), [...typeLevel].sort());
});

void test("parity: every ALLOWED_GENERATE_TEST_CASE_MODES value is accepted by GenerateTestCasesRequestSchema", () => {
  for (const mode of GENERATE_MODES_TYPED) {
    const result = GenerateTestCasesRequestSchema.safeParse({
      sourceJobId: "ti-0123456789abcdef",
      mode,
    });
    assert.equal(
      result.success,
      true,
      `GenerateTestCasesRequestSchema rejected mode='${mode}'`,
    );
    assert.equal(result.data.mode, mode);
  }
});

void test("parity: GenerateTestCasesRequestSchema rejects an unknown mode value", () => {
  const result = GenerateTestCasesRequestSchema.safeParse({
    sourceJobId: "ti-0123456789abcdef",
    mode: "not_a_real_mode",
  });
  assert.equal(result.success, false);
});
