import { test } from "node:test";
import assert from "node:assert/strict";
import { abort, abortStale, creditOf, finalize, reserve, spendablePools, SPEND_GUARD_S } from "../src/gateway/ledger.js";
import { runSettlement } from "../src/workers/settlement.js";
import { createKey } from "../src/auth/apikeys.js";
import { GENESIS, seedPool, testCtx as baseCtx } from "./helpers.js";

// current tide = 20, so tides 10..15 are live (they expire at tide 346+)
const testCtx = () => baseCtx({}, GENESIS + 20 * 1800 + 60);

const W = "0x1111111111111111111111111111111111111111";
const remaining = (db: ReturnType<typeof testCtx>["db"], e: number) =>
  db.getBig<{ r: bigint }>("SELECT remaining_micro AS r FROM grants WHERE epoch = ? AND addr = ?", e, W)!.r;

test("reserve takes FIFO across pools; finalize keeps the oldest and refunds the newest", () => {
  const { ctx, db, clock, getNow } = testCtx();
  seedPool(db, clock, 10, W, 300n);
  seedPool(db, clock, 11, W, 500n);
  seedPool(db, clock, 12, W, 1_000n);
  const r = reserve(db, { requestId: "r1", keyId: null, addr: W, model: "m", amount: 1_000n, now: getNow() });
  assert.ok(r.ok);
  assert.equal(r.balanceBefore, 1_800n);
  assert.deepEqual(r.debits, [{ epoch: 10, amount: 300n }, { epoch: 11, amount: 500n }, { epoch: 12, amount: 200n }]);
  assert.equal(creditOf(db, W, getNow()), 800n);

  const f = finalize(db, "r1", { cost: 450n, inTokens: 10, outTokens: 20, now: getNow() });
  assert.deepEqual(f, { cost: 450n, refunded: 550n, shortfall: 0n });
  assert.equal(remaining(db, 10), 0n);
  assert.equal(remaining(db, 11), 350n);
  assert.equal(remaining(db, 12), 1_000n);
  const debits = db.allBig<{ epoch: bigint; amount_micro: bigint }>("SELECT epoch, amount_micro FROM debits WHERE request_id = 'r1' ORDER BY epoch");
  assert.deepEqual(debits.map((d) => [Number(d.epoch), d.amount_micro]), [[10, 300n], [11, 150n]]);
  const req = db.getBig<{ status: string; cost_micro: bigint }>("SELECT status, cost_micro FROM requests WHERE id = 'r1'")!;
  assert.equal(req.status, "ok");
  assert.equal(req.cost_micro, 450n);
  assert.equal(finalize(db, "r1", { cost: 1n, inTokens: 0, outTokens: 0, now: getNow() }), null, "finalize is once-only");
  void ctx;
});

test("abort refunds every pool it touched", () => {
  const { db, clock, getNow } = testCtx();
  seedPool(db, clock, 10, W, 300n);
  seedPool(db, clock, 11, W, 500n);
  assert.ok(reserve(db, { requestId: "r2", keyId: null, addr: W, model: "m", amount: 700n, now: getNow() }).ok);
  assert.equal(creditOf(db, W, getNow()), 100n);
  assert.equal(abort(db, "r2", "upstream 500", getNow()), true);
  assert.equal(creditOf(db, W, getNow()), 800n);
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM debits WHERE request_id = 'r2'")!.n, 0);
  assert.equal(db.get<{ status: string }>("SELECT status FROM requests WHERE id = 'r2'")!.status, "error");
});

test("insufficient credit is refused without side effects", () => {
  const { db, clock, getNow } = testCtx();
  seedPool(db, clock, 10, W, 300n);
  const r = reserve(db, { requestId: "r3", keyId: null, addr: W, model: "m", amount: 301n, now: getNow() });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.type, "insufficient_credit");
  assert.equal(creditOf(db, W, getNow()), 300n);
  assert.equal(db.get("SELECT 1 FROM requests WHERE id = 'r3'"), undefined);
});

test("expired pools (and the last SPEND_GUARD_S before expiry) and uncommitted tides are never spent", () => {
  const { db, clock, setNow } = testCtx();
  seedPool(db, clock, 10, W, 300n); // vault expiry at start(10)+7d
  seedPool(db, clock, 11, W, 500n, "committing"); // root not on-chain yet
  seedPool(db, clock, 15, W, 50n);
  const cutoff = clock.expiresAt(10) - SPEND_GUARD_S;
  setNow(cutoff - 1);
  assert.deepEqual(spendablePools(db, W, cutoff - 1).map((p) => p.epoch), [10, 15]);
  setNow(cutoff);
  assert.deepEqual(spendablePools(db, W, cutoff).map((p) => p.epoch), [15]);
  const r = reserve(db, { requestId: "r4", keyId: null, addr: W, model: "m", amount: 60n, now: cutoff });
  assert.equal(r.ok, false, "the expiring 300 cannot cover it");
});

test("urgent settlement pass withdraws a tide's last spend before its vault expiry", async () => {
  const { ctx, db, clock, setNow } = testCtx();
  seedPool(db, clock, 10, W, 1_000n);
  seedPool(db, clock, 15, W, 1_000n);
  const t = clock.expiresAt(10) - SPEND_GUARD_S - 1; // last second tide 10 is spendable
  setNow(t);
  assert.ok(reserve(db, { requestId: "late", keyId: null, addr: W, model: "m", amount: 100n, now: t }).ok);
  finalize(db, "late", { cost: 100n, inTokens: 1, outTokens: 1, now: t });
  assert.ok(reserve(db, { requestId: "other", keyId: null, addr: W, model: "m", amount: 100n, now: t }).ok);
  finalize(db, "other", { cost: 100n, inTokens: 1, outTokens: 1, now: t }); // drawn from 10 (FIFO) too
  db.run("UPDATE debits SET epoch = 15 WHERE request_id = 'other'");
  db.run("UPDATE grants SET remaining_micro = remaining_micro - 100 WHERE epoch = 15");
  db.run("UPDATE grants SET remaining_micro = remaining_micro + 100 WHERE epoch = 10");
  const s = await runSettlement(ctx, t + 60, 0, 3_600);
  assert.equal(s.settled, 1, "only the tide expiring within the hour");
  assert.equal(db.getBig<{ w: bigint }>("SELECT withdrawn_micro AS w FROM epochs WHERE n = 10")!.w, 100n);
  assert.equal(db.getBig<{ w: bigint }>("SELECT withdrawn_micro AS w FROM epochs WHERE n = 15")!.w, 0n);
  const tx = db.get<{ tx: string | null }>("SELECT tx FROM settlements WHERE epoch = 10")!.tx;
  assert.ok(tx, "settled with a tx, not forfeited");
  assert.equal((await runSettlement(ctx, t + 120, 0)).settled, 1, "the regular pass picks up the rest");
});

test("usage above the reservation takes extra FIFO, shortfall reported when credit runs out", () => {
  const { db, clock, getNow } = testCtx();
  seedPool(db, clock, 10, W, 100n);
  seedPool(db, clock, 11, W, 100n);
  assert.ok(reserve(db, { requestId: "r5", keyId: null, addr: W, model: "m", amount: 50n, now: getNow() }).ok);
  const f = finalize(db, "r5", { cost: 230n, inTokens: 1, outTokens: 1, now: getNow() });
  assert.deepEqual(f, { cost: 200n, refunded: 0n, shortfall: 30n });
  assert.equal(creditOf(db, W, getNow()), 0n);
});

test("spend caps apply to a sub-key and its parent; refunds release cap headroom", () => {
  const { db, clock, getNow } = testCtx();
  seedPool(db, clock, 10, W, 10_000n);
  const parent = createKey(db, W, { label: "p", spendCap: 1_000n, parentId: null }, getNow());
  const child = createKey(db, W, { label: "c", spendCap: 5_000n, parentId: parent.info.id }, getNow());
  const bad = reserve(db, { requestId: "c1", keyId: child.info.id, addr: W, model: "m", amount: 1_001n, now: getNow() });
  assert.equal(!bad.ok && bad.type, "spend_cap_exceeded", "parent cap binds the child");
  assert.ok(reserve(db, { requestId: "c2", keyId: child.info.id, addr: W, model: "m", amount: 900n, now: getNow() }).ok);
  finalize(db, "c2", { cost: 400n, inTokens: 1, outTokens: 1, now: getNow() });
  const spent = (id: string) => db.getBig<{ s: bigint }>("SELECT spent_micro AS s FROM keys WHERE id = ?", id)!.s;
  assert.equal(spent(child.info.id), 400n);
  assert.equal(spent(parent.info.id), 400n);
  assert.ok(reserve(db, { requestId: "c3", keyId: child.info.id, addr: W, model: "m", amount: 600n, now: getNow() }).ok);
  abort(db, "c3", "x", getNow());
  assert.equal(spent(parent.info.id), 400n);
});

test("stale pending reservations are refunded, in-flight ones are kept", () => {
  const { db, clock, getNow } = testCtx();
  seedPool(db, clock, 10, W, 1_000n);
  reserve(db, { requestId: "old", keyId: null, addr: W, model: "m", amount: 100n, now: getNow() - 3600 });
  reserve(db, { requestId: "live", keyId: null, addr: W, model: "m", amount: 100n, now: getNow() - 3600 });
  assert.equal(abortStale(db, getNow(), 600, new Set(["live"])), 1);
  assert.equal(creditOf(db, W, getNow()), 900n);
});
