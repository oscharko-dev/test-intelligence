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
  remediation?: WorkbenchSnapshotRateLimitRemediation;
}

export interface WorkbenchSnapshotRateLimitRemediation {
  scenario: "low_limit" | "high_limit" | "unknown";
  guidance: string;
}

export interface WorkbenchSnapshotCredentialSummary {
  authMode:
    | "personal_access_token"
    | "oauth_access_token"
    | "enterprise_service_token";
}

export interface WorkbenchSnapshotBudgetSummary {
  policyVersion: string;
  resourceType?: "file_bootstrap" | "node_batch" | "image_metadata";
  windowSeconds: number;
  maxRequestsPerWindow: number;
  usedRequests: number;
  remainingRequests: number;
  resetAt?: string;
}

export type WorkbenchSnapshotFailureClass =
  | "throttled"
  | "budget_exhausted"
  | "oversized_board"
  | "corrupted_checkpoint"
  | "missing_chunk"
  | "invalid_snapshot"
  | "unsafe_path"
  | "non_resumable_partial_state"
  | "missing_credential"
  | "invalid_credential"
  | "unsupported_auth_mode"
  | "transport"
  | "invalid_request"
  | "not_found"
  | "persistence_failed";

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
  credential?: WorkbenchSnapshotCredentialSummary;
  budget?: WorkbenchSnapshotBudgetSummary;
  failureClass?: WorkbenchSnapshotFailureClass;
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
  credential?: WorkbenchSnapshotCredentialSummary;
  budget?: WorkbenchSnapshotBudgetSummary;
  failureClass?: WorkbenchSnapshotFailureClass;
}
