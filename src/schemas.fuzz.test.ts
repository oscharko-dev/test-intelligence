import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  ALLOWED_GENERATE_TEST_CASE_MODES,
  formatZodError,
  GenerateTestCasesRequestSchema,
} from "./schemas.js";

const sourceJobIdArb = fc.string({ minLength: 1, maxLength: 64 });
const modeArb = fc.constantFrom(...ALLOWED_GENERATE_TEST_CASE_MODES);

const validRequestArb = fc.record({
  sourceJobId: sourceJobIdArb,
  mode: modeArb,
});

void test("fuzz: every generated valid request parses successfully", () => {
  fc.assert(
    fc.property(validRequestArb, (request) => {
      const result = GenerateTestCasesRequestSchema.safeParse(request);
      assert.equal(result.success, true);
      assert.equal(result.data.sourceJobId, request.sourceJobId);
      assert.equal(result.data.mode, request.mode);
    }),
  );
});

void test("fuzz: arbitrary structurally-invalid inputs are rejected without throwing", () => {
  fc.assert(
    fc.property(fc.anything(), (input) => {
      const result = GenerateTestCasesRequestSchema.safeParse(input);
      if (!result.success) {
        assert.ok(Array.isArray(formatZodError(result.error)));
        return;
      }
      // When parsing succeeds the input must be a strict object whose only
      // keys are the two known fields, both well-formed.
      assert.equal(typeof result.data.sourceJobId, "string");
      assert.ok(result.data.sourceJobId.length > 0);
      assert.ok(
        (ALLOWED_GENERATE_TEST_CASE_MODES as readonly string[]).includes(
          result.data.mode,
        ),
      );
    }),
  );
});

void test("fuzz: an empty sourceJobId is always rejected regardless of mode", () => {
  fc.assert(
    fc.property(modeArb, (mode) => {
      const result = GenerateTestCasesRequestSchema.safeParse({
        sourceJobId: "",
        mode,
      });
      assert.equal(result.success, false);
    }),
  );
});

void test("fuzz: an unknown mode string is always rejected", () => {
  const knownModes = new Set<string>(ALLOWED_GENERATE_TEST_CASE_MODES);
  fc.assert(
    fc.property(
      sourceJobIdArb,
      fc.string().filter((value) => !knownModes.has(value)),
      (sourceJobId, mode) => {
        const result = GenerateTestCasesRequestSchema.safeParse({
          sourceJobId,
          mode,
        });
        assert.equal(result.success, false);
      },
    ),
  );
});

void test("fuzz: an extra property always triggers strict-object rejection", () => {
  fc.assert(
    fc.property(
      validRequestArb,
      fc.string({ minLength: 1 }).filter((key) => {
        // "__proto__" is excluded: z.strictObject does not flag a computed
        // __proto__ own-key as unknown; that documented edge case is covered
        // by a dedicated deterministic test below.
        return key !== "sourceJobId" && key !== "mode" && key !== "__proto__";
      }),
      fc.anything(),
      (request, extraKey, extraValue) => {
        const result = GenerateTestCasesRequestSchema.safeParse({
          ...request,
          [extraKey]: extraValue,
        });
        assert.equal(result.success, false);
      },
    ),
  );
});

void test("__proto__ computed own-key passes z.strictObject but does not pollute the parsed output", () => {
  // z.strictObject does not recognise a computed ["__proto__"] assignment as
  // an unknown key — it returns success:true. The validated object must still
  // only contain the two declared fields and must not be prototype-polluted.
  const result = GenerateTestCasesRequestSchema.safeParse({
    sourceJobId: "ti-0123456789abcdef",
    mode: "deterministic_llm",
    ["__proto__"]: { polluted: true },
  });

  assert.equal(result.success, true);
  assert.deepEqual(Object.keys(result.data).sort(), ["mode", "sourceJobId"]);
  assert.equal(Object.getPrototypeOf(result.data), Object.prototype);
});
