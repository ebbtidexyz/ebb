// Settlement (SPEC.md §5.3, hourly): withdraw spent credit from the vault, one withdrawForUsage per
// tide, with a usage Merkle root over (request_id, amount debited from that tide).
// Fail closed: a withdrawal that fails after its retries halts spending (gateway → 503) until a
// later settlement run succeeds.
import { randomBytes } from "node:crypto";
import type { Ctx } from "../context.js";
import { setSettlementHalted, settlementHalted } from "../context.js";
import { usageRoot } from "../core/merkle.js";
import { errMsg, logger } from "../log.js";

const log = logger("settlement");

/**
 * @param expiringWithinS when set, only tides whose vault expiry is within this many seconds are
 *        settled (the every-minute urgent pass that beats the 7-day deadline).
 */
export async function runSettlement(ctx: Ctx, now = ctx.now(), minAgeS = 60, expiringWithinS?: number): Promise<{ settled: number; amount: bigint }> {
  const { db, basin, clock } = ctx;
  if (await basin.operatorFrozen()) {
    setSettlementHalted(ctx, "operator frozen by guardian");
    log.error("operator is frozen: spending halted permanently");
    return { settled: 0, amount: 0n };
  }
  const rows = db.allBig<{ epoch: bigint; request_id: string; amount_micro: bigint }>(
    `SELECT d.epoch, d.request_id, d.amount_micro FROM debits d JOIN requests r ON r.id = d.request_id
      WHERE d.settlement_id IS NULL AND r.status = 'ok' AND r.finished_at <= ?
      ORDER BY d.epoch, d.request_id`,
    now - minAgeS,
  );
  const byEpoch = new Map<number, { requestId: string; amount: bigint }[]>();
  for (const r of rows) {
    const e = Number(r.epoch);
    if (!byEpoch.has(e)) byEpoch.set(e, []);
    byEpoch.get(e)!.push({ requestId: r.request_id, amount: r.amount_micro });
  }

  let settled = 0;
  let total = 0n;
  for (const [epoch, leaves] of [...byEpoch.entries()].sort((a, b) => a[0] - b[0])) {
    if (expiringWithinS !== undefined && clock.expiresAt(epoch) - now > expiringWithinS) continue;
    const amount = leaves.reduce((s, l) => s + l.amount, 0n);
    if (amount === 0n) continue;
    const root = usageRoot(leaves);
    const id = "stl_" + randomBytes(8).toString("hex");
    const ep = db.getBig<{ granted_micro: bigint; withdrawn_micro: bigint }>("SELECT granted_micro, withdrawn_micro FROM epochs WHERE n = ?", epoch);
    let tx: string | null = null;
    if (clock.isExpired(epoch, now)) {
      // too late to withdraw: the vault burns it. Record so the debits are not retried forever.
      log.warn(`tide ${epoch}: expired before settlement, ${amount} micro-USD of usage forfeited to the Trench`);
    } else {
      if (!ep || ep.withdrawn_micro + amount > ep.granted_micro) {
        const reason = `tide ${epoch}: usage ${amount} exceeds granted headroom`;
        setSettlementHalted(ctx, reason);
        log.error(reason);
        break;
      }
      try {
        tx = await basin.withdrawForUsage(epoch, amount, root);
      } catch (e) {
        const reason = `withdrawForUsage(${epoch}) failed: ${errMsg(e)}`;
        setSettlementHalted(ctx, reason);
        log.error("settlement halted, gateway returns 503 for spending", { reason });
        return { settled, amount: total };
      }
    }
    db.tx(() => {
      db.run("INSERT INTO settlements(id, epoch, amount_micro, usage_root, tx, leaves, created_at) VALUES (?,?,?,?,?,?,?)", id, epoch, amount, root, tx, leaves.length, now);
      for (const l of leaves) {
        db.run("UPDATE debits SET settlement_id = ? WHERE request_id = ? AND epoch = ? AND settlement_id IS NULL", id, l.requestId, epoch);
        db.run(
          "UPDATE requests SET settled_epoch = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM debits WHERE request_id = ? AND settlement_id IS NULL)",
          epoch, l.requestId, l.requestId,
        );
      }
      if (tx) db.run("UPDATE epochs SET withdrawn_micro = withdrawn_micro + ? WHERE n = ?", amount, epoch);
    });
    settled++;
    total += amount;
    if (tx) log.info(`tide ${epoch}: settled usage`, { amount, requests: leaves.length, root, tx });
  }
  if (settlementHalted(ctx) && !(await basin.operatorFrozen())) {
    // everything that was due went through: reopen spending
    const stillDue = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM debits d JOIN requests r ON r.id = d.request_id WHERE d.settlement_id IS NULL AND r.status = 'ok' AND r.finished_at <= ?",
      now - minAgeS,
    )!.n;
    if (stillDue === 0) {
      setSettlementHalted(ctx, null);
      log.info("settlement recovered, spending reopened");
    }
  }
  return { settled, amount: total };
}
