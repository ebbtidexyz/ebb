// Sandbox world (SPEC.md §5.3): fake holders trading $EBB, clock-driven tides with random inflow
// ($20–$400 per tide, booked in three harvests), simulated AI spend, fake-price burns.
// It only writes the same rows the chain indexer writes (balance_points, transfers, harvests);
// allocation, settlement and burning go through the real workers.
import { randomBytes } from "node:crypto";
import { getAddress, keccak256, stringToHex, type Hex } from "viem";
import { GRANT_FLOOR, MICRO } from "@ebb/shared";
import type { Ctx } from "../context.js";
import type { TideClock } from "../core/tides.js";
import { alignTide } from "../core/tides.js";
import type { Db } from "../db/index.js";
import { latestBalance, lc, recordHarvest, setBalancePoint } from "../core/records.js";
import { buildGrantTree } from "../core/merkle.js";
import { creditOf, finalize, reserve } from "../gateway/ledger.js";
import { allocateTide, ALLOCATOR_CURSOR } from "../workers/allocator.js";
import { runSettlement } from "../workers/settlement.js";
import { runKeeper } from "../workers/keeper.js";
import { tokenCostMicro } from "../money.js";
import { logger } from "../log.js";

const log = logger("sandbox");
const E18 = 10n ** 18n;
export const SANDBOX_SIGNIN_BALANCE = 250_000n * E18; // Reef tier
const HISTORY_TIDES = 400; // genesis sits this many tides before the first boot

/** small deterministic PRNG */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SandboxWorld {
  readonly holders: string[];
  readonly pool: string; // simulated AMM pool: holds most supply, excluded from grants
  readonly keeper: string;
  private rng: () => number;
  private logIdx = 0;

  private constructor(private db: Db, private clock: TideClock, readonly seed: number, holders: string[], pool: string) {
    this.holders = holders;
    this.pool = pool;
    this.keeper = lc(this.fakeAddress("keeper"));
    this.rng = mulberry32(seed ^ Date.now());
  }

  /** genesis is fixed at first boot and persisted, so tide numbers survive restarts */
  static genesis(db: Db, now: number): number {
    const g = db.getCursor("sandbox_genesis");
    if (g) return Number(g);
    const genesis = alignTide(now) - HISTORY_TIDES * 1800;
    db.setCursor("sandbox_genesis", genesis);
    return genesis;
  }

  static create(db: Db, clock: TideClock, holderCount: number): SandboxWorld {
    let seed = Number(db.getCursor("sandbox_seed") ?? NaN);
    if (!Number.isFinite(seed)) {
      seed = randomBytes(4).readUInt32LE(0);
      db.setCursor("sandbox_seed", seed);
    }
    const mk = (tag: string) => lc(getAddress("0x" + keccak256(stringToHex(`ebb-sandbox:${seed}:${tag}`)).slice(26)));
    const holders = Array.from({ length: holderCount }, (_, i) => mk(`holder:${i}`));
    return new SandboxWorld(db, clock, seed, holders, mk("amm-pool"));
  }

  fakeAddress(tag: string): string {
    return getAddress("0x" + keccak256(stringToHex(`ebb-sandbox:${this.seed}:${tag}`)).slice(26));
  }
  fakeTx(tag: string): Hex {
    return keccak256(stringToHex(`ebb-sandbox-tx:${this.seed}:${tag}`));
  }
  /** ~one block every 2 s since genesis */
  simBlock(ts: number): number {
    return 1_000_000 + Math.floor((ts - this.clock.genesis) / 2);
  }
  /** fake $EBB price: EBB per $1, drifting ±20% over a day */
  ebbPerUsd(ts: number): bigint {
    return BigInt(Math.round(25_000 * (1 + 0.2 * Math.sin(ts / 86_400))));
  }

  /** this tide's total inflow to the pool (micro-USD), deterministic per (seed, tide) */
  tideTarget(epoch: number): bigint {
    const r = mulberry32((this.seed ^ Math.imul(epoch, 2654435761)) >>> 0)();
    return 20n * MICRO + BigInt(Math.floor(r * 380_000_000));
  }

  /** book whichever of the tide's three harvests (at +590 s, +1190 s, +1790 s) are due by `now` */
  catchUpInflow(epoch: number, now: number): void {
    const start = this.clock.start(epoch);
    const target = this.tideTarget(epoch);
    const third = target / 3n;
    for (let k = 1; k <= 3; k++) {
      const ts = start + 600 * k - 10;
      if (ts > now) break;
      const toPool = k < 3 ? third : target - 2n * third;
      const usdgOut = (toPool * 10_000n) / 7_000n;
      recordHarvest(this.db, this.clock, {
        tx: this.fakeTx(`harvest:${epoch}:${k}`), logIndex: 0, epoch, block: this.simBlock(ts), ts,
        ethIn: (usdgOut * E18) / (3_000n * MICRO), usdgOut, toPool, toTreasury: usdgOut - toPool,
      });
    }
  }

  private transfer(from: string, to: string, amount: bigint, ts: number): void {
    const block = this.simBlock(ts);
    const fb = latestBalance(this.db, from);
    const tb = latestBalance(this.db, to);
    if (amount <= 0n || amount > fb) return;
    this.db.tx(() => {
      this.db.run(
        "INSERT OR IGNORE INTO transfers(block, log_index, ts, from_addr, to_addr, amount, tx) VALUES (?,?,?,?,?,?,?)",
        block, this.logIdx++, ts, from, to, amount.toString(), this.fakeTx(`transfer:${block}:${this.logIdx}`),
      );
      setBalancePoint(this.db, from, block, ts, fb - amount);
      setBalancePoint(this.db, to, block, ts, tb + amount);
    });
  }

  /** a random buy (pool → holder) or sell (holder → pool) or wallet-to-wallet move */
  randomTransfer(ts: number): void {
    const r = this.rng();
    const h = this.holders[Math.floor(this.rng() * this.holders.length)];
    if (r < 0.45) {
      // buy: 20k – 2M EBB
      const amt = BigInt(Math.floor(20_000 + this.rng() * 1_980_000)) * E18;
      this.transfer(this.pool, h, amt, ts);
    } else if (r < 0.9) {
      const bal = latestBalance(this.db, h);
      this.transfer(h, this.pool, (bal * BigInt(Math.floor(5 + this.rng() * 55))) / 100n, ts);
    } else {
      const to = this.holders[Math.floor(this.rng() * this.holders.length)];
      const bal = latestBalance(this.db, h);
      if (to !== h) this.transfer(h, to, (bal * BigInt(Math.floor(10 + this.rng() * 40))) / 100n, ts);
    }
  }

  /** a fake holder spends some credit on the mock model at time ts */
  simulateUsage(ctx: Ctx, ts: number): void {
    const u = ctx.upstreams.all().find((x) => x.isMock) ?? ctx.upstreams.all()[0];
    if (!u) return;
    const candidates = this.holders.filter((h) => creditOf(this.db, h, ts) > 0n);
    if (!candidates.length) return;
    const addr = candidates[Math.floor(this.rng() * candidates.length)];
    const inT = 1_000 + Math.floor(this.rng() * 30_000);
    const outT = 100 + Math.floor(this.rng() * 3_000);
    const est = tokenCostMicro(inT, 4_096, u.inMicroPerM, u.outMicroPerM);
    const id = "req_sim" + randomBytes(9).toString("hex");
    const r = reserve(this.db, { requestId: id, keyId: null, addr, model: u.id, amount: est, now: ts });
    if (!r.ok) return;
    finalize(this.db, id, { cost: tokenCostMicro(inT, outT, u.inMicroPerM, u.outMicroPerM), inTokens: inT, outTokens: outT, now: ts + 3 });
  }

  /** live tick: inflow for the running and previous tide, some trading, some spend */
  tick(ctx: Ctx, now: number): void {
    const cur = this.clock.epochAt(now);
    this.catchUpInflow(cur - 1, now);
    this.catchUpInflow(cur, now);
    if (this.rng() < 0.35) this.randomTransfer(now);
    if (this.rng() < 0.3) this.simulateUsage(ctx, now);
  }

  /** first boot: a few hours of history (plus a handful of week-old tides so the Trench has burns) */
  async seedHistory(ctx: Ctx, now: number, recentTides: number): Promise<void> {
    if (this.db.getCursor("sandbox_seeded")) return;
    const t0 = Date.now();
    const cur = this.clock.epochAt(now);
    const ancient = [4, 3, 2, 1].map((k) => cur - 336 - k); // already past their 7 days
    const recent = Array.from({ length: recentTides }, (_, i) => cur - recentTides + i);
    const firstTs = this.clock.start(ancient[0]) - 3_600;

    // opening balances: the pool holds the float, holders are log-uniform 20k – 30M EBB
    setBalancePoint(this.db, this.pool, this.simBlock(firstTs), firstTs, 400_000_000n * E18);
    for (const h of this.holders) {
      const x = Math.exp(Math.log(20_000) + this.rng() * (Math.log(30_000_000) - Math.log(20_000)));
      setBalancePoint(this.db, h, this.simBlock(firstTs), firstTs, BigInt(Math.floor(x)) * E18);
    }

    for (const e of [...ancient, ...recent]) {
      const start = this.clock.start(e);
      const end = this.clock.end(e);
      const times = Array.from({ length: 3 + Math.floor(this.rng() * 6) }, () => start + Math.floor(this.rng() * 1800)).sort((a, b) => a - b);
      for (const ts of times) this.randomTransfer(ts);
      this.catchUpInflow(e, end);
      await allocateTide(ctx, e, end + ctx.cfg.allocatorDelayS);
      const spends = 2 + Math.floor(this.rng() * 6);
      const spendTimes = Array.from({ length: spends }, () => end + 60 + Math.floor(this.rng() * 1700)).filter((ts) => ts < now - 70).sort((a, b) => a - b);
      for (const ts of spendTimes) {
        this.simulateUsage(ctx, ts);
        // the live process settles hourly plus every minute near expiry; replay that here
        await runSettlement(ctx, ts + 60, 0, 3_600);
      }
      if (spendTimes.length) await runSettlement(ctx, spendTimes[spendTimes.length - 1] + 65, 0);
    }
    this.db.setCursor(ALLOCATOR_CURSOR, cur);

    // the running tide so far
    const start = this.clock.start(cur);
    for (let ts = start + 37; ts < now; ts += 120 + Math.floor(this.rng() * 300)) this.randomTransfer(ts);
    this.catchUpInflow(cur, now);

    await runKeeper(ctx, now); // burns the week-old tides
    this.db.setCursor("sandbox_seeded", now);
    log.info(`seeded sandbox history in ${Date.now() - t0} ms`, { tides: ancient.length + recent.length, holders: this.holders.length, current: cur });
  }

  /**
   * A wallet signing in gets a Reef-tier balance (backdated to the start of the running tide so it
   * floods at the next tide) and, if it has no credit, a welcome credit added to the latest open tidepool.
   */
  onSignIn(addr: string, now: number, welcome: bigint): { seededBalance: boolean; welcome: bigint } {
    const a = lc(addr);
    let seededBalance = false;
    if (latestBalance(this.db, a) < GRANT_FLOOR && !this.holders.includes(a)) {
      const ts = this.clock.start(this.clock.epochAt(now));
      setBalancePoint(this.db, a, this.simBlock(ts), ts, SANDBOX_SIGNIN_BALANCE);
      seededBalance = true;
    }
    if (welcome <= 0n || creditOf(this.db, a, now) > 0n) return { seededBalance, welcome: 0n };
    const ep = this.db.get<{ n: number }>(
      "SELECT n FROM epochs WHERE status = 'committed' AND starts_at + ? > ? ORDER BY n DESC LIMIT 1",
      336 * 1800, now,
    );
    if (!ep) return { seededBalance, welcome: 0n };
    const e = ep.n;
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO grants(epoch, addr, amount_micro, remaining_micro, expires_at) VALUES (?,?,?,?,?)
         ON CONFLICT(epoch, addr) DO UPDATE SET amount_micro = amount_micro + excluded.amount_micro, remaining_micro = remaining_micro + excluded.remaining_micro`,
        e, a, welcome, welcome, this.clock.expiresAt(e),
      );
      // the welcome credit is booked as extra inflow into that tide and the tree is rebuilt,
      // so /api/grants proofs stay valid against the (simulated) on-chain root
      const rows = this.db.allBig<{ addr: string; amount_micro: bigint }>("SELECT addr, amount_micro FROM grants WHERE epoch = ? ORDER BY addr", e);
      const tree = buildGrantTree(e, rows.map((r) => ({ addr: r.addr, amount: r.amount_micro })));
      const total = rows.reduce((s, r) => s + r.amount_micro, 0n);
      this.db.run(
        "UPDATE epochs SET booked_micro = booked_micro + ?, granted_micro = ?, wallets = ?, root = ? WHERE n = ?",
        welcome, total, rows.length, tree.root, e,
      );
      this.db.run("INSERT INTO trees(epoch, dump) VALUES (?, ?) ON CONFLICT(epoch) DO UPDATE SET dump = excluded.dump", e, JSON.stringify(tree.dump()));
    });
    log.info(`welcome credit for ${a}`, { tide: e, micro: welcome });
    return { seededBalance, welcome };
  }
}
