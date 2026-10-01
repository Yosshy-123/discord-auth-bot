interface Bucket {
  tokens: number;
  lastRefill: number;
}

/**
 * §13.3: simple per-key token bucket. Buckets are lazily created and
 * never explicitly evicted; for a single-instance deploy with modest
 * traffic this is fine (§16 notes Redis as the future extension point
 * once this needs to scale past one instance).
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxTokens: number,
    private readonly refillWindowMs: number
  ) {}

  /** Returns true if the request is allowed (and consumes one token). */
  consume(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }
    // Refill proportionally to elapsed time.
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      const refill = (elapsed / this.refillWindowMs) * this.maxTokens;
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + refill);
      bucket.lastRefill = now;
    }
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}

// §13.3 の上限値
export const startLimiter = new RateLimiter(20, 60_000); // 20回/分/IP
export const callbackLimiter = new RateLimiter(20, 60_000); // 20回/分/IP
export const collectLimiter = new RateLimiter(10, 60_000); // 10回/分/セッション
export const userinfoLimiter = new RateLimiter(10, 60_000); // 10回/分/管理者
