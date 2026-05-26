import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import { createRateLimiter } from "./rate-limit.js";

void describe("rate-limit fuzz invariants", () => {
  void test("monotonic time, single window: allowed count never exceeds limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.array(fc.integer({ min: 0, max: 59_999 }), {
          minLength: 1,
          maxLength: 500,
        }),
        (limit, offsets) => {
          const limiter = createRateLimiter({ requestsPerMinute: limit });
          let allowed = 0;
          for (const offset of offsets) {
            const decision = limiter.check({
              clientKey: "fuzz",
              routeKey: "fuzz",
              nowMs: offset,
            });
            if (decision.ok) {
              allowed += 1;
            }
          }
          return allowed <= limit;
        },
      ),
      { numRuns: 100 },
    );
  });

  void test("distinct client keys are isolated", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.array(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 8 }),
            fc.integer({ min: 0, max: 59_999 }),
          ),
          { minLength: 1, maxLength: 200 },
        ),
        (limit, requests) => {
          const limiter = createRateLimiter({ requestsPerMinute: limit });
          const perClientAllowed = new Map<string, number>();
          for (const [clientKey, nowMs] of requests) {
            const decision = limiter.check({
              clientKey,
              routeKey: "r",
              nowMs,
            });
            if (decision.ok) {
              perClientAllowed.set(
                clientKey,
                (perClientAllowed.get(clientKey) ?? 0) + 1,
              );
            }
          }
          for (const count of perClientAllowed.values()) {
            if (count > limit) {
              return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  void test("a denied decision has retryAfterSeconds >= 1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 0, max: 59_999 }),
        (limit, baseMs) => {
          const limiter = createRateLimiter({ requestsPerMinute: limit });
          for (let i = 0; i < limit; i += 1) {
            limiter.check({
              clientKey: "c",
              routeKey: "r",
              nowMs: baseMs + i,
            });
          }
          const denied = limiter.check({
            clientKey: "c",
            routeKey: "r",
            nowMs: baseMs + limit,
          });
          assert.equal(denied.ok, false);
          return denied.retryAfterSeconds >= 1;
        },
      ),
      { numRuns: 100 },
    );
  });
});
