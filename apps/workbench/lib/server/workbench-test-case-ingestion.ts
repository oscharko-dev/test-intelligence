/**
 * Ingestion bridge from the engine's `GeneratedTestCaseList` payload to the
 * persisted canonical test-case editor model (Issue #56).
 *
 * Two responsibilities, split for testability:
 *
 *  - {@link mapGeneratedToPersistedInitialVersion} is a pure projection from a
 *    single `GeneratedTestCase` to the storage-layer `CreatePersistedTestCaseInput`
 *    initial-version shape. No filesystem, no storage; trivially unit-testable.
 *
 *  - {@link ingestGeneratedTestCases} is the seal-time orchestrator: it parses
 *    the `generated-testcases.json` bytes, writes each generated case as an
 *    immutable content-addressed snapshot, and persists the editor records
 *    inside a single transaction. Best-effort and failure-isolated — a thrown
 *    error here MUST never bubble to the run lifecycle (it would defeat the
 *    isolation in {@link persistSealedRunArtifacts}). Same `describe`-style log
 *    contract as `workbench-run-persistence.ts`: name (and code if any) only,
 *    so no filesystem paths or secrets leak to operator logs.
 */

import type { GeneratedTestCase } from "@oscharko-dev/ti-contracts";

import {
  writeArtifact,
  type ContentRef,
  type CreatePersistedTestCaseInput,
  type TestCaseStepRecord,
  type TestCaseTraceTargetInput,
} from "@/lib/server/storage";
import {
  getWorkbenchStorage,
  getWorkbenchStoragePaths,
} from "@/lib/server/storage/bootstrap";

const describeStorageError = (error: unknown): string => {
  if (!(error instanceof Error)) return "unknown persistence error";
  const code =
    "code" in error && typeof error.code === "string" ? `:${error.code}` : "";
  return `${error.name}${code}`;
};

const dedupePreservingOrder = (
  values: readonly (string | undefined)[],
): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

const buildTags = (generated: GeneratedTestCase): string[] =>
  dedupePreservingOrder([
    generated.level,
    generated.type,
    generated.technique,
    generated.polarity,
    generated.category,
    generated.regulatoryRelevance?.domain,
  ]);

const buildSteps = (
  generated: GeneratedTestCase,
): readonly TestCaseStepRecord[] =>
  generated.steps
    .filter(
      (step) =>
        typeof step.action === "string" && typeof step.expected === "string",
    )
    .map((step) => ({
      action: step.action,
      expected: step.expected ?? "",
    }));

const buildTraceTargets = (
  generated: GeneratedTestCase,
  runRowId: string,
  snapshotId?: string,
): readonly TestCaseTraceTargetInput[] => {
  const targets: TestCaseTraceTargetInput[] = [
    { targetKind: "run", targetId: runRowId },
  ];
  if (snapshotId !== undefined && snapshotId.length > 0) {
    targets.push({ targetKind: "snapshot", targetId: snapshotId });
  }
  const seenNodes = new Set<string>();
  for (const ref of generated.figmaTraceRefs) {
    const nodeId = ref.nodeId;
    if (typeof nodeId !== "string" || nodeId.length === 0) continue;
    if (seenNodes.has(nodeId)) continue;
    seenNodes.add(nodeId);
    targets.push({ targetKind: "figma-node", targetId: nodeId });
  }
  return targets;
};

export interface IngestedTestCaseProjection {
  readonly sourceTestCaseId: string;
  readonly initialVersion: CreatePersistedTestCaseInput["initialVersion"];
}

export const mapGeneratedToPersistedInitialVersion = (input: {
  readonly generated: GeneratedTestCase;
  readonly runRowId: string;
  readonly snapshotId?: string;
  readonly content: ContentRef;
}): IngestedTestCaseProjection => {
  const { generated, runRowId, snapshotId, content } = input;
  const initialVersion: CreatePersistedTestCaseInput["initialVersion"] = {
    source: "generated",
    title: generated.title,
    objective: generated.objective,
    preconditions: [...generated.preconditions],
    steps: buildSteps(generated),
    testData: [...generated.testData],
    priority: String(generated.priority),
    risk: String(generated.riskCategory),
    tags: buildTags(generated),
    status: "generated",
    content,
    traceTargets: buildTraceTargets(
      generated,
      runRowId,
      snapshotId !== undefined ? snapshotId : undefined,
    ),
  };
  return { sourceTestCaseId: generated.id, initialVersion };
};

/**
 * Parses the generator payload defensively. The engine emits the contracts
 * package `GeneratedTestCaseList` ({ jobId, schemaVersion, testCases: [...] }),
 * but historical fixtures and the mock runner have also written the bare
 * test-case array form. Both are tolerated; any other shape yields `[]` so
 * ingestion never blocks the run lifecycle.
 */
const extractTestCases = (bytes: Uint8Array): readonly GeneratedTestCase[] => {
  const text = Buffer.from(bytes).toString("utf8");
  const parsed: unknown = JSON.parse(text);
  if (Array.isArray(parsed)) {
    return parsed as readonly GeneratedTestCase[];
  }
  if (typeof parsed === "object" && parsed !== null) {
    const list = (parsed as { testCases?: unknown }).testCases;
    if (Array.isArray(list)) {
      return list as readonly GeneratedTestCase[];
    }
  }
  return [];
};

/**
 * Runtime guard for the fields the mapper and the persisted schema depend on.
 * The contracts package types are not available at runtime, and legacy
 * fixtures (mock runner output, replay-cache snapshots) sometimes carry
 * partially-shaped entries. A failing guard skips the entry rather than
 * aborting the surrounding transaction, so otherwise-valid cases in the same
 * payload still persist.
 */
const isIngestibleGeneratedTestCase = (
  candidate: unknown,
): candidate is GeneratedTestCase => {
  if (typeof candidate !== "object" || candidate === null) return false;
  const record = candidate as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    typeof record["title"] === "string" &&
    typeof record["objective"] === "string" &&
    Array.isArray(record["preconditions"]) &&
    Array.isArray(record["steps"]) &&
    Array.isArray(record["testData"]) &&
    Array.isArray(record["figmaTraceRefs"])
  );
};

export interface IngestGeneratedTestCasesInput {
  readonly env: NodeJS.ProcessEnv;
  readonly rowId: string;
  readonly tenantScope: string;
  readonly generatedSeedId: string;
  readonly seedBytes: Uint8Array;
  readonly snapshotId?: string;
}

export interface IngestGeneratedTestCasesReport {
  readonly persistedCount: number;
  readonly skippedDuplicateCount: number;
}

const EMPTY_REPORT: IngestGeneratedTestCasesReport = {
  persistedCount: 0,
  skippedDuplicateCount: 0,
};

export const ingestGeneratedTestCases = (
  input: IngestGeneratedTestCasesInput,
): IngestGeneratedTestCasesReport => {
  try {
    const cases = extractTestCases(input.seedBytes);
    if (cases.length === 0) return EMPTY_REPORT;
    const paths = getWorkbenchStoragePaths({ env: input.env });
    const storage = getWorkbenchStorage({ env: input.env });
    return storage.transaction((tx) => {
      let persisted = 0;
      let skipped = 0;
      for (const generated of cases) {
        // Defensive: malformed array entries are skipped rather than thrown,
        // so a single bad legacy fixture never aborts the surrounding
        // transaction for the otherwise-valid cases.
        if (!isIngestibleGeneratedTestCase(generated)) continue;
        const existing = tx.testCases.findBySource(
          input.tenantScope,
          input.rowId,
          generated.id,
        );
        if (existing !== undefined) {
          skipped += 1;
          continue;
        }
        // WHY JSON.stringify of the generated case: each version is anchored to
        // a content-addressed snapshot of the originating payload (AC#3). V8
        // preserves object literal key order for the engine-built payload, so
        // the same logical case yields the same hash on idempotent re-ingestion.
        const canonical = JSON.stringify(generated);
        const content = writeArtifact(
          paths,
          new Uint8Array(Buffer.from(canonical, "utf8")),
        );
        const projection = mapGeneratedToPersistedInitialVersion({
          generated,
          runRowId: input.rowId,
          ...(input.snapshotId !== undefined
            ? { snapshotId: input.snapshotId }
            : {}),
          content,
        });
        tx.testCases.create({
          tenantScope: input.tenantScope,
          sourceRunId: input.rowId,
          sourceGeneratedSeedId: input.generatedSeedId,
          sourceTestCaseId: projection.sourceTestCaseId,
          status: "draft",
          initialVersion: projection.initialVersion,
        });
        persisted += 1;
      }
      return { persistedCount: persisted, skippedDuplicateCount: skipped };
    });
  } catch (error) {
    console.error(
      `[workbench] Generated test case ingestion skipped; canonical editor records not written: ${describeStorageError(error)}`,
    );
    return EMPTY_REPORT;
  }
};
