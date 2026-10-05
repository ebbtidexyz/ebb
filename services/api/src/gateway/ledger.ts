// Credit ledger over tidepools (grants rows). Every mutation is one sqlite transaction.
//   reserve  → take the max cost FIFO (oldest unexpired pool first), write pending request + debits
//   finalize → keep the real cost FIFO, refund the rest to the same pools
//   abort    → refund everything
import type { Db } from "../db/index.js";
import { lc } from "../core/records.js";

export interface PoolRow { epoch: number; remaining: bigint; expires_at: number }

/**
 * Pools stop being spendable this long before the vault expiry, so the urgent settlement pass
 * (every minute, for tides expiring within the hour) can withdraw the last spend before
 * withdrawForUsage starts reverting. `spend_until = expires_at - SPEND_GUARD_S`.
 */
export const SPEND_GUARD_S = 300;

export function spendablePools(db: Db, addr: string, now: number): PoolRow[] {
  return db
    .allBig<{ epoch: bigint; remaining: bigint; expires_at: bigint }>(
      `SELECT g.epoch, g.remaining_micro AS remaining, g.expires_at FROM grants g JOIN epochs e ON e.n = g.epoch
        WHERE g.addr = ? AND g.remaining_micro > 0 AND g.expires_at > ? AND e.status = 'committed'
        ORDER BY g.epoch ASC`,
      lc(addr), now + SPEND_GUARD_S,
    )
    .map((r) => ({ epoch: Number(r.epoch), remaining: r.remaining, expires_at: Number(r.expires_at) }));
}

export function creditOf(db: Db, addr: string, now: number): bigint {
  return spendablePools(db, addr, now).reduce((s, p) => s + p.remaining, 0n);
}

/** key id followed by its ancestors (sub-key → parent → …) */
export function keyChain(db: Db, keyId: string | null): { id: string; spend_cap_micro: bigint | null; spent_micro: bigint }[] {
  const out: { id: string; spend_cap_micro: bigint | null; spent_micro: bigint }[] = [];
  let id = keyId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const k = db.getBig<{ id: string; parent_id: string | null; spend_cap_micro: bigint | null; spent_micro: bigint }>(
      "SELECT id, parent_id, spend_cap_micro, spent_micro FROM keys WHERE id = ?", id,
    );
    if (!k) break;
    out.push({ id: k.id, spend_cap_micro: k.spend_cap_micro, spent_micro: k.spent_micro });
    id = k.parent_id;
  }
  return out;
}

/** smallest remaining headroom under any spend cap in the chain (null = uncapped) */
export function capHeadroom(db: Db, keyId: string | null): bigint | null {
  let min: bigint | null = null;
  for (const k of keyChain(db, keyId)) {
    if (k.spend_cap_micro === null) continue;
    const h = k.spend_cap_micro - k.spent_micro;
    if (min === null || h < min) min = h;
  }
  return min;
}

export type ReserveResult =
  | { ok: true; reserved: bigint; balanceBefore: bigint; debits: { epoch: number; amount: bigint }[] }
  | { ok: false; type: "insufficient_credit" | "spend_cap_exceeded"; message: string; available: bigint };

export function reserve(
  db: Db,
  p: { requestId: string; keyId: string | null; addr: string; model: string; amount: bigint; now: number },
): ReserveResult {
  if (p.amount < 0n) throw new Error("reserve: negative amount");
  return db.tx(() => {
    const pools = spendablePools(db, p.addr, p.now);
    const balance = pools.reduce((s, x) => s + x.remaining, 0n);
    if (balance < p.amount || balance === 0n) {
      return { ok: false as const, type: "insufficient_credit" as const, available: balance, message: `need ${p.amount} micro-USD, have ${balance}` };
    }
    const chain = keyChain(db, p.keyId);
    for (const k of chain) {
      if (k.spend_cap_micro !== null && k.spent_micro + p.amount > k.spend_cap_micro) {
        return {
          ok: false as const, type: "spend_cap_exceeded" as const, available: k.spend_cap_micro - k.spent_micro,
          message: `key ${k.id} spend cap reached`,
        };
      }
    }
    const debits: { epoch: number; amount: bigint }[] = [];
    let left = p.amount;
    for (const pool of pools) {
      if (left === 0n) break;
      const take = pool.remaining < left ? pool.remaining : left;
      const r = db.run(
        "UPDATE grants SET remaining_micro = remaining_micro - ? WHERE epoch = ? AND addr = ? AND remaining_micro >= ?",
        take, pool.epoch, lc(p.addr), take,
      );
      if (r.changes !== 1) throw new Error("reserve: pool changed underneath");
      debits.push({ epoch: pool.epoch, amount: take });
      left -= take;
    }
    db.run(
      "INSERT INTO requests(id, key_id, addr, model, reserved_micro, status, created_at) VALUES (?,?,?,?,?, 'pending', ?)",
      p.requestId, p.keyId, lc(p.addr), p.model, p.amount, p.now,
    );
    for (const d of debits) db.run("INSERT INTO debits(request_id, epoch, amount_micro) VALUES (?,?,?)", p.requestId, d.epoch, d.amount);
    for (const k of chain) db.run("UPDATE keys SET spent_micro = spent_micro + ? WHERE id = ?", p.amount, k.id);
    return { ok: true as const, reserved: p.amount, balanceBefore: balance, debits };
  });
}

export interface FinalizeResult { cost: bigint; refunded: bigint; shortfall: bigint }

/** Settle a pending request at its real cost. Returns null if it was not pending. */
export function finalize(
  db: Db,
  requestId: string,
  p: { cost: bigint; inTokens: number; outTokens: number; now: number },
): FinalizeResult | null {
  return db.tx(() => {
    const req = db.getBig<{ addr: string; key_id: string | null; reserved_micro: bigint }>(
      "SELECT addr, key_id, reserved_micro FROM requests WHERE id = ? AND status = 'pending'", requestId,
    );
    if (!req) return null;
    const debits = db.allBig<{ epoch: bigint; amount_micro: bigint }>(
      "SELECT epoch, amount_micro FROM debits WHERE request_id = ? ORDER BY epoch ASC", requestId,
    );
    const reserved = debits.reduce((s, d) => s + d.amount_micro, 0n);
    let charged = 0n;
    let refunded = 0n;
    let shortfall = 0n;
    if (p.cost <= reserved) {
      let left = p.cost;
      for (const d of debits) {
        const keep = d.amount_micro < left ? d.amount_micro : left;
        const back = d.amount_micro - keep;
        left -= keep;
        if (back > 0n) {
          db.run("UPDATE grants SET remaining_micro = remaining_micro + ? WHERE epoch = ? AND addr = ?", back, d.epoch, req.addr);
          refunded += back;
        }
        if (keep === 0n) db.run("DELETE FROM debits WHERE request_id = ? AND epoch = ?", requestId, d.epoch);
        else db.run("UPDATE debits SET amount_micro = ? WHERE request_id = ? AND epoch = ?", keep, requestId, d.epoch);
      }
      charged = p.cost;
    } else {
      // usage exceeded the reservation (prompt estimate was low): take what we can, FIFO
      let extra = p.cost - reserved;
      for (const pool of spendablePools(db, req.addr, p.now)) {
        if (extra === 0n) break;
        const take = pool.remaining < extra ? pool.remaining : extra;
        db.run("UPDATE grants SET remaining_micro = remaining_micro - ? WHERE epoch = ? AND addr = ?", take, pool.epoch, req.addr);
        db.run(
          "INSERT INTO debits(request_id, epoch, amount_micro) VALUES (?,?,?) ON CONFLICT(request_id, epoch) DO UPDATE SET amount_micro = amount_micro + excluded.amount_micro",
          requestId, pool.epoch, take,
        );
        extra -= take;
      }
      shortfall = extra;
      charged = p.cost - shortfall;
    }
    for (const k of keyChain(db, req.key_id)) db.run("UPDATE keys SET spent_micro = spent_micro + ? WHERE id = ?", charged - reserved, k.id);
    db.run(
      "UPDATE requests SET status = 'ok', in_tokens = ?, out_tokens = ?, cost_micro = ?, finished_at = ? WHERE id = ?",
      p.inTokens, p.outTokens, charged, p.now, requestId,
    );
    return { cost: charged, refunded, shortfall };
  });
}

/** Refund every debit of a pending request (upstream error, client abort before any output, crash recovery). */
export function abort(db: Db, requestId: string, error: string, now: number): boolean {
  return db.tx(() => {
    const req = db.getBig<{ addr: string; key_id: string | null }>("SELECT addr, key_id FROM requests WHERE id = ? AND status = 'pending'", requestId);
    if (!req) return false;
    const debits = db.allBig<{ epoch: bigint; amount_micro: bigint }>("SELECT epoch, amount_micro FROM debits WHERE request_id = ?", requestId);
    let total = 0n;
    for (const d of debits) {
      db.run("UPDATE grants SET remaining_micro = remaining_micro + ? WHERE epoch = ? AND addr = ?", d.amount_micro, d.epoch, req.addr);
      total += d.amount_micro;
    }
    db.run("DELETE FROM debits WHERE request_id = ?", requestId);
    for (const k of keyChain(db, req.key_id)) db.run("UPDATE keys SET spent_micro = spent_micro - ? WHERE id = ?", total, k.id);
    db.run("UPDATE requests SET status = 'error', error = ?, cost_micro = 0, finished_at = ? WHERE id = ?", error.slice(0, 500), now, requestId);
    return true;
  });
}

/** crash recovery: refund requests left pending for longer than maxAgeS */
export function abortStale(db: Db, now: number, maxAgeS = 600, inFlight: ReadonlySet<string> = new Set()): number {
  const stale = db.all<{ id: string }>("SELECT id FROM requests WHERE status = 'pending' AND created_at < ?", now - maxAgeS)
    .filter((r) => !inFlight.has(r.id));
  for (const r of stale) abort(db, r.id, "abandoned (process restart or timeout)", now);
  return stale.length;
}
