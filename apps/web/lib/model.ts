/* The arithmetic the Basin runs (SPEC §1), as pure functions for Tide tables,
   the fee sankey and the depth ruler. Dollar figures are plain numbers here:
   these are models, not accounting. */
import { POOL_BPS, TREASURY_BPS, TRADER_FEE_BPS, VAULT_FEE_BPS, LAUNCHPAD_KEEP_BPS, TIERS } from "@ebb/shared";

export const SUPPLY = 1_000_000_000;
export const FLOOR = 100_000;
export const TIDES_PER_DAY = 48;

export interface FeeSplit {
  volume: number;
  tradersPay: number;
  pons: number; // what Pons keeps (30% of its 1% base fee)
  vault: number;
  pool: number;
  treasury: number;
}

export function feeSplit(volume: number): FeeSplit {
  // Pons v2: traders pay 3% (1% base + 2% creator tax); 2.7% reaches the Basin, Pons keeps 0.3%.
  const tradersPay = (volume * TRADER_FEE_BPS) / 10_000;
  const vault = (volume * VAULT_FEE_BPS) / 10_000;
  const pons = (volume * LAUNCHPAD_KEEP_BPS) / 10_000;
  const pool = (vault * POOL_BPS) / 10_000;
  const treasury = (vault * TREASURY_BPS) / 10_000;
  return { volume, tradersPay, pons, vault, pool, treasury };
}

export interface Almanac extends FeeSplit {
  eligible: number; // eligible supply, tokens
  share: number; // 0..1 of the pool
  eligibleForGrants: boolean;
  perTide: number;
  perDay: number;
  perWeek: number;
  aiPerWeek: number;
  burnPerWeek: number;
  poolAiPerDay: number;
  poolBurnPerDay: number;
}

export function almanac(input: { dailyVolume: number; holding: number; eligiblePct: number; spendShare: number }): Almanac {
  const fs = feeSplit(input.dailyVolume);
  const eligible = SUPPLY * Math.min(1, Math.max(0.01, input.eligiblePct));
  const eligibleForGrants = input.holding >= FLOOR;
  const share = eligibleForGrants ? Math.min(1, input.holding / eligible) : 0;
  const perDay = fs.pool * share;
  const perTide = perDay / TIDES_PER_DAY;
  const perWeek = perDay * 7;
  const s = Math.min(1, Math.max(0, input.spendShare));
  return {
    ...fs,
    eligible,
    share,
    eligibleForGrants,
    perTide,
    perDay,
    perWeek,
    aiPerWeek: perWeek * s,
    burnPerWeek: perWeek * (1 - s),
    poolAiPerDay: fs.pool * s,
    poolBurnPerDay: fs.pool * (1 - s),
  };
}

export function tierForTokens(n: number) {
  let t = TIERS[0];
  for (const tier of TIERS) if (n >= Number(tier.min / 10n ** 18n)) t = tier;
  return t;
}

/** Log-scale mapping helpers for sliders that span orders of magnitude. */
export function logToValue(t: number, min: number, max: number) {
  return Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min)));
}
export function valueToLog(v: number, min: number, max: number) {
  return (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));
}

/** Snap to 1–2–2.5–5 style "nice" numbers for readable dial values. */
export function nice(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
  let best = steps[0];
  for (const s of steps) if (Math.abs(s - m) < Math.abs(best - m)) best = s;
  return best * p;
}
