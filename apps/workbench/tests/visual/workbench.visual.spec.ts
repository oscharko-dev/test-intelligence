import { expect, test, type Page } from "@playwright/test";
import type { Settings } from "@/lib/settings-state";

const FIXED_NOW = "2026-05-25T10:15:30.000Z";
const VISUAL_TEST_SETTINGS: Settings = {
  TEST_INTELLIGENCE_LLM_GATEWAY_ENDPOINT:
    "https://visual-test-gateway.example.test/openai",
  TEST_INTELLIGENCE_LLM_GATEWAY_API_VERSION: "2024-10-01-preview",
  TEST_INTELLIGENCE_LLM_GATEWAY_API_KEY: "visual-test-api-key",
  TEST_INTELLIGENCE_FIGMA_ACCESS_TOKEN: "visual-test-figma-token",
  TEST_INTELLIGENCE_MODEL_ENDPOINT:
    "https://visual-test-foundry.example.test/openai",
  TEST_INTELLIGENCE_VISUAL_MODEL_ENDPOINT:
    "https://visual-test-vision.example.test/openai",
  TEST_INTELLIGENCE_TESTCASE_MODEL_DEPLOYMENT: "gpt-oss-120b",
  TEST_INTELLIGENCE_LOGIC_JUDGE_DEPLOYMENT: "gpt-oss-120b",
  TEST_INTELLIGENCE_VISUAL_PRIMARY_DEPLOYMENT: "llama-4-maverick-vision",
  TEST_INTELLIGENCE_VISUAL_FALLBACK_DEPLOYMENT: "phi-4-multimodal-instruct",
  TEST_INTELLIGENCE_REGION_ATTESTED_REGION: "eu-north-1",
  TEST_INTELLIGENCE_REGION_ATTESTATION_SOVEREIGN_SOURCE: true,
  TEST_INTELLIGENCE_REGION_ATTESTATION_SIGNING_KEY:
    "visual-test-region-signing-key",
  TEST_INTELLIGENCE_ALLOW_POLICY_BLOCKED: false,
  NODE_EXTRA_CA_CERTS: "",
};

async function preparePage(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      {
        const fixed = new Date("${FIXED_NOW}").valueOf();
        const NativeDate = Date;
        class FixedDate extends NativeDate {
          constructor(...args) {
            super(args.length === 0 ? fixed : args[0]);
          }
          static now() {
            return fixed;
          }
        }
        Object.setPrototypeOf(FixedDate, NativeDate);
        window.Date = FixedDate;
      }
    `,
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
}

async function openWorkbench(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.getByRole("banner").waitFor();
  await page.locator(".statusbar").waitFor();
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        caret-color: transparent !important;
      }
      .tip::after {
        display: none !important;
      }
    `,
  });
}

async function mockWorkbenchSettings(page: Page, settings: Settings): Promise<void> {
  await page.route("**/api/workbench/settings", async (route, request) => {
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ settings }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test("captures the run draft screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkbench(page, "/runs");

  await expect(
    page.getByRole("heading", { name: "Configure run" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workbench-runs-draft.png");
});

test("captures a completed run detail screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockWorkbenchSettings(page, VISUAL_TEST_SETTINGS);
  await openWorkbench(page, "/runs");

  await page.getByRole("button", { name: "Seed demo" }).click();
  await page.getByRole("button", { name: "Advanced" }).click();
  await page.getByLabel("Job ID override").fill("ti-workbench-visual-fixed");
  await expect(page.getByRole("button", { name: "Launch run" })).toBeEnabled();
  const started = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      response.url().includes("/api/workbench/runs")
    );
  });
  await page.getByRole("button", { name: "Launch run" }).click();
  const startResponse = await started;
  expect(
    startResponse.ok(),
    `Expected run start to succeed, got HTTP ${startResponse.status()}`,
  ).toBe(true);

  await expect(page.getByRole("heading", { name: "Run detail" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".rd-header")).toContainText(
    "ti-workbench-visual-fixed",
  );
  await expect(page.locator(".rd-header")).toContainText(
    "generatedAt 2026-05-25 10:15:30Z",
  );
  await expect(page.locator(".statusbar")).toContainText("sealed");
  await expect(page).toHaveScreenshot("workbench-run-detail-sealed.png");
});

test("captures model gateway settings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openWorkbench(page, "/settings/model");

  await expect(
    page.getByRole("heading", { name: "Model gateway settings" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workbench-model-settings.png");
});

test("captures run history with the detail drawer state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openWorkbench(page, "/runs/history");

  await page.getByText("ti-workbench-1764950400123").click();
  await expect(
    page.getByText("Detail · ti-workbench-1764950400123"),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workbench-history-detail.png");
});
