import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  TEST_INTELLIGENCE_ENV,
  TEST_INTELLIGENCE_MULTISOURCE_ENV,
} from "@oscharko-dev/ti-contracts";
import {
  API_ROUTE_PREFIX,
  DEFAULT_CONTENT_SECURITY_POLICY,
  DEFAULT_HOST,
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_PORT,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_STRICT_TRANSPORT_SECURITY,
  ENABLE_HSTS_ENV,
  MAX_REQUEST_BODY_BYTES,
  MAX_SUBMIT_BODY_BYTES,
  RATE_LIMIT_WINDOW_MS,
  resolveStrictTransportSecurity,
  resolveTestIntelligenceEnabled,
  resolveTestIntelligenceMultiSourceEnvEnabled,
} from "./constants.js";

void describe("server constants", () => {
  void test("baseline defaults are loopback-only and safe", () => {
    assert.equal(DEFAULT_HOST, "127.0.0.1");
    assert.equal(DEFAULT_PORT, 1983);
    assert.equal(DEFAULT_OUTPUT_ROOT, ".test-intelligence");
    assert.equal(DEFAULT_RATE_LIMIT_PER_MINUTE, 60);
    assert.equal(RATE_LIMIT_WINDOW_MS, 60_000);
    assert.equal(MAX_REQUEST_BODY_BYTES, 1_048_576);
    assert.equal(MAX_SUBMIT_BODY_BYTES, 8_388_608);
    assert.equal(API_ROUTE_PREFIX, "/api/v1");
  });

  void test("default CSP is restrictive", () => {
    assert.match(DEFAULT_CONTENT_SECURITY_POLICY, /default-src 'self'/);
    assert.match(DEFAULT_CONTENT_SECURITY_POLICY, /object-src 'none'/);
    assert.match(DEFAULT_CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  });

  void test("HSTS env name uses the test-intelligence namespace", () => {
    assert.equal(ENABLE_HSTS_ENV, "TEST_INTELLIGENCE_ENABLE_HSTS");
    assert.equal(DEFAULT_STRICT_TRANSPORT_SECURITY, "max-age=31536000");
  });
});

void describe("resolveTestIntelligenceEnabled", () => {
  void test("returns false when env var is unset", () => {
    assert.equal(resolveTestIntelligenceEnabled({}), false);
  });

  for (const truthy of ["1", "true", "yes", "on", "TRUE", " On "]) {
    void test(`treats ${JSON.stringify(truthy)} as enabled`, () => {
      assert.equal(
        resolveTestIntelligenceEnabled({
          [TEST_INTELLIGENCE_ENV]: truthy,
        }),
        true,
      );
    });
  }

  for (const falsy of ["0", "false", "no", "off", "", "maybe"]) {
    void test(`treats ${JSON.stringify(falsy)} as disabled`, () => {
      assert.equal(
        resolveTestIntelligenceEnabled({
          [TEST_INTELLIGENCE_ENV]: falsy,
        }),
        false,
      );
    });
  }
});

void describe("resolveTestIntelligenceMultiSourceEnvEnabled", () => {
  void test("is independent of the parent gate", () => {
    assert.equal(resolveTestIntelligenceMultiSourceEnvEnabled({}), false);
    assert.equal(
      resolveTestIntelligenceMultiSourceEnvEnabled({
        [TEST_INTELLIGENCE_MULTISOURCE_ENV]: "1",
      }),
      true,
    );
  });
});

void describe("resolveStrictTransportSecurity", () => {
  void test("returns undefined when env var is unset", () => {
    assert.equal(resolveStrictTransportSecurity({}), undefined);
  });

  for (const falsy of ["", "0", "false", "no", "off", "OFF"]) {
    void test(`treats ${JSON.stringify(falsy)} as disabled`, () => {
      assert.equal(
        resolveStrictTransportSecurity({
          TEST_INTELLIGENCE_ENABLE_HSTS: falsy,
        }),
        undefined,
      );
    });
  }

  for (const enabled of ["1", "true", "on", "yes"]) {
    void test(`treats ${JSON.stringify(enabled)} as enabled`, () => {
      assert.equal(
        resolveStrictTransportSecurity({
          TEST_INTELLIGENCE_ENABLE_HSTS: enabled,
        }),
        "max-age=31536000",
      );
    });
  }
});
