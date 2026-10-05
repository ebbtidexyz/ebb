// Creator-fee-recipient alerts: decoding real pons factory logs, the alert state machine, HTTP surfacing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toEventSelector, type Hex } from "viem";
import { ponsFactoryAbi } from "../src/chain/abis.js";
import { decodeFeeRecipientLogs, PONS_FEE_EVENT_TOPICS } from "../src/chain/pons.js";
import { activeAlerts, applyFeeRecipientEvents, applyRecipientCheck, saveAlerts, type FeeRecipientEvent } from "../src/core/feeAlerts.js";
import { createApp } from "../src/app.js";
import { testCtx } from "./helpers.js";

const TOKEN = "0x0d6e3d5d99a92499f584ac821a64b237e5cef3c9";
const VAULT = "0x56feb999d829761c787581413605bf88f5cd81e0"; // the recipient at proposal time in the real log
const OTHER = "0xeb95ff72eab9e8d8fdb545fe15587accf410b42e";

// verbatim from the pons factory on mainnet (block 0x41ced55, tx 0x596f…7d76)
const REAL_PROPOSAL = {
  topics: [
    "0x7f119e44c84a715429bee60d30ad2e14afdef6c60bb1a7eaa01290ecf6d1b2e5",
    "0x0000000000000000000000000d6e3d5d99a92499f584ac821a64b237e5cef3c9",
    "0x00000000000000000000000056feb999d829761c787581413605bf88f5cd81e0",
    "0x000000000000000000000000eb95ff72eab9e8d8fdb545fe15587accf410b42e",
  ] as Hex[],
  data: "0x000000000000000000000000000000000000000000000000000000006ab568b5000000000000000000000000000000000000000000000000000000006ab95d35" as Hex,
  transactionHash: "0x596fdc2cd11250382b05333eb445b32574543ee595850d15eea512fa5c7afd76" as Hex,
  blockNumber: "0x41ced55" as Hex,
  logIndex: "0x1" as Hex,
};

test("event signatures in the ABI hash to the topics found in the factory bytecode / logs", () => {
  for (const ev of ponsFactoryAbi.filter((x) => x.type === "event")) {
    assert.equal(toEventSelector(ev), PONS_FEE_EVENT_TOPICS[ev.name], ev.name);
  }
});

test("decodes a real CreatorFeeRecipientChangeProposed log; other tokens are ignored", () => {
  const evs = decodeFeeRecipientLogs([REAL_PROPOSAL], TOKEN);
  assert.equal(evs.length, 1);
  const e = evs[0] as Extract<FeeRecipientEvent, { type: "proposed" }>;
  assert.equal(e.type, "proposed");
  assert.equal(e.current.toLowerCase(), VAULT);
  assert.equal(e.next.toLowerCase(), OTHER);
  assert.equal(e.executableAt, 1_790_273_717);
  assert.equal(e.expiresAt - e.executableAt, 3 * 86_400);
  assert.equal(e.block, 0x41ced55);
  assert.deepEqual(decodeFeeRecipientLogs([REAL_PROPOSAL], "0x0000000000000000000000000000000000000001"), []);
});

test("alert lifecycle: proposal → active until expiry; cancel / execute / revert-to-vault", () => {
  const [p] = decodeFeeRecipientLogs([REAL_PROPOSAL], TOKEN);
  const now = 1_790_014_600;
  let r = applyFeeRecipientEvents([], [p], TOKEN, VAULT, now);
  assert.equal(r.raised.length, 1);
  assert.equal(r.raised[0].kind, "creator_fee_recipient_change_proposed");
  assert.equal(activeAlerts(r.alerts, now).length, 1);
  assert.equal(activeAlerts(r.alerts, 1_790_532_917).length, 0, "past expiresAt it can no longer execute");
  // re-scanning the same log does not raise twice
  assert.equal(applyFeeRecipientEvents(r.alerts, [p], TOKEN, VAULT, now).raised.length, 0);

  const cancelled = applyFeeRecipientEvents(r.alerts, [{ type: "cancelled", token: TOKEN, tx: "0xc", block: 2, logIndex: 0 }], TOKEN, VAULT, now);
  assert.equal(activeAlerts(cancelled.alerts, now).length, 0);

  // executed: proposal closes, a "changed" alert opens (no expiry)
  r = applyFeeRecipientEvents(r.alerts, [{ type: "updated", token: TOKEN, old: VAULT, next: OTHER, tx: "0xd", block: 3, logIndex: 0 }], TOKEN, VAULT, now);
  assert.deepEqual(r.alerts.map((a) => [a.kind, a.status]), [
    ["creator_fee_recipient_change_proposed", "executed"],
    ["creator_fee_recipient_changed", "active"],
  ]);
  assert.equal(activeAlerts(r.alerts, now + 10 ** 8).length, 1);
  // set back to the vault: resolved
  r = applyFeeRecipientEvents(r.alerts, [{ type: "updated", token: TOKEN, old: OTHER, next: VAULT, tx: "0xe", block: 4, logIndex: 0 }], TOKEN, VAULT, now);
  assert.equal(activeAlerts(r.alerts, now).length, 0);
  assert.equal(r.raised.length, 0);
});

test("a proposal naming the vault itself is not an alert", () => {
  const ev: FeeRecipientEvent = { type: "proposed", token: TOKEN, current: OTHER, next: VAULT, executableAt: 1, expiresAt: 10 ** 10, tx: "0x1", block: 1, logIndex: 0 };
  assert.equal(applyFeeRecipientEvents([], [ev], TOKEN, VAULT, 5).raised.length, 0);
});

test("factory record check raises a mismatch once and resolves when the record names the vault again", () => {
  let r = applyRecipientCheck([], TOKEN, OTHER, VAULT, 100);
  assert.equal(r.raised.length, 1);
  r = applyRecipientCheck(r.alerts, TOKEN, OTHER, VAULT, 160);
  assert.equal(r.raised.length, 0, "same mismatch: not raised again");
  r = applyRecipientCheck(r.alerts, TOKEN, VAULT.toUpperCase().replace("0X", "0x"), VAULT, 220);
  assert.equal(activeAlerts(r.alerts, 220).length, 0);
});

test("/api/health `alerts` and /api/soundings `fee_recipient_alert` surface active alerts", async () => {
  const t = testCtx();
  const app = createApp(t.ctx);
  const h0 = await (await app.request("/api/health")).json() as { alerts: unknown[]; pons: boolean };
  assert.deepEqual(h0.alerts, []);
  assert.equal(h0.pons, false);
  const s0 = await (await app.request("/api/soundings")).json() as { fee_recipient_alert: unknown };
  assert.equal(s0.fee_recipient_alert, null);
  const st = await (await app.request("/api/stats")).json() as { pons: unknown };
  assert.equal(st.pons, null, "no pons block outside Pons mode");

  const [p] = decodeFeeRecipientLogs([REAL_PROPOSAL], TOKEN);
  const now = t.getNow();
  const shifted = { ...p, executableAt: now + 3 * 86_400, expiresAt: now + 6 * 86_400 } as FeeRecipientEvent;
  saveAlerts(t.db, applyFeeRecipientEvents([], [shifted], TOKEN, VAULT, now).alerts);

  const h1 = await (await app.request("/api/health")).json() as { alerts: { kind: string; new_recipient: string; expires_at: string }[] };
  assert.equal(h1.alerts.length, 1);
  assert.equal(h1.alerts[0].kind, "creator_fee_recipient_change_proposed");
  assert.equal(h1.alerts[0].new_recipient, OTHER);
  assert.match(h1.alerts[0].expires_at, /^\d{4}-\d\d-\d\dT/);
  const s1 = await (await app.request("/api/soundings")).json() as { fee_recipient_alert: { kind: string } | null };
  assert.equal(s1.fee_recipient_alert?.kind, "creator_fee_recipient_change_proposed");

  t.setNow(now + 6 * 86_400);
  const h2 = await (await app.request("/api/health")).json() as { alerts: unknown[] };
  assert.deepEqual(h2.alerts, [], "expired proposal drops off");
});

test("/api/stats carries the pons block from the (cached) on-chain state", async () => {
  const t = testCtx();
  t.ctx.pons = {
    addresses: { poolId: "0x" + "ab".repeat(32) },
    state: async () => ({ phase: "curve", curve_progress: 0.4021, pool_id: "0x" + "ab".repeat(32), quote: "ETH", quote_collected: "1.68882", graduation_threshold: "4.2" }),
  } as never;
  const st = await (await createApp(t.ctx).request("/api/stats")).json() as { pons: { phase: string; curve_progress: number; pool_id: string } };
  assert.equal(st.pons.phase, "curve");
  assert.equal(st.pons.curve_progress, 0.4021);
  assert.equal(st.pons.pool_id, "0x" + "ab".repeat(32));
});

test("runPonsMonitor: scans from DEPLOY_BLOCK in batches, raises once, keeps the cursor, cross-checks the record", async () => {
  const { runPonsMonitor, MONITOR_CURSOR } = await import("../src/workers/ponsMonitor.js");
  const t = testCtx({ DEPLOY_BLOCK: "1000", MONITOR_BATCH_BLOCKS: "500", INDEXER_LAG_BLOCKS: "0" });
  const [p] = decodeFeeRecipientLogs([REAL_PROPOSAL], TOKEN);
  const now = t.getNow();
  const ranges: [bigint, bigint][] = [];
  let head = 2_200n;
  let recipient = VAULT;
  let failScan = false;
  const pons = {
    addresses: { vault: VAULT, token: TOKEN, factory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" },
    pub: { getBlockNumber: async () => head },
    feeRecipientEvents: async (from: bigint, to: bigint) => {
      if (failScan) throw new Error("archive requests require a token");
      ranges.push([from, to]);
      return from <= 1_500n && 1_500n <= to ? [{ ...p, block: 1_500, executableAt: now + 100, expiresAt: now + 1_000 }] : [];
    },
    state: async () => ({ creator_fee_recipient: recipient }),
  } as never;

  await runPonsMonitor(t.ctx, pons, now);
  assert.deepEqual(ranges, [[1000n, 1499n], [1500n, 1999n], [2000n, 2200n]]);
  assert.equal(t.db.getCursor(MONITOR_CURSOR), "2201");
  const h = await (await createApp(t.ctx).request("/api/health")).json() as { alerts: { kind: string }[] };
  assert.deepEqual(h.alerts.map((a) => a.kind), ["creator_fee_recipient_change_proposed"]);

  // nothing new: no re-scan of old blocks; the record now names someone else → mismatch alert as well
  head = 2_300n;
  recipient = OTHER;
  ranges.length = 0;
  await runPonsMonitor(t.ctx, pons, now + 60);
  assert.deepEqual(ranges, [[2201n, 2300n]]);
  const h2 = await (await createApp(t.ctx).request("/api/health")).json() as { alerts: { kind: string }[] };
  assert.deepEqual(h2.alerts.map((a) => a.kind).sort(), ["creator_fee_recipient_change_proposed", "creator_fee_recipient_mismatch"]);

  // a failing scan still runs the record check, keeps the cursor and reports the error to the scheduler
  failScan = true;
  head = 2_400n;
  await assert.rejects(runPonsMonitor(t.ctx, pons, now + 120), /log scan failed/);
  assert.equal(t.db.getCursor(MONITOR_CURSOR), "2301");
});
