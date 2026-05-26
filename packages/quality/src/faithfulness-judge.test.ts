import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type FaithfulnessVerdict,
  type LlmGatewayCapabilities,
  type VisualSidecarCaptureInput,
} from "@oscharko-dev/ti-contracts";
import { createMockLlmGatewayClientBundle } from "@oscharko-dev/ti-model-gateway";
import type { LlmGatewayClientBundle } from "@oscharko-dev/ti-model-gateway";
import {
  buildFaithfulnessJudgeResponseSchema,
  createMemoryFaithfulnessJudgeCache,
  type FaithfulnessJudgeReplayCache,
  runFaithfulnessJudge,
} from "./faithfulness-judge.js";

const PNG_BASE64 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082",
  "hex",
).toString("base64");

const VISUAL_CAPS: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: false,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: true,
};

const SAMPLE_CAPTURES: ReadonlyArray<VisualSidecarCaptureInput> = [
  {
    screenId: "1:1",
    screenName: "Loan form",
    mimeType: "image/png",
    base64Data: PNG_BASE64,
  },
];

const SAMPLE_CASE_SET = {
  testCases: [
    {
      id: "tc-1",
      title: "Submit a valid investment amount",
    },
  ],
};

const TWO_CASE_SET = {
  testCases: [
    {
      id: "tc-1",
      title: "Submit a valid investment amount",
    },
    {
      id: "tc-2",
      title: "Reject an invalid investment amount",
    },
  ],
};

void test("Issue #2170 regression: runtime faithfulness schema requires per-step verdicts", () => {
  const schema = buildFaithfulnessJudgeResponseSchema();
  assert.deepEqual((schema as { required?: unknown }).required, [
    "verdict",
    "stepVerdicts",
    "hallucinations",
    "mismatches",
  ]);
});

void test("runFaithfulnessJudge happy path emits an accept verdict on the primary model", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "accept",
          hallucinations: [],
          mismatches: [],
        },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-happy",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.cacheHit, false);
  assert.equal(
    result.verdict.schemaVersion,
    FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  );
  assert.equal(
    result.verdict.contractVersion,
    TEST_INTELLIGENCE_CONTRACT_VERSION,
  );
  assert.equal(
    result.verdict.promptTemplateVersion,
    FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  );
  assert.equal(result.verdict.verdict, "accept");
  assert.equal(result.verdict.score, 1);
  assert.equal(result.verdict.fallbackReason, "none");
  assert.deepEqual(result.verdict.hallucinations, []);
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.attempts.length, 1);
});

void test("runFaithfulnessJudge surfaces a hallucination-driven repair verdict", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              message: "The button described in the step is not visible.",
            },
          ],
          mismatches: [],
        },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-hallucination",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "repair");
  assert.equal(result.verdict.score, 0);
  assert.equal(result.verdict.hallucinations.length, 1);
  assert.match(result.verdict.hallucinations[0]?.message ?? "", /not visible/u);
});

void test("runFaithfulnessJudge falls back when the primary response is invalid", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: { nope: true },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "accept",
          hallucinations: [],
          mismatches: [],
        },
        finishReason: "stop",
        usage: { inputTokens: 7, outputTokens: 4 },
        modelDeployment: "llama-4-maverick-vision",
        modelRevision: "llama-4-maverick-vision@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-fallback",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.equal(result.verdict.score, 1);
  assert.equal(result.verdict.modelDeployment, "llama-4-maverick-vision");
  assert.equal(result.verdict.fallbackReason, "primary_unavailable");
  assert.equal(result.attempts.length, 2);
});

void test("runFaithfulnessJudge reuses the replay cache on the second invocation", async () => {
  const cache = createMemoryFaithfulnessJudgeCache();
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "accept",
          hallucinations: [],
          mismatches: [],
        },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const first = await runFaithfulnessJudge({
    jobId: "faithfulness-cache",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
    cache,
  });
  const second = await runFaithfulnessJudge({
    jobId: "faithfulness-cache",
    generatedAt: "2026-05-05T10:01:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
    cache,
  });

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.verdict.cacheHit, true);
  assert.equal(resultCallCount(bundle.visualPrimary), 1);
  assert.equal(resultCallCount(bundle.visualFallback), 0);
});

void test("runFaithfulnessJudge cache key ignores volatile generated-list audit fields", async () => {
  const cache = createMemoryFaithfulnessJudgeCache();
  const seenPrompts: string[] = [];
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (request, attempt) => {
        seenPrompts.push(request.userPrompt);
        return {
          outcome: "success",
          content: {
            verdict: "accept",
            hallucinations: [],
            mismatches: [],
          },
          finishReason: "stop",
          usage: { inputTokens: 9, outputTokens: 5 },
          modelDeployment: "mistral-document-ai-2512",
          modelRevision: "mistral-document-ai-2512@test",
          gatewayRelease: "mock",
          attempt,
        };
      },
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const first = await runFaithfulnessJudge({
    jobId: "faithfulness-cache-a",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: {
      jobId: "volatile-a",
      testCases: [
        {
          ...SAMPLE_CASE_SET.testCases[0],
          sourceJobId: "volatile-a",
          audit: { jobId: "volatile-a", generatedAt: "2026-05-05T10:00:00Z" },
        },
      ],
    },
    bundle,
    cache,
  });
  const second = await runFaithfulnessJudge({
    jobId: "faithfulness-cache-b",
    generatedAt: "2026-05-05T10:01:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: {
      jobId: "volatile-b",
      testCases: [
        {
          ...SAMPLE_CASE_SET.testCases[0],
          sourceJobId: "volatile-b",
          audit: { jobId: "volatile-b", generatedAt: "2026-05-05T10:01:00Z" },
        },
      ],
    },
    bundle,
    cache,
  });

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(resultCallCount(bundle.visualPrimary), 1);
  assert.equal(seenPrompts.length, 1);
  assert.equal(seenPrompts[0]?.includes("volatile-a"), false);
});

void test("runFaithfulnessJudge surfaces a label-mismatch repair verdict from the primary model", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel: "Sicherheiten verwalten",
              visibleLabel: "Sicherheiten anlegen",
              message:
                "The visible label differs from the generated step label.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-mismatch",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "repair");
  assert.equal(result.verdict.score, 0);
  assert.deepEqual(result.verdict.hallucinations, []);
  assert.equal(result.verdict.mismatches.length, 1);
  assert.equal(
    result.verdict.mismatches[0]!.expectedLabel,
    "Sicherheiten verwalten",
  );
  assert.equal(
    result.verdict.mismatches[0]!.visibleLabel,
    "Sicherheiten anlegen",
  );
  assert.equal(result.attempts.length, 1);
  assert.equal(resultCallCount(bundle.visualFallback), 0);
});

void test("runFaithfulnessJudge downgrades generic hint wording mismatches with strong source-label overlap", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel:
                "Bitte fügen Sie ein Vorhaben über die Bedienelement hinzu.",
              visibleLabel:
                "Bitte fügen Sie ein Vorhaben hinzu, um die untenstehenden Aktionen freizuschalten.",
              message:
                "The visible hint text does not match the expected label.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "mismatch",
              message:
                "The visible hint text does not match the expected label.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-generic-hint-wording",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "evidence_partial");
});

void test("runFaithfulnessJudge downgrades placeholder label mismatches for non-deterministic UI groups", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel: "<TextField>",
              visibleLabel: "Multiple fields",
              message:
                "The step references multiple fields and actions but the screenshot does not show all the expected fields.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "mismatch",
              message:
                "The step references multiple fields and actions but the screenshot does not show all the expected fields.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-placeholder-mismatch",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "evidence_partial");
});

void test("runFaithfulnessJudge downgrades optional placeholder mismatches that are label-only guidance", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              expectedLabel: "(optional)",
              visibleLabel: "none",
              message:
                "The step refers to a field labeled '(optional)', but no such field is visible in the screenshot.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              verdict: "mismatch",
              message:
                "The step refers to a field labeled '(optional)', but no such field is visible in the screenshot.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-optional-mismatch",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "evidence_partial");
});

void test("runFaithfulnessJudge treats visible label with control wrapper text as non-contradictory", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              expectedLabel: "Person",
              visibleLabel: "Dropdown labeled 'Person'",
              message:
                "The step references a field 'Person' which is not visible in the screenshot.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              verdict: "mismatch",
              message:
                "The step references a field 'Person' which is not visible in the screenshot.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-visual-wrapper-mismatch",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "evidence_partial");
});

void test("runFaithfulnessJudge downgrades visible-field reference mismatches with matching labels", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel: "Pruefe das Feld Name gemaess Testdaten.",
              visibleLabel: "Name",
              message:
                "Die Aktion 'Pruefe das Feld Name gemaess Testdaten.' bezieht sich nicht auf das sichtbare Feld 'Name'.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "mismatch",
              message:
                "Die Aktion 'Pruefe das Feld Name gemaess Testdaten.' bezieht sich nicht auf das sichtbare Feld 'Name'.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-visible-field-reference",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "evidence_partial");
});

void test("runFaithfulnessJudge derives score from the share of cases without cross-modal findings", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              message: "The CTA is not visible on the screenshot.",
            },
          ],
          mismatches: [],
        },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-score",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: TWO_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.score, 0.5);
});

void test("Issue #2066: runFaithfulnessJudge propagates evidence_partial step verdicts and lifts the score above the legacy 0.5 cliff", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "accept",
          hallucinations: [],
          mismatches: [],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "match",
              message: "form heading visible in capture",
            },
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              verdict: "evidence_partial",
              message:
                "label visible; full description below the fold (no contradiction)",
            },
            {
              testCaseId: "tc-2",
              stepIndex: 1,
              verdict: "evidence_partial",
              message: "heading consistent; supporting copy not in capture",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-evidence-partial",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: TWO_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.hallucinations, []);
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.length, 3);
  // case `tc-1`: avg(match=1, evidence_partial=0.85) = 0.925
  // case `tc-2`: evidence_partial = 0.85
  // average = (0.925 + 0.85) / 2 = 0.8875
  assert.ok(
    result.verdict.score >= 0.8,
    `score ${result.verdict.score} should clear 0.80 with the v2 rubric`,
  );
});

void test("runFaithfulnessJudge normalizes finding-free reject verdicts when evidence_partial clears the score floor", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "reject",
          hallucinations: [],
          mismatches: [],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "evidence_partial",
              message: "label is consistent; typed value is future state",
            },
            {
              testCaseId: "tc-2",
              stepIndex: 1,
              verdict: "evidence_partial",
              message: "label is consistent; validation result is future state",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-finding-free-reject",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: TWO_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.hallucinations, []);
  assert.deepEqual(result.verdict.mismatches, []);
  assert.ok(result.verdict.score >= 0.8);
});

void test("runFaithfulnessJudge ignores findings for invented test case ids", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "reject",
          hallucinations: [
            {
              testCaseId: "tc-not-in-prompt",
              message: "invented control id should not affect the run",
            },
          ],
          mismatches: [
            {
              testCaseId: "tc-not-in-prompt",
              stepIndex: 1,
              expectedLabel: "Positiv",
              visibleLabel: "Schufa",
              message: "invented id should be ignored",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "evidence_partial",
              message: "known case remains partially evidenced",
            },
            {
              testCaseId: "tc-not-in-prompt",
              stepIndex: 1,
              verdict: "mismatch",
              message: "unknown case verdict must be ignored",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-invented-ids",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.hallucinations, []);
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts!.length, 1);
  assert.equal(result.verdict.stepVerdicts![0]!.testCaseId, "tc-1");
});

void test("runFaithfulnessJudge downgrades non-verifiable dynamic evidence mismatches", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "reject",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel: "Name",
              visibleLabel: "Name",
              message:
                "The step requires a Screen-Reader announcement, which cannot be verified from the screenshot.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "mismatch",
              message:
                "The screen reader announcement cannot be verified from the screenshot.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-dynamic-evidence",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "evidence_partial");
});

void test("runFaithfulnessJudge downgrades baseline-only action and radio-selection mismatches", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "reject",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              expectedLabel: "Führe „Vorhaben hinzufügen“ aus",
              visibleLabel: "Vorhaben hinzufügen",
              message:
                "Der Schritt ist nicht direkt im Screenshot sichtbar oder überprüfbar.",
            },
            {
              testCaseId: "tc-2",
              stepIndex: 1,
              expectedLabel: "Auswahl treffen",
              visibleLabel: "Ja, Nein",
              message:
                "The radio button 'Nein' is not selected on the screenshot.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              verdict: "mismatch",
              message: "Action result is not directly visible in baseline.",
            },
            {
              testCaseId: "tc-2",
              stepIndex: 1,
              verdict: "mismatch",
              message: "Radio target is not selected before the step runs.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-baseline-only",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: TWO_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.deepEqual(
    result.verdict.stepVerdicts?.map((step) => step.verdict),
    ["evidence_partial", "evidence_partial"],
  );
});

void test("runFaithfulnessJudge downgrades already-selected control mismatches", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel: "Netto",
              visibleLabel: "Netto (already selected)",
              message:
                "'Netto' is already selected, contradicting the step to select 'Netto'.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "mismatch",
              message:
                "'Netto' is already selected, contradicting the step to select 'Netto'.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-already-selected",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "evidence_partial");
});

void test("runFaithfulnessJudge downgrades generic baseline radio-selection state mismatches", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel: "Option aktiv",
              visibleLabel: "Netto",
              message:
                "The 'Netto' option is currently selected, not 'Brutto'.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "mismatch",
              message:
                "The 'Netto' option is currently selected, not 'Brutto'.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-generic-baseline-selection",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "evidence_partial");
});

void test("runFaithfulnessJudge keeps substantive selected-option contradictions actionable", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel: "Brutto selected",
              visibleLabel: "Netto",
              message:
                "The 'Netto' option is currently selected, not 'Brutto'.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "mismatch",
              message:
                "The 'Netto' option is currently selected, not 'Brutto'.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-substantive-selected-option",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "repair");
  assert.equal(result.verdict.mismatches.length, 1);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "mismatch");
});

void test("runFaithfulnessJudge downgrades placeholder labels without angle-bracket notation", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel: "Platzhalter-Radio",
              visibleLabel: "Platzhalter",
              message:
                "There is no visible 'Platzhalter-Radio' control in this phase of the flow.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "mismatch",
              message:
                "There is no visible 'Platzhalter-Radio' control in this phase of the flow.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-placeholder-no-brackets",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "evidence_partial");
});

void test("runFaithfulnessJudge downgrades internal token visual tokens in hallucination findings", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              message:
                "'ic_radio_selected_s 🔥' is not visible on the screenshot.",
            },
          ],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel: "ic_radio_selected_s 🔥",
              visibleLabel: "No such element",
              message:
                "'ic_radio_selected_s 🔥' is not visible on the screenshot.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "mismatch",
              message:
                "'ic_radio_selected_s 🔥' is not visible on the screenshot.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-internal-token",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.hallucinations, []);
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "evidence_partial");
});

void test("runFaithfulnessJudge keeps substantive missing option hallucinations actionable", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              message: "'Brutto' option is not visible on the screenshot.",
            },
          ],
          mismatches: [],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "mismatch",
              message: "'Brutto' option is not visible on the screenshot.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-real-missing-option",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "repair");
  assert.equal(result.verdict.hallucinations.length, 1);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "mismatch");
});

void test("runFaithfulnessJudge downgrades table-with-existing-entries expectation mismatches", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel: "Name",
              visibleLabel: "Table with existing entries",
              message:
                "The test step expects to check the 'Name' field, but the screenshot shows a table with existing entries and no visible 'Name' input field.",
            },
          ],
          stepVerdicts: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              verdict: "mismatch",
              message:
                "The test step expects to check the 'Name' field, but the screenshot shows a table with existing entries and no visible 'Name' input field.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-table-entries",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.verdict.stepVerdicts?.[0]?.verdict, "evidence_partial");
});

void test("runFaithfulnessJudge normalizes stale cached finding-free reject verdicts", async () => {
  const cachedVerdict: FaithfulnessVerdict = {
    schemaVersion: FAITHFULNESS_VERDICT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    promptTemplateVersion: FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
    generatedAt: "2026-05-08T09:00:00Z",
    jobId: "old-job",
    cacheHit: false,
    cacheKeyDigest: "c".repeat(64),
    modelDeployment: "mistral-document-ai-2512",
    modelRevision: "mistral-document-ai-2512@test",
    gatewayRelease: "mock",
    fallbackReason: "none",
    score: 0.85,
    verdict: "reject",
    hallucinations: [],
    mismatches: [],
    stepVerdicts: [
      {
        testCaseId: "tc-1",
        stepIndex: 1,
        verdict: "evidence_partial",
        message: "label is consistent; result is future state",
      },
    ],
  };
  const cache: FaithfulnessJudgeReplayCache = {
    async lookup() {
      return {
        hit: true,
        entry: {
          key: "cached",
          storedAt: "2026-05-08T09:00:00Z",
          verdict: cachedVerdict,
        },
      };
    },
    async store() {
      throw new Error("cache store should not be called on hit");
    },
  };
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: () => {
        throw new Error("gateway should not be called on cache hit");
      },
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-stale-cache",
    generatedAt: "2026-05-08T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
    cache,
  });

  assert.equal(result.cacheHit, true);
  assert.equal(result.verdict.verdict, "accept");
  assert.equal(result.verdict.cacheHit, true);
});

void test("runFaithfulnessJudge emits a refusal when both gateways reject the image payload", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: () => ({
        outcome: "error",
        errorClass: "image_payload_rejected",
        message: "primary refused decoded screenshot payload",
        retryable: false,
        attempt: 0,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: () => ({
        outcome: "error",
        errorClass: "image_payload_rejected",
        message: "fallback refused decoded screenshot payload",
        retryable: false,
        attempt: 0,
      }),
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-image-fail",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.verdict.score, 0);
  assert.equal(result.verdict.fallbackReason, "primary_unavailable");
  assert.equal(result.verdict.refusal!.code, "image_payload_rejected");
  assert.match(
    result.verdict.refusal!.message,
    /fallback refused decoded screenshot payload/u,
  );
  assert.equal(result.verdict.modelDeployment, "llama-4-maverick-vision");
  assert.equal(result.verdict.hallucinations.length, 1);
  assert.equal(result.verdict.hallucinations[0]!.testCaseId, "$job");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.attempts.length, 2);
});

void test("runFaithfulnessJudge emits a refusal when both gateways exceed the input-token budget", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: () => ({
        outcome: "error",
        errorClass: "input_budget_exceeded",
        message: "primary input-token budget exceeded",
        retryable: false,
        attempt: 0,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: () => ({
        outcome: "error",
        errorClass: "input_budget_exceeded",
        message: "fallback input-token budget exceeded",
        retryable: false,
        attempt: 0,
      }),
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-token-limit",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
    maxInputTokens: 16,
  });

  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.verdict.score, 0);
  assert.equal(result.verdict.refusal!.code, "input_budget_exceeded");
  assert.match(result.verdict.refusal!.message, /input/iu);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]!.role, "visual_primary");
  assert.equal(result.attempts[1]!.result.outcome, "error");
  assert.equal(result.attempts[1]!.result.errorClass, "input_budget_exceeded");
  assert.equal(result.attempts[1]!.role, "visual_fallback");
});

void test("runFaithfulnessJudge treats transient judge timeouts as unavailable evidence, not test hallucinations", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "error",
        errorClass: "timeout",
        message: "primary timed out",
        retryable: true,
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "error",
        errorClass: "timeout",
        message: "fallback timed out",
        retryable: true,
        attempt,
      }),
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-timeout-soft",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.equal(result.verdict.refusal?.code, "timeout");
  assert.deepEqual(result.verdict.hallucinations, []);
  assert.deepEqual(result.verdict.mismatches, []);
});

void test("runFaithfulnessJudge emits a schema-invalid refusal when both responses fail validation", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: { verdict: "definitely-not-a-label" },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: { hallucinations: "not an array" },
        finishReason: "stop",
        usage: { inputTokens: 7, outputTokens: 4 },
        modelDeployment: "llama-4-maverick-vision",
        modelRevision: "llama-4-maverick-vision@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-schema-refusal",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.verdict.score, 0);
  assert.equal(result.verdict.refusal?.code, "schema_invalid_response");
  assert.equal(result.verdict.modelDeployment, "llama-4-maverick-vision");
  assert.equal(result.verdict.fallbackReason, "primary_unavailable");
  assert.equal(result.verdict.hallucinations.length, 1);
  assert.equal(result.verdict.hallucinations[0]?.testCaseId, "$job");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.attempts.length, 2);
});

void test("runFaithfulnessJudge fails closed on a hanging primary gateway call", async () => {
  const baseBundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "unused-primary",
      modelRevision: "unused-primary@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "accept",
          hallucinations: [],
          mismatches: [],
        },
        finishReason: "stop",
        usage: { inputTokens: 7, outputTokens: 4 },
        modelDeployment: "llama-4-maverick-vision",
        modelRevision: "llama-4-maverick-vision@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
  });
  const bundle: LlmGatewayClientBundle = {
    ...baseBundle,
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      ictRegisterRef: undefined,
      operatorEndpointReference: "https://example.invalid/[redacted]",
      modelWeightsSha256: undefined,
      declaredCapabilities: VISUAL_CAPS,
      compatibilityMode: "openai_chat",
      constrainedDecoding: undefined,
      getCircuitBreaker: () => {
        throw new Error("not used in test");
      },
      getIdempotencyMetrics: () => undefined,
      generate: async () => await new Promise(() => {}),
    },
  };

  const startedAt = Date.now();
  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-timeout",
    generatedAt: "2026-05-12T07:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
    maxWallClockMs: 25,
  });

  assert.ok(
    Date.now() - startedAt < 1_000,
    "judge watchdog should resolve quickly instead of hanging indefinitely",
  );
  assert.equal(result.cacheHit, false);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]!.result.outcome, "error");
  assert.equal(result.attempts[0]!.result.errorClass, "timeout");
  assert.equal(result.verdict.verdict, "accept");
  assert.equal(result.verdict.fallbackReason, "primary_unavailable");
});

const resultCallCount = (client: object): number =>
  (client as { callCount?: () => number }).callCount?.() ?? 0;
