/**
 * Runtime schema surface for `GeneratedTestCaseList`.
 *
 * This module exposes the JSON Schema builder, the structural validator, and
 * the contract type re-exports. The structural validator implementation and
 * its private `expect*` helpers live in `./generated-test-case-validator.js`
 * to keep both files within the file-length quality bar. This module depends
 * one-directionally on `src/contracts/`.
 */

import type {
  GeneratedTestCase,
  GeneratedTestCaseList,
  GeneratedTestCaseStep,
} from "@oscharko-dev/ti-contracts";
import {
  validateGeneratedTestCaseList,
  type GeneratedTestCaseValidationError,
  type GeneratedTestCaseValidationResult,
} from "./generated-test-case-validator.js";
import {
  buildGeneratedTestCaseListJsonSchemaFromZod,
  GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
} from "./generated-test-case-zod-schema.js";
import { sha256Hex } from "@oscharko-dev/ti-security";

export { GENERATED_TEST_CASE_LIST_SCHEMA_NAME };
export {
  validateGeneratedTestCaseList,
  type GeneratedTestCaseValidationError,
  type GeneratedTestCaseValidationResult,
};

/**
 * Builds the JSON Schema for the structured test-case generator response.
 *
 * The schema is derived from the Zod source of truth so it can be enforced
 * by structured-output gateways and replayed deterministically.
 */
export const buildGeneratedTestCaseListJsonSchema = (): Record<
  string,
  unknown
> => buildGeneratedTestCaseListJsonSchemaFromZod();

/** sha256 of the canonical JSON serialization of the schema. */
export const computeGeneratedTestCaseListSchemaHash = (): string => {
  return sha256Hex(buildGeneratedTestCaseListJsonSchema());
};

/** Re-export for consumers that need the contract types in one place. */
export type { GeneratedTestCase, GeneratedTestCaseList, GeneratedTestCaseStep };
