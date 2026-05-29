import assert from "node:assert/strict";
import test from "node:test";

import type { FigmaSnapshotSourceIdentifier } from "@oscharko-dev/ti-contracts";

import {
  FigmaImportGovernanceError,
  classifyFigmaRateLimitRemediation,
  createFigmaImportGovernance,
  resolveFigmaImportCredential,
} from "./figma-import-governance.js";

const SOURCE: FigmaSnapshotSourceIdentifier = {
  fileKeyHash: "a".repeat(64),
  sourceUrlHash: "b".repeat(64),
};

const ACCESS_TOKEN = "figd_governance_test_token_1234567890_padded";

void test("figma import credential resolver records only safe mode metadata", () => {
  const credential = resolveFigmaImportCredential({
    authMode: "enterprise_service_token",
    accessToken: ACCESS_TOKEN,
  });

  assert.equal(credential.authMode, "enterprise_service_token");
  assert.equal(credential.accessToken, ACCESS_TOKEN);
  assert.equal(credential.metadata.authMode, "enterprise_service_token");
  assert.equal("tokenHash" in credential.metadata, false);
});

void test("figma import credential resolver fails closed with deterministic classes", () => {
  assert.throws(
    () => resolveFigmaImportCredential({ accessToken: "" }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaImportGovernanceError);
      assert.equal(err.errorCode, "missing_credential");
      return true;
    },
  );
  assert.throws(
    () =>
      resolveFigmaImportCredential({
        accessToken: `Authorization: Bearer ${ACCESS_TOKEN}`,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaImportGovernanceError);
      assert.equal(err.errorCode, "invalid_credential");
      assert.doesNotMatch(err.message, /figd_governance/u);
      assert.doesNotMatch(err.message, /Authorization/u);
      return true;
    },
  );
  assert.throws(
    () =>
      resolveFigmaImportCredential({
        authMode: "oauth_access_token",
        accessToken: ACCESS_TOKEN,
      }),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaImportGovernanceError);
      assert.equal(err.errorCode, "unsupported_auth_mode");
      return true;
    },
  );
});

void test("figma import governor enforces resource budgets before REST fan-out", async () => {
  const credential = resolveFigmaImportCredential({
    accessToken: ACCESS_TOKEN,
  });
  const governor = createFigmaImportGovernance({
    credential,
    source: SOURCE,
    policy: {
      maxRequestsPerWindow: 10,
      resourceMaxRequestsPerWindow: {
        node_batch: 1,
        image_metadata: 2,
      },
    },
    windowStartedAt: new Date("2026-05-29T10:00:00.000Z"),
  });

  const nodeBudget = await governor.beforeRequest("node_batch");
  assert.equal(nodeBudget.usedRequests, 1);
  assert.equal(nodeBudget.remainingRequests, 0);
  await assert.rejects(
    () => governor.beforeRequest("node_batch"),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaImportGovernanceError);
      assert.equal(err.errorCode, "budget_exhausted");
      assert.equal(err.budget?.resourceType, "node_batch");
      return true;
    },
  );
  const imageBudget = await governor.beforeRequest("image_metadata");
  assert.equal(imageBudget.resourceType, "image_metadata");
  assert.equal(imageBudget.remainingRequests, 1);
  assert.equal("tokenResourceKeyHash" in nodeBudget, false);
  assert.equal("tokenResourceKeyHash" in imageBudget, false);

  const sameTokenGovernor = createFigmaImportGovernance({
    credential,
    source: SOURCE,
    policy: {
      maxRequestsPerWindow: 10,
      resourceMaxRequestsPerWindow: {
        node_batch: 1,
      },
    },
    windowStartedAt: new Date("2026-05-29T10:00:00.000Z"),
  });
  await assert.rejects(
    () => sameTokenGovernor.beforeRequest("node_batch"),
    (err: unknown): boolean => {
      assert.ok(err instanceof FigmaImportGovernanceError);
      assert.equal(err.errorCode, "budget_exhausted");
      assert.equal(err.budget?.resourceType, "node_batch");
      return true;
    },
  );

  const otherCredential = resolveFigmaImportCredential({
    accessToken: `${ACCESS_TOKEN}_other`,
  });
  const otherGovernor = createFigmaImportGovernance({
    credential: otherCredential,
    source: SOURCE,
    policy: {
      resourceMaxRequestsPerWindow: {
        node_batch: 1,
      },
    },
  });
  const otherBudget = await otherGovernor.beforeRequest("node_batch");
  assert.equal(otherBudget.usedRequests, 1);
  assert.equal(otherBudget.remainingRequests, 0);
});

void test("figma rate-limit remediation separates low-limit and enterprise throttling", () => {
  const lowLimit = classifyFigmaRateLimitRemediation({
    retryAfterSeconds: 90,
    figmaPlanTier: "starter",
    figmaRateLimitType: "low_limit",
  });
  const highLimit = classifyFigmaRateLimitRemediation({
    retryAfterSeconds: 2,
    figmaPlanTier: "enterprise",
    figmaRateLimitType: "file_content",
  });

  assert.equal(lowLimit.scenario, "low_limit");
  assert.match(lowLimit.guidance, /enterprise-governed credential/u);
  assert.equal(highLimit.scenario, "high_limit");
  assert.match(highLimit.guidance, /Stagger imports/u);
  assert.notEqual(lowLimit.guidance, highLimit.guidance);
  assert.doesNotMatch(JSON.stringify([lowLimit, highLimit]), /https?:\/\//u);
  assert.doesNotMatch(JSON.stringify([lowLimit, highLimit]), /figd_/u);
});
