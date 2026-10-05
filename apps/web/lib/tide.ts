import { EPOCH_SECONDS, EXPIRY_SECONDS } from "@ebb/shared";
import type { StatsResponse } from "@ebb/shared";
import { toUnix } from "./format";

export interface TideClock {
  /** unix seconds */
  now: number;
  /** tide number, or null before we know genesis */
  tide: number | null;
  /** seconds since the current tide began */
  into: number;
  /** seconds until the next :00 / :30 */
  left: number;
  /** unix seconds of the next flood */
  next: number;
  /** 0..1 through the current tide */
  frac: number;
}

export function tideClock(nowMs: number, genesis: number | null): TideClock {
  const now = nowMs / 1000;
  const into = ((now % EPOCH_SECONDS) + EPOCH_SECONDS) % EPOCH_SECONDS;
  const next = Math.round(now - into + EPOCH_SECONDS);
  const tide = genesis !== null && now >= genesis ? Math.floor((now - genesis) / EPOCH_SECONDS) : null;
  return { now, tide, into, left: EPOCH_SECONDS - into, next, frac: into / EPOCH_SECONDS };
}

/** Genesis (unix s) recovered from /api/stats: starts_at − current × 1800. */
export function genesisFromStats(s: StatsResponse | undefined | null): number | null {
  if (!s?.tide) return null;
  const start = toUnix(s.tide.starts_at);
  if (start === null || !Number.isFinite(s.tide.current)) return null;
  return start - s.tide.current * EPOCH_SECONDS;
}

/** 0..1 of a pool's seven-day life that is left. */
export function ebbFraction(expiresAt: number, nowSec: number): number {
  return Math.min(1, Math.max(0, (expiresAt - nowSec) / EXPIRY_SECONDS));
}
