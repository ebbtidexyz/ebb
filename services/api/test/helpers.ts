import { loadConfig } from "../src/config.js";
import { openDb, type Db } from "../src/db/index.js";
import { TideClock } from "../src/core/tides.js";
import { SandboxWorld } from "../src/sandbox/world.js";
import { SandboxBasin } from "../src/sandbox/basin.js";
import { parseUpstreams, UpstreamRegistry, BUILTIN_MOCK } from "../src/gateway/upstreams.js";
import { RateLimiter } from "../src/gateway/ratelimit.js";
import type { Ctx } from "../src/context.js";
import { setLogLevel } from "../src/log.js";

setLogLevel("error");

export const GENESIS = 1_790_000_000 - (1_790_000_000 % 1800);

export function seedPool(db: Db, clock: TideClock, epoch: number, addr: string, micro: bigint, status = "committed") {
  db.run("INSERT OR IGNORE INTO epochs(n, starts_at, booked_micro, granted_micro, status) VALUES (?,?,?,?,?)", epoch, clock.start(epoch), micro, micro, status);
  db.run(
    "INSERT INTO grants(epoch, addr, amount_micro, remaining_micro, expires_at) VALUES (?,?,?,?,?)",
    epoch, addr.toLowerCase(), micro, micro, clock.expiresAt(epoch),
  );
}

export function testCtx(env: Record<string, string> = {}, startAt = GENESIS + 500 * 1800 + 60) {
  const cfg = loadConfig({ EBB_MODE: "sandbox", DB_PATH: ":memory:", SANDBOX_HOLDERS: "8", SIWE_DOMAIN: "localhost:3000", WEB_ORIGIN: "http://localhost:3000", ...env });
  const db = openDb(":memory:");
  const clock = new TideClock(GENESIS);
  const world = SandboxWorld.create(db, clock, cfg.sandbox.holders);
  let now = startAt;
  const basin = new SandboxBasin(db, clock, world, () => now);
  const ctx: Ctx = {
    cfg, db, basin, clock,
    upstreams: new UpstreamRegistry(parseUpstreams([{ ...BUILTIN_MOCK }])),
    limiter: new RateLimiter(),
    pub: null,
    world,
    pons: null,
    sessionSecret: "test-secret-test-secret-test-secret!!",
    excluded: new Set([world.pool]),
    inFlight: new Set(),
    workers: new Map(),
    startedAt: now,
    now: () => now,
  };
  return { ctx, db, clock, world, setNow: (t: number) => (now = t), getNow: () => now };
}
