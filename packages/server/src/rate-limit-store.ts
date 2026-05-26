/**
 * Per-key fixed-window counters used by the request-handler rate limiter.
 *
 * The store is deliberately simple: a `Map` of bucket records, no LRU, no
 * background reaping. The handler reaps lazily on every read by dropping
 * any bucket whose window has expired. A long-running operator instance
 * with a high cardinality of remote IPs will trim memory each call without
 * needing a timer.
 */

export interface RateLimitBucket {
  count: number;
  windowStartedAtMs: number;
}

export class RateLimitStore {
  private readonly buckets: Map<string, RateLimitBucket> = new Map();

  get(key: string): RateLimitBucket | undefined {
    return this.buckets.get(key);
  }

  set(key: string, bucket: RateLimitBucket): void {
    this.buckets.set(key, bucket);
  }

  delete(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }

  size(): number {
    return this.buckets.size;
  }
}
