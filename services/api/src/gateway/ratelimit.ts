// Per-wallet token bucket (requests per minute, burst = rpm) + concurrency limit, in memory.

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number; rpm: number }>();
  private inflight = new Map<string, number>();

  /** consume one request; nowMs injectable for tests */
  take(id: string, rpm: number, nowMs = Date.now()): { ok: true; remaining: number } | { ok: false; retryAfterS: number } {
    const rate = rpm / 60_000; // tokens per ms
    let b = this.buckets.get(id);
    if (!b) {
      b = { tokens: rpm, updated: nowMs, rpm };
      this.buckets.set(id, b);
    } else {
      b.tokens = Math.min(rpm, b.tokens + (nowMs - b.updated) * rate);
      b.updated = nowMs;
      b.rpm = rpm;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, remaining: Math.floor(b.tokens) };
    }
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((1 - b.tokens) / rate / 1000)) };
  }

  acquire(id: string, max: number): boolean {
    const n = this.inflight.get(id) ?? 0;
    if (n >= max) return false;
    this.inflight.set(id, n + 1);
    return true;
  }

  release(id: string): void {
    const n = (this.inflight.get(id) ?? 1) - 1;
    if (n <= 0) this.inflight.delete(id);
    else this.inflight.set(id, n);
  }

  inFlight(id: string): number {
    return this.inflight.get(id) ?? 0;
  }

  /** drop idle full buckets so the map does not grow without bound */
  sweep(nowMs = Date.now()): void {
    for (const [id, b] of this.buckets) if (nowMs - b.updated > 120_000) this.buckets.delete(id);
  }
}
