import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRateLimiter } from "./rate-limit.js";
import { RateLimitStore } from "./rate-limit-store.js";

void describe("createRateLimiter", () => {
  void test("rejects non-finite requestsPerMinute", () => {
    assert.throws(() => createRateLimiter({ requestsPerMinute: 0 }));
    assert.throws(() => createRateLimiter({ requestsPerMinute: -1 }));
    assert.throws(() => createRateLimiter({ requestsPerMinute: Number.NaN }));
  });

  void test("allows up to the limit then denies", () => {
    const limiter = createRateLimiter({ requestsPerMinute: 3 });
    const args = { clientKey: "1.2.3.4", routeKey: "POST /api/v1/jobs" };
    for (let i = 0; i < 3; i += 1) {
      const decision = limiter.check({ ...args, nowMs: 1_000 + i });
      assert.equal(decision.ok, true);
    }
    const denied = limiter.check({ ...args, nowMs: 1_003 });
    assert.equal(denied.ok, false);
    assert.ok(denied.retryAfterSeconds >= 1);
  });

  void test("starts a new window after expiry", () => {
    const limiter = createRateLimiter({ requestsPerMinute: 1 });
    const args = { clientKey: "ip", routeKey: "GET /healthz" };
    const first = limiter.check({ ...args, nowMs: 0 });
    assert.equal(first.ok, true);
    const denied = limiter.check({ ...args, nowMs: 30_000 });
    assert.equal(denied.ok, false);
    const fresh = limiter.check({ ...args, nowMs: 60_000 });
    assert.equal(fresh.ok, true);
  });

  void test("client and route are isolated", () => {
    const limiter = createRateLimiter({ requestsPerMinute: 1 });
    const decA = limiter.check({
      clientKey: "a",
      routeKey: "r",
      nowMs: 1_000,
    });
    const decB = limiter.check({
      clientKey: "b",
      routeKey: "r",
      nowMs: 1_001,
    });
    const decAR = limiter.check({
      clientKey: "a",
      routeKey: "r2",
      nowMs: 1_002,
    });
    assert.equal(decA.ok, true);
    assert.equal(decB.ok, true);
    assert.equal(decAR.ok, true);
  });

  void test("reset clears all buckets", () => {
    const store = new RateLimitStore();
    const limiter = createRateLimiter({ requestsPerMinute: 1, store });
    limiter.check({ clientKey: "x", routeKey: "y", nowMs: 0 });
    assert.equal(store.size(), 1);
    limiter.reset();
    assert.equal(store.size(), 0);
  });

  void test("retryAfterSeconds is at least 1 even near window end", () => {
    const limiter = createRateLimiter({ requestsPerMinute: 1 });
    const args = { clientKey: "c", routeKey: "r" };
    limiter.check({ ...args, nowMs: 0 });
    const denied = limiter.check({ ...args, nowMs: 59_500 });
    assert.equal(denied.ok, false);
    assert.equal(denied.retryAfterSeconds >= 1, true);
  });
});

void describe("createRateLimiter fuzz", () => {
  void test("never exceeds limit within a single window", () => {
    const limit = 5;
    const limiter = createRateLimiter({ requestsPerMinute: limit });
    let allowed = 0;
    for (let i = 0; i < 100; i += 1) {
      const decision = limiter.check({
        clientKey: "ip",
        routeKey: "GET /api/v1/jobs",
        nowMs: 1_000 + i,
      });
      if (decision.ok) {
        allowed += 1;
      }
    }
    assert.equal(allowed, limit);
  });
});
