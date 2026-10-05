// Keeper (SPEC.md §5.3).
//   runKeeper (every KEEPER_INTERVAL_MS, 10 min): reap stale reservations; legacy vaults: harvest() when the vault
//     holds ETH; burnExpired() for every expired tide with remaining USDG, in BURN_SLICE_MICRO slices (at most
//     BURN_MAX_SLICES per tide per round). The first failing slice ends that tide for the round: Pons burns fail
//     closed before 30 min of TWAP history, in the Swept/Rescued phases, or when the price is pushed off the TWAP.
//   runTideHarvest (Pons mode, checked every minute): harvest() once per tide at HARVEST_OFFSET_S (:05 / :35).
//   runPoke (Pons mode, every POKE_INTERVAL_MS ≈ 155 s): PokeTwapOracle.poke() when a feed is due.
import type { Ctx } from "../context.js";
import type { HarvestOutcome } from "../chain/basin.js";
import type { PokeOutcome } from "../chain/pons.js";
import { abortStale } from "../gateway/ledger.js";
import { burnSlices, harvestDue } from "../core/keeperPlan.js";
import { errMsg, logger } from "../log.js";

const log = logger("keeper");
export const HARVEST_CURSOR = "keeper_harvest_tide";

export interface BurnReport { epoch: number; slices: number; burned: bigint; stopped: string | null }

export async function runKeeper(ctx: Ctx, now = ctx.now()): Promise<BurnReport[]> {
  const reaped = abortStale(ctx.db, now, 600, ctx.inFlight);
  if (reaped) log.warn(`refunded ${reaped} abandoned reservation(s)`);

  // Pons vaults harvest once per tide from runTideHarvest instead
  if (!ctx.pons) {
    try {
      logHarvest(await ctx.basin.harvest());
    } catch (e) {
      log.error("harvest failed", { error: errMsg(e) });
    }
  }

  // epochs whose 7 days are up and that still hold USDG
  const cutoff = now - (ctx.clock.expiresAt(0) - ctx.clock.start(0));
  const due = ctx.db.all<{ n: number; status: string }>(
    "SELECT n, status FROM epochs WHERE status != 'burned' AND starts_at <= ? ORDER BY n", cutoff,
  );
  const reports: BurnReport[] = [];
  for (const { n, status } of due) {
    let rem: bigint;
    try {
      rem = await ctx.basin.remaining(n);
    } catch (e) {
      log.error(`remaining(${n}) failed`, { error: errMsg(e) });
      continue;
    }
    if (rem === 0n) {
      ctx.db.run("UPDATE epochs SET status = 'burned' WHERE n = ?", n);
      ctx.db.run("UPDATE grants SET remaining_micro = 0 WHERE epoch = ?", n);
      continue;
    }
    if (status !== "expired") ctx.db.run("UPDATE epochs SET status = 'expired' WHERE n = ?", n);
    reports.push(await burnTide(ctx, n, rem));
  }
  return reports;
}

/** slices for one tide; stops for this round at the first failure (no retry until the next keeper round) */
async function burnTide(ctx: Ctx, n: number, rem: bigint): Promise<BurnReport> {
  const r: BurnReport = { epoch: n, slices: 0, burned: 0n, stopped: null };
  for (const slice of burnSlices(rem, ctx.cfg.burnSliceMicro, ctx.cfg.burnMaxSlices)) {
    try {
      const tx = await ctx.basin.burnExpired(n, slice);
      if (!tx) break; // no keeper key / nothing to do
      r.slices++;
      r.burned += slice;
      log.info(`tide ${n}: drawn into the Trench`, { usdg: slice, tx });
    } catch (e) {
      r.stopped = errMsg(e);
      log.warn(`tide ${n}: burnExpired(${slice}) failed; not retrying this tide until the next keeper round`, { error: r.stopped, burnedThisRound: r.burned });
      break;
    }
  }
  return r;
}

function logHarvest(h: HarvestOutcome) {
  if (h.kind === "sent") {
    const ev = h.event;
    log.info("harvested", ev
      ? { tx: h.tx, tide: ev.epoch, ethIn: ev.ethIn, usdgOut: ev.usdgOut, booked: ev.toPool, toTreasury: ev.toTreasury }
      : { tx: h.tx, note: "no Harvested event (nothing new reached the vault)" });
  } else if (h.kind === "reverted") {
    log.warn("harvest would revert; skipped", { reason: h.reason });
  } else {
    log.debug(`harvest skipped: ${h.reason}`);
  }
}

/**
 * Pons mode: one harvest per tide, HARVEST_OFFSET_S after it starts. A done/skipped/reverted attempt marks the
 * tide; a transport error does not, so the next minute retries.
 */
export async function runTideHarvest(ctx: Ctx, now = ctx.now()): Promise<HarvestOutcome | null> {
  const last = ctx.db.getCursor(HARVEST_CURSOR);
  const epoch = harvestDue(ctx.clock, now, last === undefined ? null : Number(last), ctx.cfg.harvestOffsetS);
  if (epoch === null) return null;
  const h = await ctx.basin.harvest();
  ctx.db.setCursor(HARVEST_CURSOR, epoch);
  logHarvest(h);
  return h;
}

/** Pons mode: keep the 30-min poke TWAP fed (the vault's $EBB price for burns) */
export async function runPoke(ctx: Ctx, state: { lastReason?: string } = pokeState): Promise<PokeOutcome | null> {
  if (!ctx.pons) return null;
  const p = await ctx.pons.poke();
  if (p.kind === "sent") {
    log.info("poked TWAP", { tx: p.tx });
    state.lastReason = undefined;
  } else if (p.kind === "skipped") {
    log.debug(`poke skipped: ${p.reason}`);
  } else if (state.lastReason !== p.reason) {
    // reverted (e.g. curve not live before launch) or disabled: say it once per distinct reason, then stay quiet
    (p.kind === "disabled" ? log.warn : log.info)(`poke ${p.kind}: ${p.reason}`);
    state.lastReason = p.reason;
  }
  return p;
}
const pokeState: { lastReason?: string } = {};
