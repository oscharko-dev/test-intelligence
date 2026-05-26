import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORM,
  buildCli,
  looksLikeFigmaDesignUrl,
  parseFigmaParts,
  validateForm,
} from "@/lib/runs-form";

describe("looksLikeFigmaDesignUrl", () => {
  it("rejects empty input", () => {
    expect(looksLikeFigmaDesignUrl("").ok).toBe(false);
  });

  it("rejects malformed urls", () => {
    expect(looksLikeFigmaDesignUrl("not a url").ok).toBe(false);
  });

  it("rejects non-figma hosts", () => {
    const r = looksLikeFigmaDesignUrl(
      "https://example.com/design/ABC/Name?node-id=1-2",
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("figma.com");
  });

  it("rejects when /design/ is missing from the path", () => {
    const r = looksLikeFigmaDesignUrl(
      "https://www.figma.com/file/ABC/Name?node-id=1-2",
    );
    expect(r.ok).toBe(false);
  });

  it("rejects when node-id is missing", () => {
    const r = looksLikeFigmaDesignUrl("https://www.figma.com/design/ABC/Name");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("node-id");
  });

  it("accepts a well-formed figma design url", () => {
    const r = looksLikeFigmaDesignUrl(
      "https://www.figma.com/design/ABC/Onboarding?node-id=128-4421",
    );
    expect(r.ok).toBe(true);
  });
});

describe("validateForm", () => {
  it("reports issues for default empty form", () => {
    const issues = validateForm(DEFAULT_FORM);
    const fields = new Set(issues.map((i) => i.field));
    expect(fields.has("figmaUrl")).toBe(true);
    expect(fields.has("outputDir")).toBe(true);
  });

  it("flags bad output directory characters", () => {
    const issues = validateForm({
      ...DEFAULT_FORM,
      figmaUrl: "https://www.figma.com/design/ABC/Name?node-id=1-2",
      outputDir: "no spaces allowed",
    });
    expect(issues.some((i) => i.field === "outputDir")).toBe(true);
  });

  it("flags a relative-looking CA cert path that isn't a path", () => {
    const issues = validateForm({
      ...DEFAULT_FORM,
      figmaUrl: "https://www.figma.com/design/ABC/Name?node-id=1-2",
      outputDir: ".out",
      caCerts: "weird~entry",
    });
    expect(issues.some((i) => i.field === "caCerts")).toBe(true);
  });

  it("returns no issues for a clean configuration", () => {
    const issues = validateForm({
      ...DEFAULT_FORM,
      figmaUrl: "https://www.figma.com/design/ABC/Name?node-id=1-2",
      outputDir: ".test-intelligence/local-testcases/2026-05-24",
    });
    expect(issues).toEqual([]);
  });
});

describe("buildCli", () => {
  it("emits the full canonical invocation when all toggles are on", () => {
    const cli = buildCli({
      ...DEFAULT_FORM,
      caCerts: "/etc/ssl/cert.pem",
      figmaUrl: "https://www.figma.com/design/ABC/Name?node-id=1-2",
      customContext: "test-case/ABC/JIRA_STORY.md",
      outputDir: ".out",
      outputRunSubdir: "job-id",
      visualSidecar: true,
      allowPolicyBlocked: true,
      jobIdOverride: "ti-workbench-42",
    });
    expect(cli).toContain("NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem");
    expect(cli).toContain("pnpm exec test-intelligence run");
    expect(cli).toContain("--figma-url");
    expect(cli).toContain("--custom-context-markdown");
    expect(cli).toContain("--output");
    expect(cli).toContain("--output-run-subdir job-id");
    expect(cli).toContain("--enable-visual-sidecar");
    expect(cli).toContain("--allow-policy-blocked");
    expect(cli).toContain("--job-id ti-workbench-42");
  });

  it("omits optional flags when off / empty", () => {
    const cli = buildCli({
      ...DEFAULT_FORM,
      figmaUrl: "https://www.figma.com/design/ABC/Name?node-id=1-2",
      outputDir: ".out",
      visualSidecar: false,
      allowPolicyBlocked: false,
    });
    expect(cli).not.toContain("--enable-visual-sidecar");
    expect(cli).not.toContain("--allow-policy-blocked");
    expect(cli).not.toContain("--custom-context-markdown");
    expect(cli).not.toContain("--job-id");
    expect(cli).not.toContain("NODE_EXTRA_CA_CERTS");
  });

  it("does not leave a trailing backslash on the final line", () => {
    const cli = buildCli({
      ...DEFAULT_FORM,
      figmaUrl: "https://www.figma.com/design/ABC/Name?node-id=1-2",
      outputDir: ".out",
    });
    expect(cli.endsWith("\\")).toBe(false);
  });
});

describe("parseFigmaParts", () => {
  it("extracts fileKey and node-id from a valid url", () => {
    const parts = parseFigmaParts(
      "https://www.figma.com/design/ABC123/Onboarding?node-id=128-4421",
    );
    expect(parts).toEqual({ fileKey: "ABC123", nodeId: "128-4421" });
  });

  it("returns dashes for unparseable input", () => {
    expect(parseFigmaParts("garbage")).toEqual({
      fileKey: "—",
      nodeId: "—",
    });
  });
});
