import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/gateway/ratelimit.js";

test("token bucket: burst of rpm, then refills at rpm/60 per second", () => {
  const rl = new RateLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < 10; i++) assert.ok(rl.take("w", 10, t0).ok, `request ${i}`);
  const denied = rl.take("w", 10, t0);
  assert.equal(denied.ok, false);
  assert.equal(!denied.ok && denied.retryAfterS, 6); // 10 rpm → one token every 6 s
  assert.equal(rl.take("w", 10, t0 + 5_999).ok, false);
  assert.ok(rl.take("w", 10, t0 + 6_000).ok);
  assert.ok(rl.take("other", 10, t0).ok, "buckets are per wallet");
});

test("token bucket never exceeds its capacity after idling", () => {
  const rl = new RateLimiter();
  rl.take("w", 60, 0);
  let ok = 0;
  for (let i = 0; i < 100; i++) if (rl.take("w", 60, 10_000_000).ok) ok++;
  assert.equal(ok, 60);
});

test("concurrency limit per wallet", () => {
  const rl = new RateLimiter();
  assert.ok(rl.acquire("w", 2));
  assert.ok(rl.acquire("w", 2));
  assert.equal(rl.acquire("w", 2), false);
  rl.release("w");
  assert.ok(rl.acquire("w", 2));
  assert.equal(rl.inFlight("w"), 2);
  rl.release("w");
  rl.release("w");
  rl.release("w"); // extra release is harmless
  assert.equal(rl.inFlight("w"), 0);
});
