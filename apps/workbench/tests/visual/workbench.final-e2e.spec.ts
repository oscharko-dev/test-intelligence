import { expect, test, type Page } from "@playwright/test";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

interface CaseFixture {
  caseId: string;
  figmaUrl: string;
  customContext: string;
  outputDir: string;
}

interface CaseRunSummary {
  caseId: string;
  jobId: string;
  status: string;
  artifactDir: string;
  screenshotPath: string;
  summaryPath: string;
  errorMessage?: string;
}

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const resultRoot = path.join(repoRoot, ".test-intelligence", "final-e2e");
const summaryDir = path.join(resultRoot, "summaries");
const screenshotDir = path.join(resultRoot, "screenshots");
const summaryFile = path.join(resultRoot, "summary.json");
const casesRoot = path.join(repoRoot, "test-case");

const terminalStatuses = ["sealed", "blocked", "failed"] as const;

async function readFixture(caseId: string): Promise<CaseFixture> {
  const figmaUrl = (
    await readFile(path.join(casesRoot, caseId, "FIGMA_LINK.md"), "utf8")
  ).trim();
  return {
    caseId,
    figmaUrl,
    customContext: `test-case/${caseId}/JIRA_STORY.md`,
    outputDir: `.test-intelligence/final-e2e/runs/${caseId}`,
  };
}

async function listFixtures(): Promise<CaseFixture[]> {
  const entries = await readdir(casesRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(dirs.map(readFixture));
}

async function ensureResultDirs(): Promise<void> {
  await mkdir(summaryDir, { recursive: true });
  await mkdir(screenshotDir, { recursive: true });
}

async function resetResultRoot(): Promise<void> {
  await rm(resultRoot, { recursive: true, force: true });
  await ensureResultDirs();
}

async function removeOutputRoot(outputDir: string): Promise<void> {
  await rm(path.join(repoRoot, outputDir), { recursive: true, force: true });
}

async function launchRun(
  page: Page,
  fixture: CaseFixture,
): Promise<{
  artifactDir: string;
  errorMessage?: string;
  jobId: string;
  status: string;
}> {
  const jobId = `ti-e2e-${fixture.caseId}-${Date.now()}`;
  await page.goto("/runs");
  await expect(
    page.getByRole("heading", { name: "Configure run" }),
  ).toBeVisible();

  await page.getByLabel("Figma URL").fill(fixture.figmaUrl);
  await page.getByLabel("Custom context markdown").fill(fixture.customContext);
  await page.getByLabel("Output directory").fill(fixture.outputDir);
  await page.getByRole("button", { name: "Advanced" }).click();
  await page.getByLabel("Job ID override").fill(jobId);

  const startResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      response.url().includes("/api/workbench/runs")
    );
  });
  await page.getByRole("button", { name: "Launch run" }).click();
  const startResponse = await startResponsePromise;
  expect(startResponse.ok(), `run start failed for ${fixture.caseId}`).toBe(
    true,
  );

  await expect(page.getByRole("heading", { name: "Run detail" })).toBeVisible({
    timeout: 30_000,
  });

  await expect
    .poll(
      async () => {
        const text = await page.locator(".rd-header").innerText();
        const status = terminalStatuses.find((candidate) =>
          text.toLowerCase().includes(candidate),
        );
        return status ?? "pending";
      },
      {
        timeout: 8 * 60_000,
        intervals: [1_000, 2_000, 5_000],
        message: `waiting for terminal run status for ${fixture.caseId}`,
      },
    )
    .toMatch(/sealed|blocked|failed/);

  const headerText = await page.locator(".rd-header").innerText();
  const status =
    terminalStatuses.find((candidate) =>
      headerText.toLowerCase().includes(candidate),
    ) ?? "unknown";

  const artifactRootPanel = page.getByText("Filesystem root for this run.", {
    exact: false,
  });
  await expect(artifactRootPanel).toBeVisible();
  const artifactDirText = await artifactRootPanel.locator("..").innerText();
  const artifactDir =
    artifactDirText
      .split("\n")
      .map((line) => line.trim())
      .find(
        (line) => line.startsWith("/") && !line.startsWith("outputRoot "),
      ) ?? "";

  const errorPanel = page.getByText("Run error");
  const errorMessage = (await errorPanel.count())
    ? await errorPanel.locator("..").innerText()
    : undefined;

  return {
    jobId,
    status,
    artifactDir: artifactDir.trim(),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}

test("runs all configured local end-to-end cases via the workbench UI", async ({
  page,
}) => {
  test.setTimeout(30 * 60_000);
  await resetResultRoot();
  const fixtures = await listFixtures();
  const summaries: CaseRunSummary[] = [];

  for (const fixture of fixtures) {
    await removeOutputRoot(fixture.outputDir);
    const result = await launchRun(page, fixture);
    const screenshotPath = path.join(screenshotDir, `${fixture.caseId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const summaryPath = path.join(summaryDir, `${fixture.caseId}.json`);
    const payload: CaseRunSummary = {
      caseId: fixture.caseId,
      jobId: result.jobId,
      status: result.status,
      artifactDir: result.artifactDir,
      screenshotPath,
      summaryPath,
      ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    };
    await writeFile(summaryPath, JSON.stringify(payload, null, 2));
    summaries.push(payload);

    const runRoot = path.join(repoRoot, fixture.outputDir);
    const runRootExists = await stat(runRoot)
      .then((info) => info.isDirectory())
      .catch(() => false);
    expect(runRootExists, `missing output root for ${fixture.caseId}`).toBe(
      true,
    );
    expect(
      result.status,
      `run did not finish sealed for ${fixture.caseId}${result.errorMessage ? `: ${result.errorMessage}` : ""}`,
    ).toBe("sealed");

    await page.getByRole("button", { name: "New run" }).click();
    await expect(
      page.getByRole("heading", { name: "Configure run" }),
    ).toBeVisible();
  }

  await writeFile(summaryFile, JSON.stringify(summaries, null, 2));
});
