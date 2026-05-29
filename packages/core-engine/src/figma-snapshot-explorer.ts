import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  BANKING_INSURANCE_SEMANTIC_KEYWORDS,
  FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION,
  FIGMA_SNAPSHOT_PREVIEW_MANIFEST_SCHEMA_VERSION,
  type FigmaSnapshotManifest,
  type FigmaSnapshotNodeIndex,
  type FigmaSnapshotNodeRecord,
  type FigmaSnapshotPreviewManifest,
  type FigmaSnapshotSourceIdentifier,
  type TenantScope,
} from "@oscharko-dev/ti-contracts";
import {
  canonicalJson,
  redactHighRiskSecrets,
  sanitizeErrorMessage,
  sha256Hex,
} from "@oscharko-dev/ti-security";

import {
  buildFigmaSnapshotVaultPath,
  computeFigmaSnapshotArtifactDigest,
  serializeFigmaSnapshotArtifact,
  validateFigmaSnapshotManifest,
  validateFigmaSnapshotNodeIndex,
  validateFigmaSnapshotPreviewManifest,
} from "./figma-snapshot-vault.js";

const ZERO_DIGEST =
  "0000000000000000000000000000000000000000000000000000000000000000";
const MAX_TEXT_LENGTH = 240;
const DEFAULT_PREVIEW_TILE_LIMIT = 256;
const MAX_PREVIEW_TILE_LIMIT = 1_000;
const DEFAULT_PREVIEW_TILE_WIDTH = 1_024;
const DEFAULT_PREVIEW_TILE_HEIGHT = 768;
const MANIFEST_FILENAME = "manifest.json";
const PREVIEW_MANIFEST_FILENAME = "preview-manifest.json";
const PREVIEW_PLAN_MEDIA_TYPE =
  "application/vnd.test-intelligence.figma-preview-plan+json";
const URI_LIKE_GLOBAL_RE =
  /(?:\b[A-Za-z][A-Za-z0-9+.-]*:\/\/|\b(?:mailto|tel|sms|urn|data|javascript):)\S+/giu;
const FIGMA_TOKEN_LIKE_GLOBAL_RE = /\bfigd_[A-Za-z0-9_-]{8,}\b/giu;
const ValidatedNodeIndexes = new WeakSet<object>();
const ValidatedManifests = new WeakSet<object>();

export type FigmaSnapshotExplorerErrorCode =
  | "invalid_evidence"
  | "invalid_query"
  | "persist_failed";

export class FigmaSnapshotExplorerError extends Error {
  readonly errorCode: FigmaSnapshotExplorerErrorCode;

  constructor(input: {
    errorCode: FigmaSnapshotExplorerErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(
      sanitizeDiagnostic(input.message),
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "FigmaSnapshotExplorerError";
    this.errorCode = input.errorCode;
  }
}

export interface BuildFigmaSnapshotLocalNodeIndexInput {
  readonly snapshotId: string;
  readonly tenantScope: TenantScope;
  readonly source: FigmaSnapshotSourceIdentifier;
  readonly records: readonly FigmaSnapshotNodeRecord[];
}

export type FigmaSnapshotNodeIndexQueryKind =
  | "all"
  | "label"
  | "node_id"
  | "page_frame"
  | "component"
  | "field_action"
  | "domain_term";

const QueryKindValues: ReadonlySet<string> = new Set([
  "all",
  "label",
  "node_id",
  "page_frame",
  "component",
  "field_action",
  "domain_term",
]);

export interface QueryFigmaSnapshotNodeIndexInput {
  readonly nodeIndex: FigmaSnapshotNodeIndex;
  readonly query: string;
  readonly kind?: FigmaSnapshotNodeIndexQueryKind;
  readonly limit?: number;
  readonly includeHidden?: boolean;
}

export interface FigmaSnapshotNodeIndexMatchEvidence {
  readonly kind: Exclude<FigmaSnapshotNodeIndexQueryKind, "all">;
  readonly term: string;
  readonly field: string;
  readonly value: string;
}

export interface FigmaSnapshotNodeIndexSearchHit {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly pageId: string;
  readonly pageName: string;
  readonly frameId?: string;
  readonly frameName?: string;
  readonly visible: boolean;
  readonly offCanvas: boolean;
  readonly missingBounds: boolean;
  readonly ancestorNodeIds: readonly string[];
  readonly sourceChunkRefs: FigmaSnapshotNodeRecord["sourceChunkRefs"];
  readonly matches: readonly FigmaSnapshotNodeIndexMatchEvidence[];
}

export interface PlanFigmaSnapshotPreviewCacheInput {
  readonly nodeIndex: FigmaSnapshotNodeIndex;
  readonly maxTiles?: number;
  readonly tileWidth?: number;
  readonly tileHeight?: number;
}

export interface AttachFigmaSnapshotPreviewManifestDigestInput {
  readonly manifest: FigmaSnapshotManifest;
  readonly previewManifest: FigmaSnapshotPreviewManifest;
}

export interface WriteFigmaSnapshotPreviewCacheManifestInput
  extends PlanFigmaSnapshotPreviewCacheInput {
  readonly workspaceRoot: string;
  readonly manifest: FigmaSnapshotManifest;
}

export interface WriteFigmaSnapshotPreviewCacheManifestResult {
  readonly vaultPath: string;
  readonly manifest: FigmaSnapshotManifest;
  readonly previewManifest: FigmaSnapshotPreviewManifest;
}

interface PreviewPlanPayload {
  readonly schemaVersion: "1.0.0";
  readonly planner: "figma-snapshot-preview-cache/v1";
  readonly assetId: string;
  readonly tileId: string;
  readonly snapshotId: string;
  readonly pageId: string;
  readonly frameId?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface DomainTerm {
  readonly term: string;
  readonly domain: "banking" | "insurance" | "general";
}

interface ControlHint {
  readonly hint: string;
  readonly kind: "field" | "action" | "control";
  readonly terms: readonly string[];
}

const DomainTerms: readonly DomainTerm[] = [
  ...BANKING_INSURANCE_SEMANTIC_KEYWORDS.map((term) => ({
    term,
    domain:
      /versicherung|police|schadensfall|risiko/iu.test(term) ? "insurance" : "banking",
  }) satisfies DomainTerm),
  { term: "IBAN", domain: "banking" },
  { term: "BIC", domain: "banking" },
  { term: "SEPA", domain: "banking" },
  { term: "Konto", domain: "banking" },
  { term: "Kredit", domain: "banking" },
  { term: "Zahlung", domain: "banking" },
  { term: "Depot", domain: "banking" },
  { term: "KYC", domain: "banking" },
  { term: "AML", domain: "banking" },
  { term: "card", domain: "banking" },
  { term: "claim", domain: "insurance" },
  { term: "policy", domain: "insurance" },
  { term: "premium", domain: "insurance" },
  { term: "coverage", domain: "insurance" },
  { term: "beneficiary", domain: "insurance" },
  { term: "Schaden", domain: "insurance" },
  { term: "Prämie", domain: "insurance" },
  { term: "Versicherungsnehmer", domain: "insurance" },
  { term: "Bezugsberechtigter", domain: "insurance" },
  { term: "consent", domain: "general" },
  { term: "Einwilligung", domain: "general" },
];

const ControlHints: readonly ControlHint[] = [
  {
    hint: "action:submit",
    kind: "action",
    terms: ["submit", "absenden", "abschicken", "einreichen", "antrag stellen"],
  },
  {
    hint: "action:continue",
    kind: "action",
    terms: ["continue", "weiter", "next", "fortfahren"],
  },
  {
    hint: "action:confirm",
    kind: "action",
    terms: ["confirm", "bestätigen", "approve", "freigeben", "authorize"],
  },
  {
    hint: "action:save",
    kind: "action",
    terms: ["save", "speichern", "draft", "entwurf"],
  },
  {
    hint: "field:account",
    kind: "field",
    terms: ["iban", "bic", "konto", "account"],
  },
  {
    hint: "field:amount",
    kind: "field",
    terms: ["amount", "betrag", "summe", "prämie", "premium"],
  },
  {
    hint: "field:identity",
    kind: "field",
    terms: ["name", "vorname", "nachname", "geburtsdatum", "birth"],
  },
  {
    hint: "field:contact",
    kind: "field",
    terms: ["email", "e-mail", "telefon", "phone", "adresse", "address"],
  },
  {
    hint: "control:choice",
    kind: "control",
    terms: ["radio", "checkbox", "select", "dropdown", "auswahl"],
  },
  {
    hint: "control:text-entry",
    kind: "control",
    terms: ["input", "field", "textfield", "textarea", "eingabe"],
  },
  {
    hint: "control:button",
    kind: "control",
    terms: ["button", "cta", "primary action", "secondary action"],
  },
];

export const buildFigmaSnapshotLocalNodeIndex = (
  input: BuildFigmaSnapshotLocalNodeIndexInput,
): FigmaSnapshotNodeIndex => {
  try {
    const duplicateLabelKeys = findDuplicateLabelKeys(input.records);
    const seenNodeIds = new Set<string>();
    const nodes = input.records.map((record) => {
      if (seenNodeIds.has(record.nodeId)) {
        throw new Error("node index evidence contains duplicate node ids");
      }
      seenNodeIds.add(record.nodeId);
      return enrichNodeRecord(record, duplicateLabelKeys);
    });
    const nodeIndex = withDigest<FigmaSnapshotNodeIndex>({
      schemaVersion: FIGMA_SNAPSHOT_NODE_INDEX_SCHEMA_VERSION,
      snapshotId: input.snapshotId,
      tenantScope: input.tenantScope,
      source: input.source,
      nodes: nodes.sort(compareNodeRecords),
    });
    return markValidatedNodeIndex(validateFigmaSnapshotNodeIndex(nodeIndex));
  } catch (err) {
    throw new FigmaSnapshotExplorerError({
      errorCode: "invalid_evidence",
      message: `Figma snapshot node index evidence rejected: ${sanitizeErrorMessage({
        error: err,
        fallback: "invalid node index evidence",
      })}`,
      cause: err,
    });
  }
};

export const queryFigmaSnapshotNodeIndex = (
  input: QueryFigmaSnapshotNodeIndexInput,
): readonly FigmaSnapshotNodeIndexSearchHit[] => {
  if (typeof input.query !== "string") {
    throw new FigmaSnapshotExplorerError({
      errorCode: "invalid_query",
      message: "Figma snapshot query must be a non-empty string",
    });
  }
  const query = normalizeSearchText(input.query);
  if (query.length === 0) {
    throw new FigmaSnapshotExplorerError({
      errorCode: "invalid_query",
      message: "Figma snapshot query must be a non-empty string",
    });
  }
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 1_000) {
    throw new FigmaSnapshotExplorerError({
      errorCode: "invalid_query",
      message: "Figma snapshot query limit must be an integer from 1 to 1000",
    });
  }

  const nodeIndex = validateNodeIndexForExplorer(input.nodeIndex);
  const rawKind =
    (input as { readonly kind?: unknown }).kind === undefined
      ? "all"
      : (input as { readonly kind?: unknown }).kind;
  if (typeof rawKind !== "string" || !QueryKindValues.has(rawKind)) {
    throw new FigmaSnapshotExplorerError({
      errorCode: "invalid_query",
      message: "Figma snapshot query kind is unsupported",
    });
  }
  const kind = rawKind as FigmaSnapshotNodeIndexQueryKind;
  const kinds =
    kind === "all"
      ? ([
          "node_id",
          "label",
          "page_frame",
          "component",
          "field_action",
          "domain_term",
        ] as const)
      : ([kind] as const);
  const includeHidden = input.includeHidden ?? true;
  const hits: FigmaSnapshotNodeIndexSearchHit[] = [];
  for (const record of nodeIndex.nodes) {
    if (!includeHidden && !record.visible) continue;
    const matches = kinds.flatMap((candidateKind) =>
      collectMatches(candidateKind, query, record),
    );
    if (matches.length === 0) continue;
    pushBoundedHit(
      hits,
      {
        nodeId: record.nodeId,
        nodeName: record.nodeName,
        pageId: record.pageId,
        pageName: record.pageName,
        ...(record.frameId !== undefined ? { frameId: record.frameId } : {}),
        ...(record.frameName !== undefined ? { frameName: record.frameName } : {}),
        visible: record.visible,
        offCanvas: isOffCanvas(record),
        missingBounds: record.bbox === undefined,
        ancestorNodeIds: record.ancestorNodeIds,
        sourceChunkRefs: record.sourceChunkRefs,
        matches: matches.sort(compareMatches),
      },
      limit,
    );
  }
  return hits;
};

export const planFigmaSnapshotPreviewCache = (
  input: PlanFigmaSnapshotPreviewCacheInput,
): FigmaSnapshotPreviewManifest => {
  const nodeIndex = validateNodeIndexForExplorer(input.nodeIndex);
  const maxTiles = resolvePositiveInteger(
    input.maxTiles ?? DEFAULT_PREVIEW_TILE_LIMIT,
    "maxTiles",
    1,
    MAX_PREVIEW_TILE_LIMIT,
  );
  const tileWidth = resolvePositiveInteger(
    input.tileWidth ?? DEFAULT_PREVIEW_TILE_WIDTH,
    "tileWidth",
    1,
    8_192,
  );
  const tileHeight = resolvePositiveInteger(
    input.tileHeight ?? DEFAULT_PREVIEW_TILE_HEIGHT,
    "tileHeight",
    1,
    8_192,
  );
  const { selected, candidateCount } = selectTopPreviewCandidates(
    nodeIndex.nodes,
    maxTiles,
  );
  const planned = selected.map((node) => {
    const bbox = node.bbox as NonNullable<FigmaSnapshotNodeRecord["bbox"]>;
    const width = Math.max(1, Math.min(tileWidth, Math.ceil(bbox.width)));
    const height = Math.max(1, Math.min(tileHeight, Math.ceil(bbox.height)));
    const assetSeed = sha256Hex({
      planner: "figma-snapshot-preview-cache/v1",
      snapshotId: nodeIndex.snapshotId,
      source: nodeIndex.source,
      nodeId: node.nodeId,
      bbox,
      width,
      height,
    });
    const assetId = `asset-${assetSeed.slice(0, 32)}`;
    const tileId = `tile-${sha256Hex({
      planner: "figma-snapshot-preview-cache/v1",
      snapshotId: nodeIndex.snapshotId,
      nodeId: node.nodeId,
      assetId,
      x: bbox.x,
      y: bbox.y,
      width,
      height,
    }).slice(0, 32)}`;
    const payload = buildPreviewPlanPayload({
      assetId,
      tileId,
      snapshotId: nodeIndex.snapshotId,
      node,
      width,
      height,
    });
    const payloadBytes = canonicalJson(payload);
    return {
      node,
      payload,
      asset: {
        assetId,
        relativePath: `previews/${assetId}.preview-plan.json`,
        mediaType: PREVIEW_PLAN_MEDIA_TYPE,
        width,
        height,
        byteLength: Buffer.byteLength(payloadBytes, "utf8"),
        sha256: sha256Hex(payload),
      },
    };
  });
  const assets = planned.map(({ asset }) => asset);
  const tiles = planned.map(({ asset, node, payload }) => {
    const bbox = node.bbox as NonNullable<FigmaSnapshotNodeRecord["bbox"]>;
    return {
      tileId: payload.tileId,
      assetId: asset.assetId,
      pageId: node.pageId,
      ...(node.frameId !== undefined ? { frameId: node.frameId } : {}),
      x: bbox.x,
      y: bbox.y,
      width: asset.width,
      height: asset.height,
    };
  });
  const boundedPreview =
    candidateCount > selected.length ||
    selected.some((node) => {
      const bbox = node.bbox as NonNullable<FigmaSnapshotNodeRecord["bbox"]>;
      return bbox.width > tileWidth || bbox.height > tileHeight;
    });
  const previewManifest = withDigest<FigmaSnapshotPreviewManifest>({
    schemaVersion: FIGMA_SNAPSHOT_PREVIEW_MANIFEST_SCHEMA_VERSION,
    snapshotId: nodeIndex.snapshotId,
    tenantScope: nodeIndex.tenantScope,
    source: nodeIndex.source,
    previewStatus: "complete",
    boundedPreview,
    assets,
    tiles,
  });
  return validateFigmaSnapshotPreviewManifest(previewManifest);
};

export const attachFigmaSnapshotPreviewManifestDigest = (
  input: AttachFigmaSnapshotPreviewManifestDigestInput,
): FigmaSnapshotManifest => {
  const manifest = validateManifestForExplorer(input.manifest);
  const previewManifest = validateFigmaSnapshotPreviewManifest(input.previewManifest);
  assertSameSnapshotIdentity("preview manifest", manifest, previewManifest);
  const updated = withDigest<FigmaSnapshotManifest>({
    ...manifest,
    artifactDigests: {
      ...manifest.artifactDigests,
      previewManifestDigest: previewManifest.contentDigest,
    },
  });
  return markValidatedManifest(validateFigmaSnapshotManifest(updated));
};

export const writeFigmaSnapshotPreviewCacheManifest = async (
  input: WriteFigmaSnapshotPreviewCacheManifestInput,
): Promise<WriteFigmaSnapshotPreviewCacheManifestResult> => {
  const nodeIndex = validateNodeIndexForExplorer(input.nodeIndex);
  const previewManifest = planFigmaSnapshotPreviewCache(input);
  const manifest = attachFigmaSnapshotPreviewManifestDigest({
    manifest: input.manifest,
    previewManifest,
  });
  assertSameSnapshotIdentity("node index", manifest, nodeIndex);
  if (manifest.artifactDigests.nodeIndexDigest !== nodeIndex.contentDigest) {
    throw new FigmaSnapshotExplorerError({
      errorCode: "invalid_evidence",
      message: "Figma snapshot manifest node-index digest does not match node index",
    });
  }
  const vaultPath = buildFigmaSnapshotVaultPath({
    workspaceRoot: input.workspaceRoot,
    tenantScope: manifest.tenantScope,
    fileKeyHash: manifest.source.fileKeyHash,
    snapshotId: manifest.snapshotId,
  });
  try {
    await writeFigmaSnapshotPreviewCacheAssets(vaultPath, previewManifest);
    await writeJsonAtomically(
      join(vaultPath, PREVIEW_MANIFEST_FILENAME),
      serializeFigmaSnapshotArtifact(previewManifest),
    );
    await writeJsonAtomically(
      join(vaultPath, MANIFEST_FILENAME),
      serializeFigmaSnapshotArtifact(manifest),
    );
  } catch (err) {
    throw new FigmaSnapshotExplorerError({
      errorCode: "persist_failed",
      message: `Figma snapshot preview manifest persistence failed: ${sanitizeErrorMessage({
        error: err,
        fallback: "write failed",
      })}`,
      cause: err,
    });
  }
  return { vaultPath, manifest, previewManifest };
};

export const writeFigmaSnapshotPreviewCacheAssets = async (
  vaultPath: string,
  previewManifest: FigmaSnapshotPreviewManifest,
): Promise<void> => {
  const manifest = validateFigmaSnapshotPreviewManifest(previewManifest);
  const tileByAssetId = new Map(manifest.tiles.map((tile) => [tile.assetId, tile]));
  for (const asset of manifest.assets) {
    const tile = tileByAssetId.get(asset.assetId);
    if (tile === undefined) {
      throw new FigmaSnapshotExplorerError({
        errorCode: "invalid_evidence",
        message: "Figma snapshot preview asset has no matching tile",
      });
    }
    const payload = buildPreviewPlanPayloadFromManifest({
      manifest,
      asset,
      tile,
    });
    const payloadBytes = canonicalJson(payload);
    const digest = sha256Hex(payload);
    if (
      asset.sha256 !== digest ||
      asset.byteLength !== Buffer.byteLength(payloadBytes, "utf8")
    ) {
      throw new FigmaSnapshotExplorerError({
        errorCode: "invalid_evidence",
        message: "Figma snapshot preview asset digest or byte length is inconsistent",
      });
    }
    await writeJsonAtomically(join(vaultPath, asset.relativePath), payloadBytes, false);
  }
};

const validateNodeIndexForExplorer = (
  value: FigmaSnapshotNodeIndex,
): FigmaSnapshotNodeIndex => {
  try {
    if (typeof value === "object" && value !== null && ValidatedNodeIndexes.has(value)) {
      return value;
    }
    return markValidatedNodeIndex(validateFigmaSnapshotNodeIndex(value));
  } catch (err) {
    throw new FigmaSnapshotExplorerError({
      errorCode: "invalid_evidence",
      message: `Figma snapshot node index rejected: ${sanitizeErrorMessage({
        error: err,
        fallback: "invalid node index",
      })}`,
      cause: err,
    });
  }
};

const validateManifestForExplorer = (
  value: FigmaSnapshotManifest,
): FigmaSnapshotManifest => {
  try {
    if (typeof value === "object" && value !== null && ValidatedManifests.has(value)) {
      return value;
    }
    return markValidatedManifest(validateFigmaSnapshotManifest(value));
  } catch (err) {
    throw new FigmaSnapshotExplorerError({
      errorCode: "invalid_evidence",
      message: `Figma snapshot manifest rejected: ${sanitizeErrorMessage({
        error: err,
        fallback: "invalid snapshot manifest",
      })}`,
      cause: err,
    });
  }
};

const enrichNodeRecord = (
  record: FigmaSnapshotNodeRecord,
  duplicateLabelKeys: ReadonlySet<string>,
): FigmaSnapshotNodeRecord => {
  const sanitized = sanitizeNodeRecord(record);
  const searchableTerms = buildSearchableTerms(sanitized);
  const domainLabels = collectDomainTerms(sanitized).map(
    ({ domain, term }) => `domain:${domain}:${normalizeSearchText(term)}`,
  );
  const controlHints = inferControlHints(sanitized);
  const labels = uniqueSorted([
    ...sanitized.labels,
    sanitized.nodeName,
    sanitized.pageName,
    sanitized.frameName,
    sanitized.textSnippet,
    ...domainLabels,
    ...controlHints.map((hint) => hint.hint),
    ...(sanitized.visible ? [] : ["hidden"]),
    ...(sanitized.bbox === undefined ? ["missing-bounds"] : []),
    ...(isOffCanvas(sanitized) ? ["off-canvas"] : []),
    ...(duplicateLabelKeys.has(normalizeDuplicateLabel(sanitized))
      ? ["duplicate-label"]
      : []),
    ...searchableTerms.filter((term) => term.length <= 80),
  ]);
  const componentHints = uniqueSorted([
    ...sanitized.componentHints,
    ...controlHints.map((hint) => hint.hint),
    `type:${normalizeSearchText(sanitized.nodeType)}`,
  ]);
  return {
    ...sanitized,
    labels,
    componentHints,
  };
};

const sanitizeNodeRecord = (
  record: FigmaSnapshotNodeRecord,
): FigmaSnapshotNodeRecord => ({
  pageId: sanitizeText(record.pageId, "page"),
  pageName: sanitizeText(record.pageName, "page"),
  ...(record.frameId !== undefined
    ? { frameId: sanitizeText(record.frameId, "frame") }
    : {}),
  ...(record.frameName !== undefined
    ? { frameName: sanitizeText(record.frameName, "frame") }
    : {}),
  nodeId: sanitizeText(record.nodeId, "node"),
  nodeName: sanitizeText(record.nodeName, "node"),
  nodeType: sanitizeText(record.nodeType, "UNKNOWN"),
  ...(record.parentNodeId !== undefined
    ? { parentNodeId: sanitizeText(record.parentNodeId, "parent") }
    : {}),
  ancestorNodeIds: record.ancestorNodeIds.map((value) =>
    sanitizeText(value, "ancestor"),
  ),
  ...(record.bbox !== undefined ? { bbox: record.bbox } : {}),
  labels: record.labels.map((value) => sanitizeText(value, "label")),
  ...(record.textSnippet !== undefined
    ? { textSnippet: sanitizeText(record.textSnippet, "text") }
    : {}),
  componentHints: record.componentHints.map((value) =>
    sanitizeText(value, "component"),
  ),
  visible: record.visible,
  sourceChunkRefs: record.sourceChunkRefs.map((chunk) => ({
    chunkId: sanitizeText(chunk.chunkId, "chunk"),
    ...(chunk.startNodePath !== undefined
      ? { startNodePath: sanitizeText(chunk.startNodePath, "path") }
      : {}),
    ...(chunk.endNodePath !== undefined
      ? { endNodePath: sanitizeText(chunk.endNodePath, "path") }
      : {}),
  })),
});

const findDuplicateLabelKeys = (
  records: readonly FigmaSnapshotNodeRecord[],
): ReadonlySet<string> => {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = normalizeDuplicateLabel(record);
    if (key.length === 0) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([label]) => label),
  );
};

const normalizeDuplicateLabel = (record: FigmaSnapshotNodeRecord): string =>
  normalizeSearchText(record.textSnippet ?? record.nodeName);

const buildSearchableTerms = (
  record: FigmaSnapshotNodeRecord,
): readonly string[] => [
  record.nodeName,
  record.nodeType,
  record.pageName,
  record.frameName,
  record.textSnippet,
  ...record.labels,
  ...record.componentHints,
].filter((value): value is string => typeof value === "string" && value.length > 0);

const collectMatches = (
  kind: Exclude<FigmaSnapshotNodeIndexQueryKind, "all">,
  query: string,
  record: FigmaSnapshotNodeRecord,
): readonly FigmaSnapshotNodeIndexMatchEvidence[] => {
  switch (kind) {
    case "node_id":
      return matchesFields(query, kind, [
        ["nodeId", record.nodeId],
        ["parentNodeId", record.parentNodeId],
      ]);
    case "label":
      return matchesFields(query, kind, [
        ["nodeName", record.nodeName],
        ["textSnippet", record.textSnippet],
        ["labels", record.labels.join(" ")],
      ]);
    case "page_frame":
      return matchesFields(query, kind, [
        ["pageId", record.pageId],
        ["pageName", record.pageName],
        ["frameId", record.frameId],
        ["frameName", record.frameName],
      ]);
    case "component":
      return matchesFields(query, kind, [
        ["nodeType", record.nodeType],
        ["nodeName", record.nodeName],
        ["componentHints", record.componentHints.join(" ")],
      ]);
    case "field_action":
      return inferControlHints(record)
        .filter(
          (hint) =>
            normalizeSearchText(hint.hint).includes(query) ||
            hint.terms.some((term) => normalizeSearchText(term).includes(query)) ||
            query === hint.kind,
        )
        .map((hint) => ({
          kind,
          term: hint.hint,
          field: "componentHints",
          value: hint.hint,
        }));
    case "domain_term":
      return collectDomainTerms(record)
        .filter(
          (entry) =>
            normalizeSearchText(entry.term).includes(query) ||
            query === entry.domain,
        )
        .map((entry) => ({
          kind,
          term: entry.term,
          field: "domainTerms",
          value: `${entry.domain}:${entry.term}`,
        }));
  }
};

const matchesFields = (
  query: string,
  kind: Exclude<FigmaSnapshotNodeIndexQueryKind, "all">,
  fields: readonly (readonly [field: string, value: string | undefined])[],
): readonly FigmaSnapshotNodeIndexMatchEvidence[] => {
  const matches: FigmaSnapshotNodeIndexMatchEvidence[] = [];
  for (const [field, value] of fields) {
    if (value === undefined) continue;
    if (normalizeSearchText(value).includes(query)) {
      matches.push({
        kind,
        term: inputTermForMatch(query, value),
        field,
        value: sanitizeText(value, field),
      });
    }
  }
  return matches;
};

const inputTermForMatch = (query: string, value: string): string => {
  const sanitized = sanitizeText(value, "match");
  const normalized = normalizeSearchText(sanitized);
  if (normalized === query) return sanitized;
  return query;
};

const inferControlHints = (
  record: FigmaSnapshotNodeRecord,
): readonly ControlHint[] => {
  const haystack = normalizeSearchText(buildSearchableTerms(record).join(" "));
  return ControlHints.filter((hint) =>
    hint.terms.some((term) => haystack.includes(normalizeSearchText(term))),
  );
};

const collectDomainTerms = (
  record: FigmaSnapshotNodeRecord,
): readonly DomainTerm[] => {
  const haystack = normalizeSearchText(buildSearchableTerms(record).join(" "));
  return DomainTerms.filter((entry) =>
    haystack.includes(normalizeSearchText(entry.term)),
  ).sort((left, right) => left.term.localeCompare(right.term));
};

const isOffCanvas = (record: FigmaSnapshotNodeRecord): boolean => {
  const bbox = record.bbox;
  if (bbox === undefined) return false;
  return bbox.x + bbox.width <= 0 || bbox.y + bbox.height <= 0;
};

const buildPreviewPlanPayload = (input: {
  readonly assetId: string;
  readonly tileId: string;
  readonly snapshotId: string;
  readonly node: FigmaSnapshotNodeRecord;
  readonly width: number;
  readonly height: number;
}): PreviewPlanPayload => {
  const bbox = input.node.bbox as NonNullable<FigmaSnapshotNodeRecord["bbox"]>;
  return {
    schemaVersion: "1.0.0",
    planner: "figma-snapshot-preview-cache/v1",
    assetId: input.assetId,
    tileId: input.tileId,
    snapshotId: input.snapshotId,
    pageId: input.node.pageId,
    ...(input.node.frameId !== undefined ? { frameId: input.node.frameId } : {}),
    x: bbox.x,
    y: bbox.y,
    width: input.width,
    height: input.height,
  };
};

const buildPreviewPlanPayloadFromManifest = (input: {
  readonly manifest: FigmaSnapshotPreviewManifest;
  readonly asset: FigmaSnapshotPreviewManifest["assets"][number];
  readonly tile: FigmaSnapshotPreviewManifest["tiles"][number];
}): PreviewPlanPayload => ({
  schemaVersion: "1.0.0",
  planner: "figma-snapshot-preview-cache/v1",
  assetId: input.asset.assetId,
  tileId: input.tile.tileId,
  snapshotId: input.manifest.snapshotId,
  pageId: input.tile.pageId ?? "unknown-page",
  ...(input.tile.frameId !== undefined ? { frameId: input.tile.frameId } : {}),
  x: input.tile.x,
  y: input.tile.y,
  width: input.tile.width,
  height: input.tile.height,
});

function markValidatedNodeIndex(
  nodeIndex: FigmaSnapshotNodeIndex,
): FigmaSnapshotNodeIndex {
  const frozen = deepFreeze(nodeIndex);
  ValidatedNodeIndexes.add(frozen);
  return frozen;
}

function markValidatedManifest(
  manifest: FigmaSnapshotManifest,
): FigmaSnapshotManifest {
  const frozen = deepFreeze(manifest);
  ValidatedManifests.add(frozen);
  return frozen;
}

const deepFreeze = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  const record = value as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    deepFreeze(record[key], seen);
  }
  return Object.freeze(value);
};

const pushBoundedHit = (
  hits: FigmaSnapshotNodeIndexSearchHit[],
  hit: FigmaSnapshotNodeIndexSearchHit,
  limit: number,
): void => {
  const insertAt = hits.findIndex((current) => compareHits(hit, current) < 0);
  if (insertAt === -1) {
    if (hits.length < limit) hits.push(hit);
    return;
  }
  hits.splice(insertAt, 0, hit);
  if (hits.length > limit) hits.pop();
};

const selectTopPreviewCandidates = (
  nodes: readonly FigmaSnapshotNodeRecord[],
  limit: number,
): {
  readonly selected: readonly FigmaSnapshotNodeRecord[];
  readonly candidateCount: number;
} => {
  const selected: FigmaSnapshotNodeRecord[] = [];
  let candidateCount = 0;
  for (const node of nodes) {
    if (node.bbox === undefined) continue;
    candidateCount += 1;
    const insertAt = selected.findIndex(
      (current) => comparePreviewCandidates(node, current) < 0,
    );
    if (insertAt === -1) {
      if (selected.length < limit) selected.push(node);
      continue;
    }
    selected.splice(insertAt, 0, node);
    if (selected.length > limit) selected.pop();
  }
  return { selected, candidateCount };
};

const compareNodeRecords = (
  left: FigmaSnapshotNodeRecord,
  right: FigmaSnapshotNodeRecord,
): number =>
  compareStrings(left.nodeId, right.nodeId) ||
  compareStrings(left.pageId, right.pageId) ||
  compareStrings(left.frameId ?? "", right.frameId ?? "");

const comparePreviewCandidates = (
  left: FigmaSnapshotNodeRecord,
  right: FigmaSnapshotNodeRecord,
): number => {
  const leftPriority = previewPriority(left);
  const rightPriority = previewPriority(right);
  return (
    leftPriority - rightPriority ||
    compareStrings(left.pageId, right.pageId) ||
    compareStrings(left.frameId ?? "", right.frameId ?? "") ||
    compareStrings(left.nodeId, right.nodeId)
  );
};

const previewPriority = (record: FigmaSnapshotNodeRecord): number => {
  const type = normalizeSearchText(record.nodeType);
  if (type === "canvas") return 0;
  if (type === "frame" || type === "component") return 1;
  if (type === "instance") return 2;
  return record.visible ? 3 : 4;
};

const compareMatches = (
  left: FigmaSnapshotNodeIndexMatchEvidence,
  right: FigmaSnapshotNodeIndexMatchEvidence,
): number =>
  matchKindPriority(left.kind) - matchKindPriority(right.kind) ||
  compareStrings(left.field, right.field) ||
  compareStrings(left.term, right.term);

const compareHits = (
  left: FigmaSnapshotNodeIndexSearchHit,
  right: FigmaSnapshotNodeIndexSearchHit,
): number => {
  const leftPriority = Math.min(...left.matches.map((match) => matchKindPriority(match.kind)));
  const rightPriority = Math.min(...right.matches.map((match) => matchKindPriority(match.kind)));
  return (
    leftPriority - rightPriority ||
    compareStrings(left.pageId, right.pageId) ||
    compareStrings(left.frameId ?? "", right.frameId ?? "") ||
    compareStrings(left.nodeId, right.nodeId)
  );
};

const matchKindPriority = (
  kind: Exclude<FigmaSnapshotNodeIndexQueryKind, "all">,
): number =>
  ({
    node_id: 0,
    label: 1,
    page_frame: 2,
    component: 3,
    field_action: 4,
    domain_term: 5,
  })[kind];

const assertSameSnapshotIdentity = (
  label: string,
  manifest: Pick<FigmaSnapshotManifest, "snapshotId" | "tenantScope" | "source">,
  artifact: Pick<FigmaSnapshotNodeIndex | FigmaSnapshotPreviewManifest, "snapshotId" | "tenantScope" | "source">,
): void => {
  if (
    manifest.snapshotId !== artifact.snapshotId ||
    canonicalJson(manifest.tenantScope) !== canonicalJson(artifact.tenantScope) ||
    canonicalJson(manifest.source) !== canonicalJson(artifact.source)
  ) {
    throw new FigmaSnapshotExplorerError({
      errorCode: "invalid_evidence",
      message: `Figma snapshot ${label} identity does not match manifest`,
    });
  }
};

const resolvePositiveInteger = (
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new FigmaSnapshotExplorerError({
      errorCode: "invalid_evidence",
      message: `${label} must be an integer from ${minimum} to ${maximum}`,
    });
  }
  return value;
};

const sanitizeText = (value: string | undefined, fallback: string): string => {
  const raw = value === undefined || value.trim().length === 0 ? fallback : value;
  const redacted = redactHighRiskSecrets(raw, "[REDACTED]")
    .replace(URI_LIKE_GLOBAL_RE, "[URI_REDACTED]")
    .replace(FIGMA_TOKEN_LIKE_GLOBAL_RE, "[REDACTED]");
  const collapsed = redacted.replace(/\s+/gu, " ").trim();
  const safe = collapsed.length === 0 ? fallback : collapsed;
  return safe.length > MAX_TEXT_LENGTH ? `${safe.slice(0, MAX_TEXT_LENGTH - 3)}...` : safe;
};

const sanitizeDiagnostic = (message: string): string =>
  sanitizeErrorMessage({
    error: new Error(
      message
        .replace(URI_LIKE_GLOBAL_RE, "[URI_REDACTED]")
        .replace(FIGMA_TOKEN_LIKE_GLOBAL_RE, "[REDACTED]"),
    ),
    fallback: "Figma snapshot explorer failed",
  });

const normalizeSearchText = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de-DE")
    .replace(/[^a-z0-9:_-]+/gu, " ")
    .trim();

const uniqueSorted = (
  values: readonly (string | undefined)[],
): readonly string[] =>
  [...new Set(values.filter((value): value is string => value !== undefined && value.length > 0))]
    .sort(compareStrings)
    .slice(0, 120);

const compareStrings = (left: string, right: string): number =>
  left.localeCompare(right, "en", { numeric: true });

const withDigest = <T extends { readonly contentDigest: string }>(
  artifact: Omit<T, "contentDigest">,
): T =>
  ({
    ...artifact,
    contentDigest: computeFigmaSnapshotArtifactDigest({
      ...artifact,
      contentDigest: ZERO_DIGEST,
    }),
  }) as T;

const writeJsonAtomically = async (
  path: string,
  content: string,
  appendNewline = true,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const output =
    appendNewline && !content.endsWith("\n") ? `${content}\n` : content;
  await writeFile(tempPath, output, "utf8");
  await rename(tempPath, path);
};
