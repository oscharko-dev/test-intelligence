import assert from "node:assert/strict";
import test from "node:test";
import type {
  LlmConstrainedDecodingConfig,
  LlmGatewayCapabilities,
  LlmGatewayClientConfig,
  LlmGatewayWireStructuredOutputMode,
} from "@oscharko-dev/ti-contracts";
import {
  isKnownConstrainedDecodingAdapterId,
  resolveConfiguredConstrainedDecoding,
  resolveConstrainedDecodingMetadata,
} from "./constrained-decoding.js";
import {
  buildOpenAiChatLlguidanceAdapter,
  buildOpenAiChatOutlinesAdapter,
  getOpenAiChatAdapter,
  OPENAI_CHAT_LLGUIDANCE_ADAPTER_VERSION,
  OPENAI_CHAT_OUTLINES_ADAPTER_VERSION,
} from "./constrained-decoding/openai-chat-adapter.js";

const baseCapabilities: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: true,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
};

const buildConfig = (overrides: {
  wireStructuredOutputMode?: LlmGatewayWireStructuredOutputMode;
  constrainedDecoding?: LlmConstrainedDecodingConfig;
}): LlmGatewayClientConfig => ({
  role: "test_generation",
  compatibilityMode: "openai_chat",
  baseUrl: "https://example.invalid/openai/v1",
  deployment: "gpt-oss-120b",
  modelRevision: "gpt-oss-120b@2026-05-08",
  gatewayRelease: "azure-ai-foundry@2026.05",
  authMode: "api_key",
  declaredCapabilities: baseCapabilities,
  timeoutMs: 5_000,
  maxRetries: 0,
  circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 1_000 },
  ...overrides,
});

void test("openai-chat llguidance adapter binds to provider enforcement on json_schema", () => {
  const adapter = buildOpenAiChatLlguidanceAdapter();
  assert.equal(adapter.id, "llguidance");
  assert.equal(adapter.enforcement, "provider");
  assert.equal(adapter.defaultWireMode, "json_schema");
  assert.equal(adapter.version, OPENAI_CHAT_LLGUIDANCE_ADAPTER_VERSION);
  assert.deepEqual(
    adapter.supports({
      wireMode: "json_schema",
      compatibilityMode: "openai_chat",
    }),
    { ok: true },
  );
});

void test("openai-chat llguidance adapter rejects non-json_schema wire modes with a typed reason", () => {
  const adapter = buildOpenAiChatLlguidanceAdapter();
  const rejected = adapter.supports({
    wireMode: "json_object",
    compatibilityMode: "openai_chat",
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /json_schema/u);
});

void test("openai-chat outlines adapter mirrors the llguidance binding for FinOps attribution", () => {
  const adapter = buildOpenAiChatOutlinesAdapter();
  assert.equal(adapter.id, "outlines");
  assert.equal(adapter.enforcement, "provider");
  assert.equal(adapter.version, OPENAI_CHAT_OUTLINES_ADAPTER_VERSION);
  assert.deepEqual(
    adapter.supports({
      wireMode: "json_schema",
      compatibilityMode: "openai_chat",
    }),
    { ok: true },
  );
});

void test("getOpenAiChatAdapter returns undefined for ids without an openai_chat-bound variant", () => {
  assert.equal(getOpenAiChatAdapter("openai_json_schema"), undefined);
  assert.equal(getOpenAiChatAdapter("openai_json_object"), undefined);
  assert.equal(getOpenAiChatAdapter("prompt_only"), undefined);
});

void test("resolveConstrainedDecodingMetadata activates llguidance with provider enforcement on openai_chat", () => {
  const config = buildConfig({
    constrainedDecoding: {
      preferredAdapter: "llguidance",
      fallbackAdapter: "prompt_only",
    },
  });
  const metadata = resolveConstrainedDecodingMetadata({
    config,
    requestHasSchema: true,
  });
  assert.ok(metadata !== undefined);
  assert.equal(metadata.requested, true);
  assert.equal(metadata.adapterId, "llguidance");
  assert.equal(metadata.enforcement, "provider");
  assert.equal(metadata.wireMode, "json_schema");
  assert.equal(metadata.fallback, false);
  assert.equal(metadata.adapterVersion, OPENAI_CHAT_LLGUIDANCE_ADAPTER_VERSION);
  assert.equal(metadata.fallbackReason, undefined);
});

void test("resolveConstrainedDecodingMetadata activates outlines with provider enforcement on openai_chat", () => {
  const config = buildConfig({
    constrainedDecoding: {
      preferredAdapter: "outlines",
    },
  });
  const metadata = resolveConstrainedDecodingMetadata({
    config,
    requestHasSchema: true,
  });
  assert.ok(metadata !== undefined);
  assert.equal(metadata.adapterId, "outlines");
  assert.equal(metadata.enforcement, "provider");
  assert.equal(metadata.fallback, false);
});

void test("resolveConstrainedDecodingMetadata falls back when wire mode is not json_schema for llguidance", () => {
  const config = buildConfig({
    wireStructuredOutputMode: "json_object",
    constrainedDecoding: {
      preferredAdapter: "llguidance",
      fallbackAdapter: "openai_json_object",
    },
  });
  const metadata = resolveConstrainedDecodingMetadata({
    config,
    requestHasSchema: true,
  });
  assert.ok(metadata !== undefined);
  assert.equal(metadata.fallback, true);
  assert.equal(metadata.adapterId, "openai_json_object");
  assert.equal(metadata.enforcement, "provider");
  assert.equal(metadata.wireMode, "json_object");
  assert.match(metadata.fallbackReason ?? "", /json_schema/u);
});

void test("resolveConstrainedDecodingMetadata returns undefined when no schema is supplied", () => {
  const config = buildConfig({
    constrainedDecoding: { preferredAdapter: "llguidance" },
  });
  const metadata = resolveConstrainedDecodingMetadata({
    config,
    requestHasSchema: false,
  });
  assert.equal(metadata, undefined);
});

void test("resolveConstrainedDecodingMetadata preserves operator-pinned adapter version", () => {
  const config = buildConfig({
    constrainedDecoding: {
      preferredAdapter: "llguidance",
      adapterVersion: "operator-pin-2",
    },
  });
  const metadata = resolveConstrainedDecodingMetadata({
    config,
    requestHasSchema: true,
  });
  assert.ok(metadata !== undefined);
  assert.equal(metadata.adapterVersion, "operator-pin-2");
});

void test("resolveConstrainedDecodingMetadata is deterministic given fixed config", () => {
  const config = buildConfig({
    constrainedDecoding: { preferredAdapter: "llguidance" },
  });
  const a = resolveConstrainedDecodingMetadata({
    config,
    requestHasSchema: true,
  });
  const b = resolveConstrainedDecodingMetadata({
    config,
    requestHasSchema: true,
  });
  assert.deepEqual(a, b);
});

void test("resolveConfiguredConstrainedDecoding preserves wireStructuredOutputMode default", () => {
  const config = buildConfig({});
  const resolved = resolveConfiguredConstrainedDecoding(config);
  assert.equal(resolved.wireMode, "json_schema");
  assert.equal(resolved.preferredAdapterId, "openai_json_schema");
  assert.equal(resolved.fallbackAdapterId, "prompt_only");
});

void test("resolveConstrainedDecodingMetadata default config (no constrainedDecoding) selects openai_json_schema", () => {
  const config = buildConfig({});
  const metadata = resolveConstrainedDecodingMetadata({
    config,
    requestHasSchema: true,
  });
  assert.ok(metadata !== undefined);
  assert.equal(metadata.adapterId, "openai_json_schema");
  assert.equal(metadata.enforcement, "provider");
  assert.equal(metadata.fallback, false);
});

void test("resolveConstrainedDecodingMetadata wire mode 'none' selects prompt_only", () => {
  const config = buildConfig({ wireStructuredOutputMode: "none" });
  const metadata = resolveConstrainedDecodingMetadata({
    config,
    requestHasSchema: true,
  });
  assert.ok(metadata !== undefined);
  assert.equal(metadata.adapterId, "prompt_only");
  assert.equal(metadata.enforcement, "prompt_only");
  assert.equal(metadata.wireMode, "none");
});

void test("isKnownConstrainedDecodingAdapterId guards the union", () => {
  assert.equal(isKnownConstrainedDecodingAdapterId("llguidance"), true);
  assert.equal(isKnownConstrainedDecodingAdapterId("outlines"), true);
  assert.equal(isKnownConstrainedDecodingAdapterId("openai_json_schema"), true);
  assert.equal(isKnownConstrainedDecodingAdapterId("prompt_only"), true);
  assert.equal(isKnownConstrainedDecodingAdapterId("unknown"), false);
  assert.equal(isKnownConstrainedDecodingAdapterId(""), false);
});
