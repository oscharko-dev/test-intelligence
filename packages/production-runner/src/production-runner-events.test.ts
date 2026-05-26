/**
 * Tests for the production-runner event taxonomy and per-job event bus
 * (Issue #1738).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { Meter, Span, Tracer } from "@opentelemetry/api";

import {
  composeProductionRunnerEventSinks,
  createProductionRunnerOpenTelemetrySink,
  PRODUCTION_RUNNER_EVENT_PHASES,
  PRODUCTION_RUNNER_OTEL_PHASE_COUNTER_NAME,
  PRODUCTION_RUNNER_OTEL_SPAN_NAME_PREFIX,
  RUNNER_EVENT_BUS_BUFFER_LIMIT,
  createRunnerEventBus,
  serializeRunnerEvent,
  type ProductionRunnerEvent,
  type ProductionRunnerEventPhase,
} from "./production-runner-events.js";

const sampleEvent = (
  overrides: Partial<ProductionRunnerEvent> = {},
): ProductionRunnerEvent => ({
  phase: "intent_derivation_started",
  timestamp: 1000,
  ...overrides,
});

interface RecordedSpan {
  name: string;
  attributes?: Record<string, unknown> | undefined;
  startTime?: number | undefined;
  endTime?: number | undefined;
}

interface RecordedCounter {
  name: string;
  value: number;
  attributes?: Record<string, unknown> | undefined;
}

const unsupported = (member: string): never => {
  throw new Error(`fake OpenTelemetry stub does not implement ${member}`);
};

const createFakeTracer = (): { spans: RecordedSpan[]; tracer: Tracer } => {
  const spans: RecordedSpan[] = [];
  const tracer: Tracer = {
    startSpan(name, options) {
      const span: RecordedSpan = {
        name,
        attributes: options?.attributes as Record<string, unknown> | undefined,
        startTime:
          typeof options?.startTime === "number"
            ? options.startTime
            : undefined,
      };
      spans.push(span);
      const recordingSpan: Span = {
        spanContext: () => unsupported("Span.spanContext"),
        setAttribute: () => recordingSpan,
        setAttributes: () => recordingSpan,
        addEvent: () => recordingSpan,
        addLink: () => recordingSpan,
        addLinks: () => recordingSpan,
        setStatus: () => recordingSpan,
        updateName: () => recordingSpan,
        end(endTime) {
          span.endTime = typeof endTime === "number" ? endTime : undefined;
        },
        isRecording: () => true,
        recordException: () => undefined,
      };
      return recordingSpan;
    },
    startActiveSpan: () => unsupported("Tracer.startActiveSpan"),
  };
  return { spans, tracer };
};

const createFakeMeter = (): {
  counters: RecordedCounter[];
  meter: Meter;
} => {
  const counters: RecordedCounter[] = [];
  const meter: Meter = {
    createCounter(name) {
      return {
        add(value, attributes) {
          counters.push({
            name,
            value,
            attributes: attributes as Record<string, unknown> | undefined,
          });
        },
      };
    },
    createGauge: () => unsupported("Meter.createGauge"),
    createHistogram: () => unsupported("Meter.createHistogram"),
    createUpDownCounter: () => unsupported("Meter.createUpDownCounter"),
    createObservableGauge: () => unsupported("Meter.createObservableGauge"),
    createObservableCounter: () => unsupported("Meter.createObservableCounter"),
    createObservableUpDownCounter: () =>
      unsupported("Meter.createObservableUpDownCounter"),
    addBatchObservableCallback: () => undefined,
    removeBatchObservableCallback: () => undefined,
  };
  return { counters, meter };
};

void test("event phases form a stable, non-empty enumeration", () => {
  assert.ok((PRODUCTION_RUNNER_EVENT_PHASES.length as number) > 0);
  // No duplicates.
  const set = new Set<string>(PRODUCTION_RUNNER_EVENT_PHASES);
  assert.equal(set.size, PRODUCTION_RUNNER_EVENT_PHASES.length);
  // Snapshot the closed set so adding a phase requires a deliberate
  // contract bump (and a test update that documents the addition).
  assert.deepEqual([...PRODUCTION_RUNNER_EVENT_PHASES], [
    "intent_derivation_started",
    "intent_derivation_complete",
    "visual_sidecar_started",
    "visual_sidecar_skipped",
    "visual_sidecar_complete",
    "prompt_compiled",
    "llm_gateway_request",
    "llm_gateway_response",
    "validation_started",
    "validation_complete",
    "policy_decision",
    "export_started",
    "export_complete",
    "evidence_sealed",
    "finops_recorded",
    "cache_break",
    "replay_cache_hit",
    "cancelled",
    "repair_loop_iteration",
  ] satisfies ProductionRunnerEventPhase[]);
});

void test("serializeRunnerEvent omits undefined detail keys and sorts keys", () => {
  const serialized = serializeRunnerEvent(
    sampleEvent({
      details: {
        b: 2,
        a: 1,
        skipped: undefined,
        nested: { y: "Y", x: "X" },
      },
    }),
  );
  assert.equal(
    serialized,
    JSON.stringify({
      phase: "intent_derivation_started",
      timestamp: 1000,
      details: { a: 1, b: 2, nested: { x: "X", y: "Y" } },
    }),
  );
});

void test("serializeRunnerEvent without details produces only phase + timestamp", () => {
  assert.equal(
    serializeRunnerEvent(sampleEvent()),
    JSON.stringify({
      phase: "intent_derivation_started",
      timestamp: 1000,
    }),
  );
});

void test("serializeRunnerEvent is byte-stable across two identical inputs", () => {
  const first = serializeRunnerEvent(
    sampleEvent({ details: { x: 1, y: 2, z: { a: "a", b: "b" } } }),
  );
  const second = serializeRunnerEvent(
    sampleEvent({ details: { z: { b: "b", a: "a" }, y: 2, x: 1 } }),
  );
  assert.equal(first, second);
});

void test("createRunnerEventBus delivers published events to subscribers", () => {
  const bus = createRunnerEventBus();
  const observed: ProductionRunnerEvent[] = [];
  const unsubscribe = bus.subscribe("job-A", (event) => observed.push(event));
  bus.publish("job-A", sampleEvent({ phase: "validation_started" }));
  bus.publish("job-A", sampleEvent({ phase: "validation_complete" }));
  // Different jobId is isolated.
  bus.publish("job-B", sampleEvent({ phase: "export_started" }));
  unsubscribe();
  // After unsubscribe further events do not arrive.
  bus.publish("job-A", sampleEvent({ phase: "evidence_sealed" }));
  assert.deepEqual(
    observed.map((e) => e.phase),
    ["validation_started", "validation_complete"],
  );
});

void test("createRunnerEventBus snapshot returns the buffered backlog for late subscribers", () => {
  const bus = createRunnerEventBus();
  bus.publish("job-late", sampleEvent({ phase: "intent_derivation_started" }));
  bus.publish("job-late", sampleEvent({ phase: "intent_derivation_complete" }));
  const snap = bus.snapshot("job-late");
  assert.equal(snap.length, 2);
  assert.equal(snap[0]?.phase, "intent_derivation_started");
  assert.equal(snap[1]?.phase, "intent_derivation_complete");
});

void test("createRunnerEventBus drops oldest events past the buffer limit", () => {
  const bus = createRunnerEventBus();
  for (let i = 0; i < RUNNER_EVENT_BUS_BUFFER_LIMIT + 5; i += 1) {
    bus.publish(
      "job-overflow",
      sampleEvent({ phase: "prompt_compiled", timestamp: i }),
    );
  }
  const snap = bus.snapshot("job-overflow");
  assert.equal(snap.length, RUNNER_EVENT_BUS_BUFFER_LIMIT);
  // The first 5 events were dropped, so the oldest retained timestamp is 5.
  assert.equal(snap[0]?.timestamp, 5);
  assert.equal(
    snap[snap.length - 1]?.timestamp,
    RUNNER_EVENT_BUS_BUFFER_LIMIT + 4,
  );
});

void test("createRunnerEventBus evict removes buffered + listener state", () => {
  const bus = createRunnerEventBus();
  bus.publish("job-evict", sampleEvent());
  const observed: ProductionRunnerEvent[] = [];
  bus.subscribe("job-evict", (e) => observed.push(e));
  bus.evict("job-evict");
  assert.equal(bus.snapshot("job-evict").length, 0);
  // Re-publish after evict — the (now-stale) listener is gone.
  bus.publish("job-evict", sampleEvent());
  assert.equal(observed.length, 0);
});

void test("createRunnerEventBus isolates listener errors", () => {
  const bus = createRunnerEventBus();
  const observed: ProductionRunnerEvent[] = [];
  bus.subscribe("job-iso", () => {
    throw new Error("listener exploded");
  });
  bus.subscribe("job-iso", (e) => observed.push(e));
  bus.publish("job-iso", sampleEvent());
  assert.equal(observed.length, 1);
});

void test("createProductionRunnerOpenTelemetrySink returns undefined when no sink is supplied", () => {
  assert.equal(createProductionRunnerOpenTelemetrySink({}), undefined);
});

void test("createProductionRunnerOpenTelemetrySink emits stable span and counter attributes", () => {
  const { spans, tracer } = createFakeTracer();
  const { counters, meter } = createFakeMeter();
  const sink = createProductionRunnerOpenTelemetrySink({ tracer, meter });
  assert.ok(sink);
  sink!(
    sampleEvent({
      phase: "prompt_compiled",
      details: { promptHash: "prompt-123", maxOutputTokens: 4000 },
    }),
  );
  sink!(
    sampleEvent({
      phase: "policy_decision",
      timestamp: 1010,
      details: { blocked: true, approved: 0, blockedCount: 1 },
    }),
  );

  assert.equal(spans.length, 2);
  assert.equal(
    spans[0]?.name,
    `${PRODUCTION_RUNNER_OTEL_SPAN_NAME_PREFIX}.prompt_compiled`,
  );
  assert.equal(
    spans[1]?.name,
    `${PRODUCTION_RUNNER_OTEL_SPAN_NAME_PREFIX}.policy_decision`,
  );
  assert.equal(
    spans[0]!.attributes?.["workspace.test_intelligence.prompt_hash"],
    "prompt-123",
  );
  assert.equal(
    spans[1]!.attributes?.["workspace.test_intelligence.prompt_hash"],
    "prompt-123",
  );
  assert.equal(
    spans[1]!.attributes!["workspace.test_intelligence.verdict"],
    "blocked",
  );
  assert.equal(
    spans[1]!.attributes!["workspace.test_intelligence.severity"],
    "warn",
  );
  assert.equal(spans[0]!.startTime, 1000);
  assert.equal(spans[1]!.endTime, 1010);

  assert.equal(counters.length, 2);
  assert.equal(counters[0]?.name, PRODUCTION_RUNNER_OTEL_PHASE_COUNTER_NAME);
  assert.equal(
    counters[1]?.attributes?.["workspace.test_intelligence.phase"],
    "policy_decision",
  );
});

void test("composeProductionRunnerEventSinks fans out to each active sink", () => {
  const observed: string[] = [];
  const sink = composeProductionRunnerEventSinks(
    (event) => observed.push(`a:${event.phase}`),
    undefined,
    (event) => observed.push(`b:${event.phase}`),
  );
  assert.ok(sink);
  sink!(sampleEvent({ phase: "validation_started" }));
  assert.deepEqual(observed, ["a:validation_started", "b:validation_started"]);
});
