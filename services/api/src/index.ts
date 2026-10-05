// Ebb API: one process = HTTP (Hono) + workers on timers (SPEC.md §5).
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";
import { TideClock } from "./core/tides.js";
import { loadUpstreams } from "./gateway/upstreams.js";
import { RateLimiter } from "./gateway/ratelimit.js";
import { abortStale } from "./gateway/ledger.js";
import { ChainBasin } from "./chain/chainBasin.js";
import { SandboxWorld } from "./sandbox/world.js";
import { SandboxBasin } from "./sandbox/basin.js";
import { createApp } from "./app.js";
import { Scheduler } from "./workers/scheduler.js";
import { runIndexer } from "./workers/indexer.js";
import { runAllocator, ALLOCATOR_CURSOR } from "./workers/allocator.js";
import { runKeeper, runPoke, runTideHarvest } from "./workers/keeper.js";
import { runPonsMonitor } from "./workers/ponsMonitor.js";
import { runSettlement } from "./workers/settlement.js";
import { runPublisher } from "./workers/publisher.js";
import type { Ctx } from "./context.js";
import { nowS } from "./money.js";
import { logger, setLogLevel } from "./log.js";

const log = logger("boot");

async function main() {
  // optional .env in the working directory (Node's built-in loader; real env vars win)
  if (existsSync(".env")) {
    const before = { ...process.env };
    process.loadEnvFile(".env");
    Object.assign(process.env, before);
  }
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);
  const db = openDb(cfg.dbPath);
  log.info(`mode=${cfg.mode} db=${cfg.dbPath}${cfg.mode === "chain" ? ` chain=${cfg.chainId} rpc=${new URL(cfg.rpcUrl).host}` : ""}`);

  // session secret: env, or (sandbox only) a random one persisted in the DB so restarts keep sessions
  let sessionSecret = cfg.sessionSecret;
  if (!sessionSecret) {
    sessionSecret = db.getCursor("dev_session_secret");
    if (!sessionSecret) {
      sessionSecret = randomBytes(32).toString("hex");
      db.setCursor("dev_session_secret", sessionSecret);
    }
    log.warn("SESSION_SECRET not set: using a generated sandbox secret");
  }

  const now = nowS();
  let world: SandboxWorld | null = null;
  let chainBasin: ChainBasin | null = null;
  let clock: TideClock;
  let basin: Ctx["basin"];
  if (cfg.mode === "chain") {
    chainBasin = await ChainBasin.connect(cfg);
    basin = chainBasin;
    clock = new TideClock(chainBasin.genesis);
    if (!db.getCursor(ALLOCATOR_CURSOR)) db.setCursor(ALLOCATOR_CURSOR, 0);
  } else {
    clock = new TideClock(SandboxWorld.genesis(db, now));
    world = SandboxWorld.create(db, clock, cfg.sandbox.holders);
    basin = new SandboxBasin(db, clock, world);
  }

  const excluded = new Set<string>(cfg.excluded.map((a) => a.toLowerCase()));
  excluded.add("0x0000000000000000000000000000000000000000");
  excluded.add("0x000000000000000000000000000000000000dead");
  for (const a of Object.values(basin.addresses)) if (a) excluded.add(a.toLowerCase());
  if (world) excluded.add(world.pool);
  // Pons: the curve holds the unsold supply and the v4 PoolManager the pool's $EBB; neither may ever get grants
  const pons = chainBasin?.pons ?? null;
  if (pons) for (const a of pons.excludedAddresses(cfg.chainId)) excluded.add(a.toLowerCase());
  log.info(`excluded from grants: ${excluded.size} addresses`);

  const ctx: Ctx = {
    cfg,
    db,
    basin,
    clock,
    upstreams: loadUpstreams(cfg.upstreamsPath),
    limiter: new RateLimiter(),
    pub: chainBasin?.pub ?? null,
    world,
    pons,
    sessionSecret,
    excluded,
    inFlight: new Set(),
    workers: new Map(),
    startedAt: now,
    now: nowS,
  };

  const reaped = abortStale(db, now, 0);
  if (reaped) log.warn(`refunded ${reaped} reservation(s) left pending by the previous process`);

  if (world) await world.seedHistory(ctx, now, cfg.sandbox.seedTides);

  // workers
  const sched = new Scheduler(ctx);
  if (chainBasin) {
    const cb = chainBasin;
    sched.every("indexer", cfg.indexerIntervalMs, () => runIndexer(ctx, cb));
  } else {
    sched.every("sandbox", cfg.sandbox.tickMs, async () => world!.tick(ctx, ctx.now()), cfg.sandbox.tickMs);
  }
  sched.atTide("allocator", clock.genesis, cfg.allocatorDelayS, () => runAllocator(ctx));
  sched.every("allocator-catchup", 60_000, () => runAllocator(ctx), 2_000); // retries a tide that had to wait
  sched.every("keeper", cfg.keeperIntervalMs, () => runKeeper(ctx), 5_000);
  if (pons) {
    const p = pons;
    sched.every("poke", cfg.pokeIntervalMs, () => runPoke(ctx), 3_000);
    sched.every("harvest", 60_000, () => runTideHarvest(ctx), 20_000); // once per tide at HARVEST_OFFSET_S
    sched.every("pons-monitor", cfg.monitorIntervalMs, () => runPonsMonitor(ctx, p), 8_000);
  }
  sched.every("settlement", cfg.settlementIntervalMs, () => runSettlement(ctx), 10_000);
  // tides about to expire are settled every minute so their last spend lands before the deadline
  sched.every("settlement-urgent", 60_000, () => runSettlement(ctx, ctx.now(), 0, 3_600), 30_000);
  sched.every("publisher", cfg.publisherIntervalMs, async () => {
    runPublisher(ctx);
    ctx.limiter.sweep();
  });

  const app = createApp(ctx);
  const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (info) => {
    log.info(`listening on http://${cfg.host ?? "localhost"}:${info.port}`, {
      mode: cfg.mode, pons: !!pons, tide: clock.epochAt(nowS()), models: ctx.upstreams.all().map((u) => u.id),
    });
  });

  const shutdown = (sig: string) => {
    log.info(`${sig}: shutting down`);
    sched.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  log.error("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
