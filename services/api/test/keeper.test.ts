// Keeper scheduling: poke cadence, harvest once per tide, burn slices + no retry after a revert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MICRO } from "@ebb/shared";
import type { Basin, HarvestOutcome } from "../src/chain/basin.js";
import type { PokeOutcome, PonsChain } from "../src/chain/pons.js";
import { TideClock } from "../src/core/tides.js";
import { burnSlices, harvestDue, pokeDue } from "../src/core/keeperPlan.js";
import { HARVEST_CURSOR, runKeeper, runPoke, runTideHarvest } from "../src/workers/keeper.js";
import { GENESIS, testCtx } from "./helpers.js";

test("pokeDue: only when a feed's newest sample is >= minInterval old (or the feed is empty)", () => {
  assert.equal(pokeDue([{ count: 0, lastTs: 0 }], 150, 1_000), true);
  assert.equal(pokeDue([{ count: 3, lastTs: 1_000 }], 150, 1_149), false);
  assert.equal(pokeDue([{ count: 3, lastTs: 1_000 }], 150, 1_150), true);
  assert.equal(pokeDue([{ count: 3, lastTs: 1_100 }, { count: 3, lastTs: 900 }], 150, 1_060), true, "any due feed");
});

test("pokeDue over a simulated day at POKE_INTERVAL 155 s: every tick pokes, spacing never below 150 s", () => {
  let last = { count: 0, lastTs: 0 };
  let pokes = 0;
  let minGap = Infinity;
  for (let t = 10_000; t < 10_000 + 86_400; t += 155) {
    if (pokeDue([last], 150, t)) {
      if (last.count) minGap = Math.min(minGap, t - last.lastTs);
      last = { count: last.count + 1, lastTs: t };
      pokes++;
    }
  }
  assert.equal(pokes, Math.ceil(86_400 / 155));
  assert.ok(minGap >= 150);
  // a 150 s cadence with slight jitter would skip ticks: a tick 149 s after the last sample is a no-op
  assert.equal(pokeDue([{ count: 5, lastTs: 0 }], 150, 149), false);
});

test("harvestDue: once per tide, at :05/:35 (offset), catch-up when started late, nothing before genesis", () => {
  const clock = new TideClock(GENESIS);
  const off = 300;
  const t0 = clock.start(10);
  assert.equal(harvestDue(clock, GENESIS - 10, null, off), null, "before genesis");
  assert.equal(harvestDue(clock, t0 + 299, null, off), null, "before :05");
  assert.equal(harvestDue(clock, t0 + 300, null, off), 10);
  assert.equal(harvestDue(clock, t0 + 300, 10, off), null, "already done this tide");
  assert.equal(harvestDue(clock, t0 + 1_700, 9, off), 10, "late start catches up");
  assert.equal(harvestDue(clock, clock.start(11) + 100, 10, off), null, "next tide waits for its offset");
  assert.equal(harvestDue(clock, clock.start(11) + 300, 10, off), 11);
  // simulate a day of minute ticks: exactly one harvest per tide
  let last: number | null = null;
  const done: number[] = [];
  for (let t = t0; t < t0 + 86_400; t += 60) {
    const e = harvestDue(clock, t, last, off);
    if (e !== null) {
      done.push(e);
      last = e;
      assert.equal((t - clock.start(e)) % 1800, 300);
    }
  }
  assert.equal(done.length, 48);
  assert.deepEqual(done, [...new Set(done)]);
});

test("burnSlices: BURN_SLICE caps each call, BURN_MAX_SLICES caps the round", () => {
  assert.deepEqual(burnSlices(120n * MICRO, 50n * MICRO, 10), [50n * MICRO, 50n * MICRO, 20n * MICRO]);
  assert.deepEqual(burnSlices(10n, 50n * MICRO, 10), [10n]);
  assert.deepEqual(burnSlices(0n, 50n * MICRO, 10), []);
  assert.equal(burnSlices(10_000n * MICRO, 50n * MICRO, 10).length, 10);
});

/** a Basin whose vault state is two numbers; burnExpired fails on chosen call numbers */
function stubBasin(opts: { remaining: Map<number, bigint>; failOn?: Set<number>; harvest?: () => Promise<HarvestOutcome> }) {
  const calls: { epoch: number; amount: bigint; ok: boolean }[] = [];
  let harvests = 0;
  let burnCalls = 0;
  const basin: Basin = {
    kind: "chain", genesis: GENESIS,
    addresses: { vault: null, token: null, usdg: null, treasury: null, settlement: null },
    indexedThrough: () => Number.MAX_SAFE_INTEGER, headBlock: () => 1,
    readBooked: async () => 0n, readCommittedRoot: async () => null,
    commitGrants: async () => null, withdrawForUsage: async () => null,
    harvest: async () => {
      harvests++;
      return opts.harvest ? opts.harvest() : { kind: "skipped", reason: "stub" };
    },
    remaining: async (e) => opts.remaining.get(e) ?? 0n,
    burnExpired: async (e, amount) => {
      const n = ++burnCalls;
      const fail = opts.failOn?.has(n) ?? false;
      calls.push({ epoch: e, amount, ok: !fail });
      if (fail) throw new Error("execution reverted: InsufficientHistory");
      opts.remaining.set(e, (opts.remaining.get(e) ?? 0n) - amount);
      return `0x${n.toString(16).padStart(64, "0")}`;
    },
    vaultUsdg: async () => null, operatorFrozen: async () => false,
  };
  return { basin, calls, harvestCount: () => harvests };
}

function expiredTides(t: ReturnType<typeof testCtx>, tides: number[]) {
  for (const n of tides) {
    t.db.run("INSERT INTO epochs(n, starts_at, booked_micro, granted_micro, status) VALUES (?,?,?,?, 'committed')", n, t.clock.start(n), 1n, 0n);
  }
}

test("runKeeper burns in $50 slices and stops a tide for the round at the first revert; the next round retries", async () => {
  const t = testCtx({ BURN_SLICE_MICRO: String(50n * MICRO), BURN_MAX_SLICES: "10" });
  expiredTides(t, [1, 2]);
  const remaining = new Map([[1, 175n * MICRO], [2, 80n * MICRO]]);
  const s = stubBasin({ remaining, failOn: new Set([2]) }); // 2nd call ever (tide 1's second slice) reverts
  t.ctx.basin = s.basin;

  const r1 = await runKeeper(t.ctx);
  assert.deepEqual(s.calls.map((c) => [c.epoch, c.amount, c.ok]), [
    [1, 50n * MICRO, true],
    [1, 50n * MICRO, false], // revert: tide 1 done for this round
    [2, 50n * MICRO, true], // other tides still run
    [2, 30n * MICRO, true],
  ]);
  assert.equal(r1[0].stopped, "execution reverted: InsufficientHistory");
  assert.equal(r1[0].burned, 50n * MICRO);
  assert.equal(r1[1].stopped, null);
  assert.equal(remaining.get(1), 125n * MICRO);

  // next round: tide 2 is empty → marked burned; tide 1 resumes
  s.calls.length = 0;
  await runKeeper(t.ctx);
  assert.deepEqual(s.calls.map((c) => [c.epoch, c.amount]), [[1, 50n * MICRO], [1, 50n * MICRO], [1, 25n * MICRO]]);
  assert.equal(t.db.get<{ status: string }>("SELECT status FROM epochs WHERE n = 2")!.status, "burned");
  assert.equal(t.db.get<{ status: string }>("SELECT status FROM epochs WHERE n = 1")!.status, "expired");
});

test("runKeeper: a round never exceeds BURN_MAX_SLICES per tide", async () => {
  const t = testCtx({ BURN_SLICE_MICRO: String(50n * MICRO), BURN_MAX_SLICES: "3" });
  expiredTides(t, [1]);
  const s = stubBasin({ remaining: new Map([[1, 1_000n * MICRO]]) });
  t.ctx.basin = s.basin;
  await runKeeper(t.ctx);
  assert.equal(s.calls.length, 3);
});

test("runKeeper harvests every round on legacy vaults, never in Pons mode", async () => {
  const t = testCtx();
  const s = stubBasin({ remaining: new Map() });
  t.ctx.basin = s.basin;
  await runKeeper(t.ctx);
  assert.equal(s.harvestCount(), 1);
  t.ctx.pons = {} as PonsChain;
  await runKeeper(t.ctx);
  assert.equal(s.harvestCount(), 1);
});

test("runTideHarvest: once per tide; skipped/reverted outcomes still mark the tide, transport errors retry", async () => {
  const t = testCtx({ HARVEST_OFFSET_S: "300" });
  let next: () => Promise<HarvestOutcome> = async () => ({ kind: "reverted", reason: "SlippageExceeded" });
  const s = stubBasin({ remaining: new Map(), harvest: () => next() });
  t.ctx.basin = s.basin;
  const tide = 600;
  const start = t.clock.start(tide);

  t.setNow(start + 200);
  assert.equal(await runTideHarvest(t.ctx), null, "before :05");
  t.setNow(start + 310);
  assert.equal((await runTideHarvest(t.ctx))?.kind, "reverted");
  assert.equal(t.db.getCursor(HARVEST_CURSOR), String(tide));
  t.setNow(start + 400);
  assert.equal(await runTideHarvest(t.ctx), null, "no second attempt in the same tide");
  assert.equal(s.harvestCount(), 1);

  next = async () => { throw new Error("fetch failed"); };
  t.setNow(t.clock.start(tide + 1) + 305);
  await assert.rejects(runTideHarvest(t.ctx), /fetch failed/);
  assert.equal(t.db.getCursor(HARVEST_CURSOR), String(tide), "not marked: retried next minute");
  next = async () => ({ kind: "sent", tx: "0xabc", event: { epoch: tide + 1, ethIn: 10n ** 16n, usdgOut: 40n * MICRO, toPool: 28n * MICRO, toTreasury: 12n * MICRO } });
  t.setNow(t.clock.start(tide + 1) + 365);
  assert.equal((await runTideHarvest(t.ctx))?.kind, "sent");
  assert.equal(t.db.getCursor(HARVEST_CURSOR), String(tide + 1));
  assert.equal(s.harvestCount(), 3);
});

test("runPoke: no-op outside Pons mode; passes through skip / revert / send", async () => {
  const t = testCtx();
  assert.equal(await runPoke(t.ctx), null);
  const outcomes: PokeOutcome[] = [
    { kind: "skipped", reason: "too soon" },
    { kind: "reverted", reason: "curve not live" },
    { kind: "reverted", reason: "curve not live" },
    { kind: "sent", tx: "0x01" },
  ];
  t.ctx.pons = { poke: async () => outcomes.shift()! } as unknown as PonsChain;
  const state: { lastReason?: string } = {};
  assert.equal((await runPoke(t.ctx, state))?.kind, "skipped");
  assert.equal((await runPoke(t.ctx, state))?.kind, "reverted");
  assert.equal(state.lastReason, "curve not live");
  await runPoke(t.ctx, state);
  assert.equal((await runPoke(t.ctx, state))?.kind, "sent");
  assert.equal(state.lastReason, undefined);
});
