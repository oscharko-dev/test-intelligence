/**
 * Fixed-window per-client+route rate limiter.
 *
 * The limiter is deterministic in the test suite because the `now` clock is
 * injected. Each `(clientKey, routeKey)` pair gets its own bucket; the
 * window is the {@link RATE_LIMIT_WINDOW_MS} sliding-fixed-window pair
 * (i.e. a new window starts the first time a request lands after the prior
 * window expired). A burst of N requests inside one window is accepted up
 * to `requestsPerMinute` and rejected with `429 RATE_LIMITED` thereafter.
 *
 * The store is intentionally not LRU: operators bind the standalone server
 * to a loopback interface, so the cardinality of `clientKey` is bounded by
 * the number of operator sessions. A future deployment with a public bind
 * can wrap {@link RateLimitStore} with an eviction policy without changing
 * this module.
 */

import { RATE_LIMIT_WINDOW_MS } from "./constants.js";
import { RateLimitStore } from "./rate-limit-store.js";

export interface RateLimitAllowed {
  readonly ok: true;
  readonly remaining: number;
  readonly resetAtMs: number;
}

export interface RateLimitDenied {
  readonly ok: false;
  readonly retryAfterSeconds: number;
  readonly resetAtMs: number;
}

export type RateLimitDecision = RateLimitAllowed | RateLimitDenied;

export interface RateLimiter {
  check(input: {
    clientKey: string;
    routeKey: string;
    nowMs: number;
  }): RateLimitDecision;
  reset(): void;
}

export interface CreateRateLimiterInput {
  /** Maximum requests allowed within {@link RATE_LIMIT_WINDOW_MS}. */
  readonly requestsPerMinute: number;
  /** Optional injected store (defaults to a fresh in-memory map). */
  readonly store?: RateLimitStore;
}

export const createRateLimiter = ({
  requestsPerMinute,
  store = new RateLimitStore(),
}: CreateRateLimiterInput): RateLimiter => {
  if (!Number.isFinite(requestsPerMinute) || requestsPerMinute < 1) {
    throw new Error(
      "createRateLimiter: requestsPerMinute must be a finite integer >= 1.",
    );
  }
  const limit = Math.floor(requestsPerMinute);

  return {
    check({ clientKey, routeKey, nowMs }) {
      const key = `${clientKey}\x00${routeKey}`;
      const existing = store.get(key);
      if (
        existing === undefined ||
        nowMs - existing.windowStartedAtMs >= RATE_LIMIT_WINDOW_MS
      ) {
        store.set(key, { count: 1, windowStartedAtMs: nowMs });
        return {
          ok: true,
          remaining: limit - 1,
          resetAtMs: nowMs + RATE_LIMIT_WINDOW_MS,
        };
      }

      if (existing.count >= limit) {
        const resetAtMs = existing.windowStartedAtMs + RATE_LIMIT_WINDOW_MS;
        return {
          ok: false,
          retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)),
          resetAtMs,
        };
      }

      existing.count += 1;
      return {
        ok: true,
        remaining: Math.max(0, limit - existing.count),
        resetAtMs: existing.windowStartedAtMs + RATE_LIMIT_WINDOW_MS,
      };
    },
    reset() {
      store.clear();
    },
  };
};
