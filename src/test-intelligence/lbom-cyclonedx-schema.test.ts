import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  Ajv,
  type AnySchema,
  type ErrorObject,
  type Plugin,
  type ValidateFunction,
} from "ajv";
import addFormatsImport from "ajv-formats";

// `ajv-formats` is a CommonJS module (`module.exports = formatsPlugin`).
// Under `node16` module resolution TypeScript surfaces the default import
// as the module namespace, so it is narrowed back to the callable plugin.
const addFormats = addFormatsImport as unknown as Plugin<string[]>;

import { type Wave1ValidationLbomDocument } from "@oscharko-dev/ti-contracts";
import { buildLbomDocument, validateLbomDocument } from "@oscharko-dev/ti-evidence";
import { cloneEuBankingDefaultProfile } from "@oscharko-dev/ti-quality";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "../..");
const schemaRoot = path.resolve(packageRoot, "scripts/schemas/cyclonedx-1.6");

const readJson = async (filePath: string): Promise<unknown> =>
  JSON.parse(await readFile(filePath, "utf8"));

const readSchema = async (filePath: string): Promise<AnySchema> =>
  (await readJson(filePath)) as AnySchema;

const formatErrors = (
  errors: ValidateFunction["errors"] | null | undefined,
): string =>
  (errors ?? [])
    .map((error: ErrorObject) => {
      const location = error.instancePath.length > 0 ? error.instancePath : "$";
      return `${location} ${error.message ?? error.keyword}`;
    })
    .join("; ");

const compileCycloneDxValidator = async (): Promise<ValidateFunction> => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  // The pinned CycloneDX schemas use formats Ajv does not ship by default.
  // The LBOM does not emit these fields, but registering them keeps schema
  // compilation deterministic and warning-free.
  ajv.addFormat("idn-email", true);
  ajv.addFormat("iri-reference", true);

  const spdx = await readSchema(
    path.join(schemaRoot, "spdx.SNAPSHOT.schema.json"),
  );
  const jsf = await readSchema(
    path.join(schemaRoot, "jsf-0.82.SNAPSHOT.schema.json"),
  );
  ajv.addSchema(spdx);
  ajv.addSchema(spdx, "http://cyclonedx.org/schema/spdx.SNAPSHOT.schema.json");
  ajv.addSchema(jsf);
  ajv.addSchema(
    jsf,
    "http://cyclonedx.org/schema/jsf-0.82.SNAPSHOT.schema.json",
  );

  const cyclonedx = await readSchema(
    path.join(schemaRoot, "bom-1.6.SNAPSHOT.schema.json"),
  );
  return ajv.compile(cyclonedx);
};

const buildSchemaFixture = (): Wave1ValidationLbomDocument =>
  buildLbomDocument({
    fixtureId: "validation-onboarding",
    jobId: "job-schema-1378",
    generatedAt: "2026-04-26T12:00:00.000Z",
    modelDeployments: {
      testGeneration: "gpt-oss-120b-mock",
      visualPrimary: "llama-4-maverick-vision",
      visualFallback: "phi-4-multimodal-poc",
    },
    policyProfile: cloneEuBankingDefaultProfile(),
    exportProfile: { id: "opentext-alm-default", version: "1.0.0" },
    hashes: {
      promptHash: "a".repeat(64),
      schemaHash: "b".repeat(64),
      inputHash: "c".repeat(64),
      cacheKeyDigest: "d".repeat(64),
    },
    testGenerationBinding: {
      modelRevision: "gpt-oss-120b-2026-04-25",
      gatewayRelease: "wave1-validation-mock",
    },
    weightsSha256: {
      test_generation: "e".repeat(64),
      visual_primary: "f".repeat(64),
      visual_fallback: "1".repeat(64),
    },
  });

void test("lbom CycloneDX schema: emitted document validates against pinned CycloneDX 1.6 + SPDX + JSF schemas", async () => {
  const validateCycloneDx = await compileCycloneDxValidator();
  const document = buildSchemaFixture();
  const internal = validateLbomDocument(document);

  assert.equal(internal.valid, true, JSON.stringify(internal.issues, null, 2));
  assert.equal(
    validateCycloneDx(document),
    true,
    formatErrors(validateCycloneDx.errors),
  );
});
