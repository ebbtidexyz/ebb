// Allocator (SPEC.md §5.3): after each tide ends, split its booked USDG pro-rata by TWAB,
// commit the Merkle root on-chain and open the tidepools. The same code runs in sandbox.
import { GRANT_FLOOR } from "@ebb/shared";
import { getAddress, type Hex } from "viem";
import type { Ctx } from "../context.js";
import { twabAll } from "../core/twab.js";
import { allocate } from "../core/allocate.js";
import { buildGrantTree } from "../core/merkle.js";
import { ensureEpoch, pointsForWindow } from "../core/records.js";
import { errMsg, logger } from "../log.js";

const log = logger("allocator");
export const ALLOCATOR_CURSOR = "allocator_next";

export type AllocateOutcome = "committed" | "empty" | "already" | "wait" | "failed";

export async function allocateTide(ctx: Ctx, epoch: number, now: number): Promise<AllocateOutcome> {
  const { db, basin, clock } = ctx;
  const start = clock.start(epoch);
  const end = clock.end(epoch);
  if (now < end + ctx.cfg.allocatorDelayS) return "wait";
  if (basin.indexedThrough() < end) {
    log.debug(`tide ${epoch}: indexer behind tide end, waiting`, { indexed: basin.indexedThrough(), end });
    return "wait";
  }

  const row = db.get<{ status: string; root: string | null }>("SELECT status, root FROM epochs WHERE n = ?", epoch);
  if (row && ["committed", "expired", "burned"].includes(row.status)) return "already";

  if (row?.status === "committing") {
    // a previous run stored the tree and may have sent the tx; reconcile with the chain first
    const onchain = await basin.readCommittedRoot(epoch);
    if (onchain && onchain.toLowerCase() === row.root?.toLowerCase()) {
      db.run("UPDATE epochs SET status = 'committed' WHERE n = ?", epoch);
      log.info(`tide ${epoch}: commit found on-chain, pools open`);
      return "committed";
    }
    if (onchain) {
      log.error(`tide ${epoch}: on-chain root ${onchain} differs from local ${row.root}; pools stay closed`);
      return "failed";
    }
  }

  const booked = await basin.readBooked(epoch);
  const points = pointsForWindow(db, start, end);
  const twabs = twabAll(points, start, end);
  const alloc = allocate(booked, twabs, { floor: GRANT_FLOOR, excluded: ctx.excluded });

  if (booked === 0n && !row) return "empty"; // nothing flowed in; no logbook entry
  if (alloc.grants.length === 0) {
    db.tx(() => {
      ensureEpoch(db, clock, epoch);
      db.run("UPDATE epochs SET booked_micro = ?, granted_micro = 0, wallets = 0, root = NULL, status = 'committed' WHERE n = ?", booked, epoch);
    });
    log.info(`tide ${epoch}: no eligible holders, ${booked} micro-USD stays and burns at expiry`);
    return "empty";
  }

  const tree = buildGrantTree(epoch, alloc.grants);
  const root = tree.root as Hex;
  const expiresAt = clock.expiresAt(epoch);
  db.tx(() => {
    ensureEpoch(db, clock, epoch);
    db.run(
      "UPDATE epochs SET booked_micro = ?, granted_micro = ?, wallets = ?, root = ?, status = 'committing' WHERE n = ?",
      booked, alloc.total, alloc.grants.length, root, epoch,
    );
    db.run("INSERT INTO trees(epoch, dump) VALUES (?, ?) ON CONFLICT(epoch) DO UPDATE SET dump = excluded.dump", epoch, JSON.stringify(tree.dump()));
    db.run("DELETE FROM grants WHERE epoch = ?", epoch);
    for (const g of alloc.grants) {
      db.run(
        "INSERT INTO grants(epoch, addr, amount_micro, remaining_micro, expires_at) VALUES (?,?,?,?,?)",
        epoch, g.addr.toLowerCase(), g.amount, g.amount, expiresAt,
      );
    }
  });

  try {
    const tx = await basin.commitGrants(epoch, root, alloc.total, alloc.grants.map((g) => getAddress(g.addr)));
    db.run("UPDATE epochs SET status = 'committed', committed_tx = ? WHERE n = ?", tx, epoch);
    log.info(`tide ${epoch}: flood committed`, { booked, granted: alloc.total, dust: alloc.dust, wallets: alloc.grants.length, root, tx });
    return "committed";
  } catch (e) {
    log.error(`tide ${epoch}: commitGrants failed; pools stay closed until it lands`, { error: errMsg(e) });
    return "failed";
  }
}

/** process every ended tide from the cursor up to the previous tide */
export async function runAllocator(ctx: Ctx, now = ctx.now()): Promise<void> {
  const current = ctx.clock.epochAt(now);
  let next = Number(ctx.db.getCursor(ALLOCATOR_CURSOR) ?? Math.max(0, current - 1));
  for (let i = 0; next < current && i < 50; i++) {
    const r = await allocateTide(ctx, next, now);
    if (r === "wait" || r === "failed") break;
    next++;
    ctx.db.setCursor(ALLOCATOR_CURSOR, next);
  }
}
