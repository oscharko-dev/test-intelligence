import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getWorkbenchRun,
  getWorkbenchRunCompletionForTests,
  resetWorkbenchRunStoreForTests,
  resultArtifactPaths,
  startWorkbenchRun,
} from "@/lib/server/workbench-run-registry";
import { SETTINGS_BASELINE } from "@/lib/settings-state";
import {
  prepareWorkbenchRun,
  WorkbenchRunValidationError,
} from "@/lib/server/workbench-run-validation";
import {
  importWorkbenchSettingsFromEnvPath,
  importWorkbenchSettingsFromEnvContent,
  readWorkbenchSettings,
} from "@/lib/server/workbench-settings-store";

const validFigmaUrl =
  "https://www.figma.com/design/9hKpQ2X0fileKey0/Onboarding?node-id=128-4421";

const baseRunBody = {
  figmaUrl: validFigmaUrl,
  customContext: "",
  outputDir: ".test-intelligence/server-test",
  outputRunSubdir: "job-id",
  visualSidecar: true,
  allowPolicyBlocked: false,
  caCerts: "",
  jobIdOverride: "ti-workbench-server-test",
};

const env = (
  values: Record<string, string | undefined>,
): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  ...(process.env.WORKBENCH_REPO_ROOT !== undefined
    ? { WORKBENCH_REPO_ROOT: process.env.WORKBENCH_REPO_ROOT }
    : {}),
  ...values,
});

async function tempWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "ti-workbench-"));
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetWorkbenchRunStoreForTests();
});

describe("prepareWorkbenchRun", () => {
  test("rejects non-Figma URLs before starting the runner", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    await expect(
      prepareWorkbenchRun({
        body: { ...baseRunBody, figmaUrl: "https://example.com/design/a" },
        env: env({ WORKBENCH_RUNNER_MODE: "mock" }),
        now: new Date("2026-05-25T10:15:30.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "RUN_CONFIG_INVALID",
      status: 400,
    });
  });

  test("rejects unsafe job IDs", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    await expect(
      prepareWorkbenchRun({
        body: { ...baseRunBody, jobIdOverride: "../escape" },
        env: env({ WORKBENCH_RUNNER_MODE: "mock" }),
        now: new Date("2026-05-25T10:15:30.000Z"),
      }),
    ).rejects.toBeInstanceOf(WorkbenchRunValidationError);
  });

  test("requires production env aliases outside mock mode", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    await expect(
      prepareWorkbenchRun({
        body: baseRunBody,
        env: env({}),
        now: new Date("2026-05-25T10:15:30.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "WORKBENCH_RUNNER_UNCONFIGURED",
      status: 503,
    });
  });

  test("hydrates a deterministic local ICT register ref when env omits it", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    const prepared = await prepareWorkbenchRun({
      body: baseRunBody,
      env: env({
        FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE: "1",
        WORKSPACE_TEST_SPACE_MODEL_ENDPOINT: "https://example.test/model",
        WORKSPACE_TEST_SPACE_LLM_API_KEY: "secret",
        FIGMA_ACCESS_TOKEN: "figma-secret",
        WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SIGNING_KEY: "signing-secret",
        WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT:
          "https://example.test/visual",
      }),
      now: new Date("2026-05-25T10:15:30.000Z"),
    });
    expect(prepared.env.ictRegisterRef).toBe("test-intelligence-local-ict");
  });

  test("accepts LLM API key from UI settings payload", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    const prepared = await prepareWorkbenchRun({
      body: {
        ...baseRunBody,
        settings: {
          TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY: "ui-gateway-key",
          TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN: "ui-figma-token",
          TEST_INTELLIGENCE_MODEL_ENDPOINT: "https://ui.test/model",
          TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT: "https://ui.test/visual",
          TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY: "ui-signing-key",
        },
      },
      env: env({}),
      now: new Date("2026-05-25T10:15:30.000Z"),
    });
    expect(prepared.env.apiKey).toBe("ui-gateway-key");
    expect(prepared.env.figmaToken).toBe("ui-figma-token");
    expect(prepared.env.endpoint).toBe("https://ui.test/model");
  });

  test("uses persisted Workbench settings when the run request has no settings payload", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    const runEnv = env({
      WORKBENCH_REPO_ROOT: repoRoot,
      FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE: "1",
    });
    await importWorkbenchSettingsFromEnvContent(
      [
        "TEST_INTELLIGENCE_MODEL_ENDPOINT=https://persisted.test/model",
        "TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT=https://persisted.test/visual",
        "TEST_INTELLIGENCE_LLM_API_KEY=persisted-key",
        "FIGMA_ACCESS_TOKEN=persisted-figma-token",
        "TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY=persisted-signing-key",
      ].join("\n"),
      runEnv,
    );

    const prepared = await prepareWorkbenchRun({
      body: baseRunBody,
      env: runEnv,
      now: new Date("2026-05-25T10:15:30.000Z"),
    });

    expect(prepared.env.endpoint).toBe("https://persisted.test/model");
    expect(prepared.env.visualEndpoint).toBe("https://persisted.test/visual");
    expect(prepared.env.apiKey).toBe("persisted-key");
    expect(prepared.env.figmaToken).toBe("persisted-figma-token");
  });

  test("imports .env aliases into canonical Workbench settings", async () => {
    const repoRoot = await tempWorkspace();
    const settingsEnv = env({ WORKBENCH_REPO_ROOT: repoRoot });
    await importWorkbenchSettingsFromEnvContent(
      [
        "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT=https://alias.test/model",
        "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT=https://alias.test/visual",
        "WORKSPACE_TEST_SPACE_LLM_API_KEY=alias-key",
        "FIGMA_ACCESS_TOKEN=alias-figma-token",
        "WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SIGNING_KEY=alias-signing-key",
        "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT=gpt-oss-120b-prod",
        "NODE_EXTRA_CA_CERTS=.test-intelligence/trust/cert.pem",
      ].join("\n"),
      settingsEnv,
    );

    const settings = await readWorkbenchSettings(settingsEnv);
    expect(settings.TEST_INTELLIGENCE_MODEL_ENDPOINT).toBe(
      "https://alias.test/model",
    );
    expect(settings.TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT).toBe(
      "https://alias.test/visual",
    );
    expect(settings.TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY).toBe("alias-key");
    expect(settings.TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN).toBe(
      "alias-figma-token",
    );
    expect(settings.TEST_INTELLIGENCE_TESTCASE_MODEL_DEPLOYMENT).toBe(
      "gpt-oss-120b-prod",
    );
    expect(settings.TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY).toBe(
      "alias-signing-key",
    );
    expect(settings.NODE_EXTRA_CA_CERTS).toBe(
      ".test-intelligence/trust/cert.pem",
    );
  });

  test("rejects uploaded .env content above the import size cap", async () => {
    const repoRoot = await tempWorkspace();
    await expect(
      importWorkbenchSettingsFromEnvContent(
        `TEST_INTELLIGENCE_MODEL_ENDPOINT=https://too-large.test/${"x".repeat(128 * 1024)}`,
        env({ WORKBENCH_REPO_ROOT: repoRoot }),
      ),
    ).rejects.toThrow(/too large/u);
  });

  test("imports settings from a local .env path", async () => {
    const repoRoot = await tempWorkspace();
    const envRelativePath = "customer.env";
    const envFile = path.join(repoRoot, envRelativePath);
    await writeFile(
      envFile,
      [
        "TEST_INTELLIGENCE_MODEL_ENDPOINT=https://path.test/model",
        "TEST_INTELLIGENCE_LLM_API_KEY=path-key",
        "TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN=path-figma-token",
        "TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY=path-signing-key",
      ].join("\n"),
      "utf8",
    );

    const settings = await importWorkbenchSettingsFromEnvPath(
      envRelativePath,
      env({ WORKBENCH_REPO_ROOT: repoRoot }),
    );

    expect(settings.TEST_INTELLIGENCE_MODEL_ENDPOINT).toBe(
      "https://path.test/model",
    );
    expect(settings.TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY).toBe("path-key");
    expect(settings.TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN).toBe(
      "path-figma-token",
    );
    expect(settings.TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY).toBe(
      "path-signing-key",
    );
  });

  test("rejects .env path import outside the Workbench workspace", async () => {
    const repoRoot = await tempWorkspace();
    await expect(
      importWorkbenchSettingsFromEnvPath(
        path.join(os.tmpdir(), "customer.env"),
        env({ WORKBENCH_REPO_ROOT: repoRoot }),
      ),
    ).rejects.toThrow(/relative to the Workbench workspace/u);
  });

  test("does not override env with unchanged baseline settings", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    const prepared = await prepareWorkbenchRun({
      body: {
        ...baseRunBody,
        settings: SETTINGS_BASELINE,
      },
      env: env({
        FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE: "1",
        TEST_INTELLIGENCE_MODEL_ENDPOINT: "https://env.test/model",
        TEST_INTELLIGENCE_LLM_API_KEY: "env-key",
        FIGMA_ACCESS_TOKEN: "env-figma-token",
        TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY: "env-signing-key",
      }),
      now: new Date("2026-05-25T10:15:30.000Z"),
    });
    expect(prepared.env.endpoint).toBe("https://env.test/model");
    expect(prepared.env.apiKey).toBe("env-key");
    expect(prepared.env.figmaToken).toBe("env-figma-token");
  });

  test("requires request settings to provide an API key when env is absent", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    await expect(
      prepareWorkbenchRun({
        body: {
          ...baseRunBody,
          settings: {
            TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN: "ui-figma-token",
            TEST_INTELLIGENCE_MODEL_ENDPOINT: "https://ui.test/model",
            TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT: "https://ui.test/visual",
            TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY: "ui-signing-key",
          },
        },
        env: env({
          FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE: "1",
        }),
        now: new Date("2026-05-25T10:15:30.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "WORKBENCH_RUNNER_UNCONFIGURED",
      status: 503,
    });
  });

  test("accepts a per-run CA bundle path without requiring process-level NODE_EXTRA_CA_CERTS", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    const caPath = path.join(repoRoot, "corp-ca.pem");
    const caRelativePath = "corp-ca.pem";
    await writeFile(
      caPath,
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
      "utf8",
    );

    const prepared = await prepareWorkbenchRun({
      body: {
        ...baseRunBody,
        caCerts: caRelativePath,
      },
      env: env({
        FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE: "1",
        TEST_INTELLIGENCE_MODEL_ENDPOINT: "https://env.test/model",
        TEST_INTELLIGENCE_LLM_API_KEY: "env-key",
        FIGMA_ACCESS_TOKEN: "env-figma-token",
        TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY: "env-signing-key",
      }),
      now: new Date("2026-05-25T10:15:30.000Z"),
    });

    expect(prepared.caCertPath).toBe(caPath);
  });

  test("accepts a persisted CA bundle path when the run request leaves the field empty", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    const caPath = path.join(repoRoot, "corp-ca.pem");
    const caRelativePath = "corp-ca.pem";
    await writeFile(
      caPath,
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
      "utf8",
    );

    const prepared = await prepareWorkbenchRun({
      body: {
        ...baseRunBody,
        settings: {
          NODE_EXTRA_CA_CERTS: caRelativePath,
        },
      },
      env: env({
        FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE: "1",
        TEST_INTELLIGENCE_MODEL_ENDPOINT: "https://env.test/model",
        TEST_INTELLIGENCE_LLM_API_KEY: "env-key",
        FIGMA_ACCESS_TOKEN: "env-figma-token",
        TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY: "env-signing-key",
      }),
      now: new Date("2026-05-25T10:15:30.000Z"),
    });

    expect(prepared.caCertPath).toBe(caPath);
  });

  test("rejects a per-run CA bundle path that does not point to a file", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    await expect(
      prepareWorkbenchRun({
        body: {
          ...baseRunBody,
          caCerts: path.join(repoRoot, "missing-ca.pem"),
        },
        env: env({
          FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE: "1",
          TEST_INTELLIGENCE_MODEL_ENDPOINT: "https://env.test/model",
          TEST_INTELLIGENCE_LLM_API_KEY: "env-key",
          FIGMA_ACCESS_TOKEN: "env-figma-token",
          TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY: "env-signing-key",
        }),
        now: new Date("2026-05-25T10:15:30.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "RUN_CONFIG_INVALID",
      status: 400,
    });
  });

  test("rejects an absolute per-run CA bundle path", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    await expect(
      prepareWorkbenchRun({
        body: {
          ...baseRunBody,
          caCerts: path.join(repoRoot, "corp-ca.pem"),
        },
        env: env({
          FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE: "1",
          TEST_INTELLIGENCE_MODEL_ENDPOINT: "https://env.test/model",
          TEST_INTELLIGENCE_LLM_API_KEY: "env-key",
          FIGMA_ACCESS_TOKEN: "env-figma-token",
          TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY: "env-signing-key",
        }),
        now: new Date("2026-05-25T10:15:30.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "RUN_CONFIG_INVALID",
      status: 400,
    });
  });

  test("accepts custom context only inside the workspace", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    await mkdir(path.join(repoRoot, "test-case", "case-a"), {
      recursive: true,
    });
    await writeFile(
      path.join(repoRoot, "test-case", "case-a", "JIRA_STORY.md"),
      "# Story\n",
      "utf8",
    );
    const prepared = await prepareWorkbenchRun({
      body: {
        ...baseRunBody,
        customContext: "test-case/case-a/JIRA_STORY.md",
      },
      env: env({ WORKBENCH_RUNNER_MODE: "mock" }),
      now: new Date("2026-05-25T10:15:30.000Z"),
    });
    expect(prepared.customContextMarkdown).toContain("# Story");
  });

  test("mock runner tolerates missing local custom context fixtures", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    const prepared = await prepareWorkbenchRun({
      body: {
        ...baseRunBody,
        customContext: "test-case/local-only/JIRA_STORY.md",
      },
      env: env({ WORKBENCH_RUNNER_MODE: "mock" }),
      now: new Date("2026-05-25T10:15:30.000Z"),
    });
    expect(prepared.customContextMarkdown).toBeUndefined();
  });

  test("requires output paths under the workspace or allowlist", async () => {
    const repoRoot = await tempWorkspace();
    const allowedRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    const prepared = await prepareWorkbenchRun({
      body: { ...baseRunBody, outputDir: allowedRoot },
      env: env({
        WORKBENCH_RUNNER_MODE: "mock",
        WORKBENCH_OUTPUT_ROOTS: allowedRoot,
      }),
      now: new Date("2026-05-25T10:15:30.000Z"),
    });
    expect(prepared.outputRoot).toBe(allowedRoot);
  });
});

describe("workbench run registry", () => {
  test("run artifact collection excludes the global FinOps time-series store", () => {
    const artifactDir = path.join(os.tmpdir(), "ti-workbench-artifacts", "job");
    const outputRoot = path.dirname(artifactDir);
    const paths = resultArtifactPaths({
      artifactDir,
      artifactPaths: {
        intent: path.join(artifactDir, "business-intent-ir.json"),
        compiledPrompt: path.join(artifactDir, "compiled-prompt.json"),
        coveragePlan: path.join(artifactDir, "coverage-plan.json"),
        workflowTopology: path.join(artifactDir, "workflow-topology.json"),
        riskRanking: path.join(artifactDir, "risk-ranking.json"),
        untrustedContentNormalizationReport: path.join(
          artifactDir,
          "untrusted-content-normalization-report.json",
        ),
        evidenceSeal: path.join(
          artifactDir,
          "production-runner-evidence-seal.json",
        ),
        agentParticipation: path.join(artifactDir, "agent-participation.json"),
        agentRoleRun: path.join(
          artifactDir,
          "agent-role-runs",
          "test_generation.json",
        ),
        judgeConsensus: path.join(artifactDir, "judge-consensus.json"),
        runQuality: path.join(artifactDir, "run-quality.json"),
        genealogy: path.join(artifactDir, "genealogy.json"),
        provenance: path.join(artifactDir, "provenance.jsonld"),
        generatedTestCases: path.join(artifactDir, "generated-testcases.json"),
        validationReport: path.join(artifactDir, "validation-report.json"),
        policyReport: path.join(artifactDir, "policy-report.json"),
        coverageReport: path.join(artifactDir, "coverage-report.json"),
        finopsReport: path.join(artifactDir, "finops", "budget-report.json"),
        finopsTimeSeriesStore: path.join(
          outputRoot,
          "test-intelligence",
          "finops",
          "time-series.json",
        ),
      },
      customerMarkdownPaths: {
        combined: path.join(artifactDir, "customer-markdown", "testfaelle.md"),
        perCase: [
          path.join(artifactDir, "customer-markdown", "tc01-happy-path.md"),
        ],
        pdf: path.join(artifactDir, "customer-markdown", "testfaelle.pdf"),
      },
    } as unknown as Parameters<typeof resultArtifactPaths>[0]);

    expect(paths).not.toContain(
      path.join(outputRoot, "test-intelligence", "finops", "time-series.json"),
    );
    expect(paths).toContain(
      path.join(artifactDir, "customer-markdown", "testfaelle.pdf"),
    );
  });

  test("mock runner returns real customer Markdown artifacts", async () => {
    const repoRoot = await tempWorkspace();
    vi.stubEnv("WORKBENCH_REPO_ROOT", repoRoot);
    vi.stubEnv("WORKBENCH_RUNNER_MODE", "mock");
    const prepared = await prepareWorkbenchRun({
      body: baseRunBody,
      env: env({ WORKBENCH_RUNNER_MODE: "mock" }),
      now: new Date("2026-05-25T10:15:30.000Z"),
    });

    const initial = startWorkbenchRun(prepared);
    expect(initial.status).toBe("queued");
    await getWorkbenchRunCompletionForTests(prepared.jobId);

    const run = getWorkbenchRun(prepared.jobId);
    expect(run?.status).toBe("sealed");
    expect(run?.customerMarkdown?.[0]?.path).toBe(
      "customer-markdown/testfaelle.md",
    );
    const combined = run?.customerMarkdown?.[0];
    expect(combined).toBeDefined();
    if (run?.artifactDir === undefined || combined === undefined) {
      throw new Error("expected run artifactDir and customer markdown");
    }
    const info = await stat(path.join(run.artifactDir, combined.path));
    expect(info.isFile()).toBe(true);
  });
});
