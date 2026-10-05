// DB writes shared by chain indexer and sandbox world. Addresses are stored lowercase.
import type { Db } from "../db/index.js";
import type { TideClock } from "./tides.js";

export const lc = (a: string) => a.toLowerCase();

export function ensureEpoch(db: Db, clock: TideClock, n: number): void {
  db.run("INSERT OR IGNORE INTO epochs(n, starts_at) VALUES (?, ?)", n, clock.start(n));
}

export interface HarvestRecord {
  tx: string; logIndex: number; epoch: number; block: number | null; ts: number;
  ethIn: bigint; usdgOut: bigint; toPool: bigint; toTreasury: bigint;
}

/** idempotent by (tx, logIndex); adds toPool to epochs.booked_micro */
export function recordHarvest(db: Db, clock: TideClock, h: HarvestRecord): boolean {
  return db.tx(() => {
    const r = db.run(
      "INSERT OR IGNORE INTO harvests(tx, log_index, epoch, block, ts, eth_in, usdg_out, to_pool, to_treasury) VALUES (?,?,?,?,?,?,?,?,?)",
      h.tx, h.logIndex, h.epoch, h.block, h.ts, h.ethIn.toString(), h.usdgOut, h.toPool, h.toTreasury,
    );
    if (r.changes === 0) return false;
    ensureEpoch(db, clock, h.epoch);
    db.run("UPDATE epochs SET booked_micro = booked_micro + ? WHERE n = ?", h.toPool, h.epoch);
    return true;
  });
}

export interface BurnRecord {
  tx: string; logIndex: number; epoch: number; block: number | null; ts: number;
  usdgIn: bigint; ebbBurned: bigint; caller: string; tip: bigint;
}

/**
 * idempotent by (tx, logIndex). `onchain` (when known) is the authoritative epoch state read
 * after the burn, so the DB never has to guess whether usdgIn includes the tip.
 */
export function recordBurn(db: Db, clock: TideClock, b: BurnRecord, onchain?: { burned: bigint; withdrawn: bigint; remaining: bigint }): boolean {
  return db.tx(() => {
    const r = db.run(
      "INSERT OR IGNORE INTO burns(tx, log_index, epoch, block, ts, usdg_in, ebb_burned, caller, tip_micro) VALUES (?,?,?,?,?,?,?,?,?)",
      b.tx, b.logIndex, b.epoch, b.block, b.ts, b.usdgIn, b.ebbBurned.toString(), lc(b.caller), b.tip,
    );
    if (r.changes === 0) return false;
    ensureEpoch(db, clock, b.epoch);
    const row = db.getBig<{ burned_micro: bigint; ebb_burned: string; booked_micro: bigint; withdrawn_micro: bigint }>(
      "SELECT burned_micro, ebb_burned, booked_micro, withdrawn_micro FROM epochs WHERE n = ?", b.epoch,
    )!;
    const burned = onchain ? onchain.burned : row.burned_micro + b.usdgIn;
    const withdrawn = onchain ? onchain.withdrawn : row.withdrawn_micro;
    const remaining = onchain ? onchain.remaining : row.booked_micro - withdrawn - burned;
    db.run(
      "UPDATE epochs SET burned_micro = ?, withdrawn_micro = ?, ebb_burned = ?, burn_tx = ?, status = CASE WHEN ? <= 0 THEN 'burned' ELSE 'expired' END WHERE n = ?",
      burned, withdrawn, (BigInt(row.ebb_burned) + b.ebbBurned).toString(), b.tx, remaining, b.epoch,
    );
    // whatever was left in the tidepools went into the Trench
    db.run("UPDATE grants SET remaining_micro = 0 WHERE epoch = ?", b.epoch);
    return true;
  });
}

/** latest balance (wei) for an address */
export function latestBalance(db: Db, addr: string): bigint {
  const r = db.get<{ balance: string }>("SELECT balance FROM balance_points WHERE addr = ? ORDER BY block DESC LIMIT 1", lc(addr));
  return r ? BigInt(r.balance) : 0n;
}

/** upsert the balance of `addr` after block `block` (one point per (addr, block); last write wins) */
export function setBalancePoint(db: Db, addr: string, block: number, ts: number, balance: bigint): void {
  db.run(
    "INSERT INTO balance_points(addr, block, ts, balance) VALUES (?,?,?,?) ON CONFLICT(addr, block) DO UPDATE SET balance = excluded.balance, ts = excluded.ts",
    lc(addr), block, ts, balance.toString(),
  );
}

/** points needed for TWAB over [start, end): opening point (latest <= start) + all points inside */
export function pointsForWindow(db: Db, start: number, end: number): { addr: string; ts: number; balance: bigint }[] {
  const rows = db.all<{ addr: string; ts: number; balance: string }>(
    `SELECT bp.addr, bp.ts, bp.balance FROM balance_points bp
       JOIN (SELECT addr, MAX(block) AS b FROM balance_points WHERE ts <= ? GROUP BY addr) o
         ON o.addr = bp.addr AND o.b = bp.block
     UNION ALL
     SELECT addr, ts, balance FROM balance_points WHERE ts > ? AND ts < ?
     ORDER BY 1, 2`,
    start, start, end,
  );
  return rows.map((r) => ({ addr: r.addr, ts: r.ts, balance: BigInt(r.balance) }));
}
