import type { OutputSubdir, RunConfig, ValidationIssue } from "./types";

export const DEFAULT_FORM: RunConfig = {
  sourceMode: "figma-url",
  figmaUrl: "",
  snapshotId: "",
  snapshotSelection: {
    nodeIds: [],
    pageIds: [],
    frameIds: [],
  },
  customContext: "",
  autoJiraStory: false,
  outputDir: "",
  outputRunSubdir: "job-id",
  visualSidecar: true,
  allowPolicyBlocked: false,
  caCerts: "",
  jobIdOverride: "",
};

export const OUTPUT_SUBDIR_OPTIONS: ReadonlyArray<{
  value: OutputSubdir;
  label: string;
}> = [
  { value: "job-id", label: "job-id  (default)" },
  { value: "timestamp", label: "timestamp" },
  { value: "none", label: "none  (write in place)" },
];

export interface FigmaUrlCheck {
  ok: boolean;
  reason?: string;
}

const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
const SAFE_WORKSPACE_RELATIVE_PATH = /^[A-Za-z0-9._/-]+$/u;
const SAFE_SNAPSHOT_SEGMENT = /^[A-Za-z0-9._-]+$/u;

function isWorkspaceRelativePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (
    trimmed.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH.test(trimmed) ||
    !SAFE_WORKSPACE_RELATIVE_PATH.test(trimmed)
  ) {
    return false;
  }
  const segments = trimmed.split("/");
  return segments.every((segment) => segment !== "." && segment !== "..");
}

export function looksLikeFigmaDesignUrl(url: string): FigmaUrlCheck {
  if (!url) return { ok: false, reason: "Figma URL is empty" };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "URL is malformed" };
  }
  if (!/(^|\.)figma\.com$/i.test(u.hostname)) {
    return { ok: false, reason: "Host must be figma.com" };
  }
  if (!/\/design\//.test(u.pathname)) {
    return {
      ok: false,
      reason: "Path must contain /design/<fileKey>/<name>",
    };
  }
  if (!u.searchParams.get("node-id")) {
    return { ok: false, reason: "Missing required node-id query param" };
  }
  return { ok: true };
}

export function validateForm(f: RunConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (f.sourceMode === "snapshot") {
    if (
      f.snapshotId.trim().length === 0 ||
      !SAFE_SNAPSHOT_SEGMENT.test(f.snapshotId) ||
      f.snapshotId === "." ||
      f.snapshotId === ".."
    ) {
      issues.push({
        field: "snapshotId",
        label: "Snapshot ID",
        message:
          "Snapshot ID must contain only letters, numbers, dot, underscore or dash.",
      });
    }
    const selectionSize =
      f.snapshotSelection.nodeIds.length +
      f.snapshotSelection.pageIds.length +
      f.snapshotSelection.frameIds.length;
    if (selectionSize === 0) {
      issues.push({
        field: "snapshotSelection",
        label: "Snapshot selection",
        message: "Select at least one local page, frame, mask, element or group.",
      });
    }
    if (f.autoJiraStory) {
      issues.push({
        field: "autoJiraStory",
        label: "Auto Jira Story",
        message:
          "Auto Jira Story requires live visual capture and is disabled for local snapshots.",
      });
    }
  } else {
    const fig = looksLikeFigmaDesignUrl(f.figmaUrl);
    if (!fig.ok) {
      issues.push({
        field: "figmaUrl",
        label: "Figma URL",
        message: fig.reason ?? "Invalid Figma URL",
      });
    }
  }
  const outDir = f.outputDir.trim();
  if (!outDir) {
    issues.push({
      field: "outputDir",
      label: "Output directory",
      message: "Output directory is required",
    });
  } else if (!/^[.\/\-\w]+(\/[^\s]*)?$/.test(outDir)) {
    issues.push({
      field: "outputDir",
      label: "Output directory",
      message: "Path contains unsupported characters",
    });
  }
  const ca = f.caCerts.trim();
  if (ca && !isWorkspaceRelativePath(ca)) {
    issues.push({
      field: "caCerts",
      label: "NODE_EXTRA_CA_CERTS",
      message: "Expected a workspace-relative path",
    });
  }
  if (f.autoJiraStory && !f.visualSidecar) {
    issues.push({
      field: "visualSidecar",
      label: "Visual sidecar",
      message: "Auto Jira Story requires the visual sidecar.",
    });
  }
  if (f.autoJiraStory && f.customContext.trim().length > 0) {
    issues.push({
      field: "customContext",
      label: "Custom context markdown",
      message: "Clear manual custom context when Auto Jira Story is enabled.",
    });
  }
  return issues;
}

export function buildCli(f: RunConfig): string {
  const lines: string[] = [];
  if (f.caCerts) lines.push(`NODE_EXTRA_CA_CERTS=${f.caCerts} \\`);
  lines.push(`pnpm exec test-intelligence run \\`);
  if (f.sourceMode === "snapshot") {
    lines.push(`  --figma-snapshot-id "${f.snapshotId || "<snapshot-id>"}" \\`);
    lines.push(`  --figma-snapshot-root . \\`);
    for (const pageId of f.snapshotSelection.pageIds) {
      lines.push(`  --figma-snapshot-page-id "${pageId}" \\`);
    }
    for (const frameId of f.snapshotSelection.frameIds) {
      lines.push(`  --figma-snapshot-frame-id "${frameId}" \\`);
    }
    for (const nodeId of f.snapshotSelection.nodeIds) {
      lines.push(`  --figma-snapshot-node-id "${nodeId}" \\`);
    }
  } else {
    lines.push(`  --figma-url "${f.figmaUrl || "<figma-url>"}" \\`);
  }
  if (f.customContext) {
    lines.push(`  --custom-context-markdown "${f.customContext}" \\`);
  }
  if (f.autoJiraStory) {
    lines.push(`  --auto-jira-story-from-visual \\`);
  }
  lines.push(`  --output "${f.outputDir || "<output-dir>"}" \\`);
  lines.push(`  --output-run-subdir ${f.outputRunSubdir} \\`);
  if (f.visualSidecar) lines.push(`  --enable-visual-sidecar \\`);
  if (f.allowPolicyBlocked) lines.push(`  --allow-policy-blocked \\`);
  if (f.jobIdOverride) lines.push(`  --job-id ${f.jobIdOverride} \\`);
  return lines
    .map((l, i) => (i === lines.length - 1 ? l.replace(/\s*\\$/, "") : l))
    .join("\n");
}

export interface FigmaParts {
  fileKey: string;
  nodeId: string;
}

export function parseFigmaParts(figmaUrl: string): FigmaParts {
  try {
    const u = new URL(figmaUrl);
    const m = u.pathname.match(/\/design\/([^/]+)/);
    return {
      fileKey: m?.[1] ?? "—",
      nodeId: u.searchParams.get("node-id") ?? "—",
    };
  } catch {
    return { fileKey: "—", nodeId: "—" };
  }
}
