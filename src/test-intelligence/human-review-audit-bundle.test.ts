import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HUMAN_REVIEW_LOG_ARTIFACT_FILENAME,
  HUMAN_REVIEW_LOG_SCHEMA_VERSION,
  HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type HumanReviewLog,
} from "@oscharko-dev/ti-contracts";
import { canonicalJson } from "@oscharko-dev/ti-security";
import { generateAuditDossier } from "@oscharko-dev/ti-cli";
import { verifyAuditDossierBundle } from "@oscharko-dev/ti-evidence";
import { computeHumanReviewItemId } from "@oscharko-dev/ti-review";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const acceptedRunDir = path.join(
  repoRoot,
  "fixtures",
  "test-intelligence",
  "audit-dossiers",
  "accepted-run",
);

/**
 * Write an ephemeral Ed25519 signing key into the supplied directory and
 * return its path. No private key is committed to the repository; each
 * test mints a fresh keypair at runtime. The audit dossier embeds the
 * derived public key in the signed manifest, so a bundle signed with the
 * ephemeral key still verifies end-to-end.
 */
const writeEphemeralSigningKey = async (dir: string): Promise<string> => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const keyPath = path.join(dir, "operator-ed25519.private-key.pem");
  await writeFile(
    keyPath,
    privateKey.export({ format: "pem", type: "pkcs8" }) as string,
    "utf8",
  );
  return keyPath;
};

const fixedMetadata = {
  gitSha: "fixture-git-sha-2179",
  benchmarkProtocolVersion:
    "test-intelligence-local-benchmark-protocol@fixture",
  harnessVersion: "1.0.0-fixture",
  ictRegisterRef: "ict://tier1/eu-banking-default/2026-05-10",
} as const;

const buildLog = (jobId: string): HumanReviewLog => ({
  schemaVersion: HUMAN_REVIEW_LOG_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId,
  tenantId: "acme",
  generatedAt: "2026-05-10T11:00:00.000Z",
  items: [
    {
      schemaVersion: HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      itemId: computeHumanReviewItemId({
        tenantId: "acme",
        runId: jobId,
        testCaseId: "tc-1",
      }),
      tenantId: "acme",
      profileId: "default",
      runId: jobId,
      testCaseId: "tc-1",
      judgeDisagreement: {
        decision: "split_decision",
        escalation: "human_review_required",
        disagreementRate: 0.5,
        judges: [],
      },
      proposedDecision: "needs_review",
      enqueuedAt: "2026-05-10T09:00:00.000Z",
      slaDeadlineAt: "2026-05-11T09:00:00.000Z",
    },
  ],
  verdicts: [],
  slaBreaches: [],
});

void test("audit-dossier bundles human-review-log when present in run dir", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ti-hrl-bundle-"));
  try {
    const stagedRun = path.join(tempDir, "run");
    await cp(acceptedRunDir, stagedRun, { recursive: true });
    const logPath = path.join(stagedRun, HUMAN_REVIEW_LOG_ARTIFACT_FILENAME);
    const log = buildLog("ti-cli-1778405189341");
    await writeFile(logPath, canonicalJson(log), "utf8");

    const outDir = path.join(tempDir, "out");
    const result = await generateAuditDossier({
      runDir: stagedRun,
      outputDir: outDir,
      signKeyPath: await writeEphemeralSigningKey(tempDir),
      ...fixedMetadata,
    });

    const humanReviewArtifact = result.manifest.sourceArtifacts.find(
      (a) => a.kind === "human_review_log",
    );
    assert.ok(
      humanReviewArtifact,
      "human_review_log must be in sourceArtifacts",
    );
    assert.equal(
      humanReviewArtifact!.filename,
      HUMAN_REVIEW_LOG_ARTIFACT_FILENAME,
    );
    assert.ok(humanReviewArtifact!.bytes > 0);
    assert.equal(humanReviewArtifact!.sha256.length, 64);

    const dsgvoRow = result.manifest.regulatorCoverage.find(
      (row) => row.regulation === "DSGVO Art. 22",
    );
    assert.ok(dsgvoRow, "DSGVO Art. 22 coverage row must be present");
    assert.ok(
      dsgvoRow!.artifactKinds.includes("human_review_log"),
      "DSGVO Art. 22 row must reference human_review_log",
    );

    const verification = await verifyAuditDossierBundle(result.manifestPath);
    assert.equal(verification.ok, true, JSON.stringify(verification.failures));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

void test("audit-dossier still verifies when human-review-log is absent (additive)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ti-hrl-bundle-"));
  try {
    const stagedRun = path.join(tempDir, "run");
    await cp(acceptedRunDir, stagedRun, { recursive: true });
    const outDir = path.join(tempDir, "out");

    const result = await generateAuditDossier({
      runDir: stagedRun,
      outputDir: outDir,
      signKeyPath: await writeEphemeralSigningKey(tempDir),
      ...fixedMetadata,
    });
    const verification = await verifyAuditDossierBundle(result.manifestPath);
    assert.equal(verification.ok, true, JSON.stringify(verification.failures));
    const hasHumanReview = result.manifest.sourceArtifacts.some(
      (a) => a.kind === "human_review_log",
    );
    assert.equal(
      hasHumanReview,
      false,
      "human_review_log must not appear when the run dir has no log",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
