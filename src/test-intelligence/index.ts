/**
 * Internal barrel for the `src/test-intelligence/` public API surface.
 *
 * This barrel exposes the runtime validator, JSON Schema builder, Zod schema,
 * and branded-ID generators to internal callers. It depends one-directionally
 * on `src/contracts/`; the contract surface itself never re-exports from this
 * module, which keeps `src/contracts/` a clean leaf node.
 */

export {
  generateAgentRoleProfileId,
  generateEvidenceArtifactId,
  generateJobId,
  generateLessonId,
  generateRoleStepId,
} from "./branded-id-generation.js";

export {
  buildGeneratedTestCaseListJsonSchema,
  GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
  validateGeneratedTestCaseList,
  type GeneratedTestCaseValidationError,
  type GeneratedTestCaseValidationResult,
} from "@oscharko-dev/ti-core-engine";

export {
  buildGeneratedTestCaseListJsonSchemaFromZod,
  generatedTestCaseListZodSchema,
} from "@oscharko-dev/ti-core-engine";
