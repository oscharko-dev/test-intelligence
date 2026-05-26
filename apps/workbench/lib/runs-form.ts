import type { OutputSubdir, RunConfig, ValidationIssue } from "./types";

export const DEFAULT_FORM: RunConfig = {
  figmaUrl: "",
  customContext: "",
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
  const fig = looksLikeFigmaDesignUrl(f.figmaUrl);
  if (!fig.ok) {
    issues.push({
      field: "figmaUrl",
      label: "Figma URL",
      message: fig.reason ?? "Invalid Figma URL",
    });
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
  if (ca && !/^([./]|[a-zA-Z]:[\\/]|\$\{?\w+\}?)/.test(ca)) {
    issues.push({
      field: "caCerts",
      label: "NODE_EXTRA_CA_CERTS",
      message: "Expected an absolute or workspace-relative path",
    });
  }
  return issues;
}

export function buildCli(f: RunConfig): string {
  const lines: string[] = [];
  if (f.caCerts) lines.push(`NODE_EXTRA_CA_CERTS=${f.caCerts} \\`);
  lines.push(`pnpm exec test-intelligence run \\`);
  lines.push(`  --figma-url "${f.figmaUrl || "<figma-url>"}" \\`);
  if (f.customContext) {
    lines.push(`  --custom-context-markdown "${f.customContext}" \\`);
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
