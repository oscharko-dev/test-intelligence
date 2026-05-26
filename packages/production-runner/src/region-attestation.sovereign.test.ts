import assert from "node:assert/strict";
import test from "node:test";

import { AIR_GAP_MODE_ENV } from "./air-gap-guard.js";
import {
  buildArtifactRegionAttestations,
  REGION_ATTESTATION_PINNED_REGION_ENV,
  REGION_ATTESTATION_SIGNING_KEY_ENV,
  REGION_ATTESTATION_SOVEREIGN_SOURCE_ENV,
  resolveRegionAttestationObservation,
} from "./region-attestation.js";

const withEnv = async <T>(
  patch: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> => {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    prior[key] = process.env[key];
    const value = patch[key];
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(prior)) {
      const value = prior[key];
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  }
};

const failingFetch: typeof fetch = async () => {
  throw new Error(
    "network must not be touched under sovereign-cloud attestation",
  );
};

void test("sovereign-cloud attestation short-circuits IMDS when the env flag is on", async () => {
  await withEnv(
    {
      [REGION_ATTESTATION_SOVEREIGN_SOURCE_ENV]: "1",
      [REGION_ATTESTATION_PINNED_REGION_ENV]: "eu-de-1",
      [AIR_GAP_MODE_ENV]: undefined,
    },
    async () => {
      const observation = await resolveRegionAttestationObservation({
        sourceLabel: "hook:test",
        deploymentId: "stackit-gpt-oss-120b",
        endpointReference: "https://sovereign.local/v1",
        observedAtUtc: "2026-05-11T10:00:00.000Z",
        fetchImpl: failingFetch,
      });
      assert.equal(observation.attestedBy, "sovereign-cloud");
      assert.equal(observation.servedFromRegion, "eu-de-1");
      assert.equal(observation.severity, undefined);
    },
  );
});

void test("sovereign-cloud attestation accepts workspace env aliases used by the Workbench", async () => {
  await withEnv(
    {
      [REGION_ATTESTATION_SOVEREIGN_SOURCE_ENV]: undefined,
      [REGION_ATTESTATION_PINNED_REGION_ENV]: undefined,
      [REGION_ATTESTATION_SIGNING_KEY_ENV]: undefined,
      WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SOVEREIGN_SOURCE: "1",
      WORKSPACE_TEST_SPACE_REGION_ATTESTED_REGION: "eu-north-1",
      WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SIGNING_KEY:
        "workspace-region-attestation-key",
      [AIR_GAP_MODE_ENV]: undefined,
    },
    async () => {
      const observation = await resolveRegionAttestationObservation({
        sourceLabel: "hook:test",
        deploymentId: "gpt-oss-120b",
        endpointReference: "https://workspace.example.com/openai/v1",
        observedAtUtc: "2026-05-11T10:00:00.000Z",
        fetchImpl: failingFetch,
      });
      assert.equal(observation.attestedBy, "sovereign-cloud");
      assert.equal(observation.servedFromRegion, "eu-north-1");

      const [attestation] = buildArtifactRegionAttestations({
        artifactHash: "a".repeat(64),
        observations: [observation],
      });
      assert.match(
        attestation?.attestationSignatureHex ?? "",
        /^[a-f0-9]{64}$/u,
      );
    },
  );
});

void test("strict air-gap mode implies sovereign-cloud attestation source", async () => {
  await withEnv(
    {
      [REGION_ATTESTATION_SOVEREIGN_SOURCE_ENV]: undefined,
      [AIR_GAP_MODE_ENV]: "1",
      [REGION_ATTESTATION_PINNED_REGION_ENV]: "switzerland-north",
    },
    async () => {
      const observation = await resolveRegionAttestationObservation({
        sourceLabel: "hook:test",
        deploymentId: "ovh-mistral-large-onprem",
        endpointReference: "https://ovh.local/v1",
        observedAtUtc: "2026-05-11T10:00:00.000Z",
        fetchImpl: failingFetch,
      });
      assert.equal(observation.attestedBy, "sovereign-cloud");
      assert.equal(observation.servedFromRegion, "switzerland-north");
    },
  );
});

void test("sovereign-cloud attestation refuses to fall through without a pinned region", async () => {
  await withEnv(
    {
      [REGION_ATTESTATION_SOVEREIGN_SOURCE_ENV]: "1",
      [REGION_ATTESTATION_PINNED_REGION_ENV]: undefined,
      [AIR_GAP_MODE_ENV]: undefined,
    },
    async () => {
      await assert.rejects(
        resolveRegionAttestationObservation({
          sourceLabel: "hook:test",
          deploymentId: "stackit-gpt-oss-120b",
          endpointReference: "https://sovereign.local/v1",
          observedAtUtc: "2026-05-11T10:00:00.000Z",
          fetchImpl: failingFetch,
        }),
        /Sovereign-cloud attestation enabled/u,
      );
    },
  );
});

void test("legacy resolver path is preserved when sovereign-cloud is off", async () => {
  await withEnv(
    {
      [REGION_ATTESTATION_SOVEREIGN_SOURCE_ENV]: undefined,
      [AIR_GAP_MODE_ENV]: undefined,
      [REGION_ATTESTATION_PINNED_REGION_ENV]: "eu-west-1",
    },
    async () => {
      // IMDS fetch fails fast (network errors are silently swallowed), TLS
      // cert lookup falls through, and the resolver lands on the
      // operator-pinned warning fallback — that is the *pre-existing*
      // behaviour and this test pins it so the sovereign-cloud short-
      // circuit cannot accidentally promote operator-pinned runs.
      const observation = await resolveRegionAttestationObservation({
        sourceLabel: "hook:test",
        deploymentId: "azure-gpt-4o",
        endpointReference: "https://azure-eu-west-1.example.com/v1",
        observedAtUtc: "2026-05-11T10:00:00.000Z",
        // Provide a fetchImpl that returns 404 so the IMDS path returns
        // undefined without throwing.
        fetchImpl: (async () =>
          new Response("not found", { status: 404 })) as typeof fetch,
      });
      // The TLS-cert resolver inspects the hostname text; "eu-west-1" is
      // present in the test endpoint reference, so the resolver picks it
      // up via the hostname path rather than the pinned fallback.
      assert.notEqual(observation.attestedBy, "sovereign-cloud");
    },
  );
});
