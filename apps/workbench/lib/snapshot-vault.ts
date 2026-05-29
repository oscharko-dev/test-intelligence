import type { SnapshotRunSelection } from "./types";

export type SnapshotImportAction = "import" | "refresh";

export type SnapshotImportJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface WorkbenchSnapshotRateLimitSummary {
  retryAfterSeconds?: number;
  remaining?: number;
  resetAt?: string;
  figmaPlanTier?: string;
  figmaRateLimitType?: string;
  figmaUpgradeLinkDigest?: string;
}

export interface WorkbenchSnapshotCatalogRow {
  snapshotId: string;
  tenantScope: string;
  importedAt: string;
  importStrategy: string;
  lifecycleState: string;
  previewStatus: string;
  boundedPreview: boolean;
  figmaVersion?: string;
  figmaLastModified?: string;
  nodeCount: number;
  pageCount: number;
  frameCount: number;
  componentCount: number;
  hiddenCount: number;
  launchable: boolean;
  cacheState: "complete" | "partial" | "failed";
  rateLimit: WorkbenchSnapshotRateLimitSummary;
}

export interface WorkbenchSnapshotPageSummary {
  pageId: string;
  pageName: string;
  frameCount: number;
  nodeCount: number;
}

export interface WorkbenchSnapshotFrameSummary {
  pageId: string;
  pageName: string;
  frameId: string;
  frameName: string;
  nodeCount: number;
}

export interface WorkbenchSnapshotNodeSummary {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  pageId: string;
  pageName: string;
  frameId?: string;
  frameName?: string;
  visible: boolean;
  offCanvas: boolean;
  missingBounds: boolean;
  labels: string[];
  componentHints: string[];
  textSnippet?: string;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  matches?: string[];
}

export interface WorkbenchSnapshotPreviewTileSummary {
  tileId: string;
  assetId: string;
  pageId?: string;
  frameId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkbenchSnapshotDetail {
  snapshot: WorkbenchSnapshotCatalogRow;
  pages: WorkbenchSnapshotPageSummary[];
  frames: WorkbenchSnapshotFrameSummary[];
  sampleNodes: WorkbenchSnapshotNodeSummary[];
  previewTiles: WorkbenchSnapshotPreviewTileSummary[];
}

export interface WorkbenchSnapshotSearchResponse {
  snapshot: WorkbenchSnapshotCatalogRow;
  query: string;
  results: WorkbenchSnapshotNodeSummary[];
}

export interface WorkbenchSnapshotSelectionPreview {
  snapshotId: string;
  scopeDigest: string;
  payloadBytes: number;
  resolvedNodeCount: number;
  requestedSelection: SnapshotRunSelection;
  traceAnchors: Array<{
    screenId: string;
    nodeId: string;
    nodeName: string;
    nodePath?: string;
  }>;
}

export interface WorkbenchSnapshotImportJob {
  jobId: string;
  action: SnapshotImportAction;
  status: SnapshotImportJobStatus;
  queueState: "idle" | "queued" | "running";
  sourceUrlHash: string;
  tenantScope: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  snapshotId?: string;
  message?: string;
  rateLimit?: WorkbenchSnapshotRateLimitSummary;
}
