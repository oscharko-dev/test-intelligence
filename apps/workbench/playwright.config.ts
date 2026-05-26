import { defineConfig } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const baseURL = process.env.WORKBENCH_BASE_URL ?? "http://127.0.0.1:1983";
const webServer =
  process.env.WORKBENCH_BASE_URL === undefined
    ? {
        webServer: {
          command: "pnpm start",
          env: {
            WORKBENCH_FIXED_NOW: "2026-05-25T10:15:30.000Z",
            WORKBENCH_RUNNER_MODE: "mock",
          },
          reuseExistingServer: false,
          timeout: 120_000,
          url: `${baseURL}/runs`,
        },
      }
    : {};

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI ? [["github"], ["list"]] : "list",
  outputDir: "test-results/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.03,
      threshold: 0.2,
    },
  },
  use: {
    baseURL,
    browserName: "chromium",
    colorScheme: "dark",
    deviceScaleFactor: 1,
    headless: true,
    locale: "en-US",
    screenshot: "only-on-failure",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    video: "off",
    viewport: { width: 1440, height: 900 },
  },
  ...webServer,
});
