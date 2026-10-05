// Pure scheduling decisions for the keeper (unit-tested in test/keeper.test.ts).
import type { TideClock } from "./tides.js";

export interface FeedSample {
  /** observations written so far (0 = never poked) */
  count: number;
  /** timestamp of the newest observation */
  lastTs: number;
}

/**
 * PokeTwapOracle.poke() only records a feed whose newest sample is at least `minInterval` old (otherwise it is a
 * silent no-op that still costs gas), so poke only when at least one feed is due at `nowTs` (chain time).
 */
export function pokeDue(feeds: readonly FeedSample[], minInterval: number, nowTs: number): boolean {
  return feeds.some((f) => f.count === 0 || nowTs >= f.lastTs + minInterval);
}

/**
 * Pons mode harvests once per tide, `offsetS` seconds after the tide starts (:05 / :35 by default). Returns the
 * tide to harvest for, or null when it is too early in the tide, before genesis, or this tide was already done.
 * A process that starts late in a tide harvests right away (catch-up).
 */
export function harvestDue(clock: TideClock, now: number, lastDone: number | null, offsetS: number): number | null {
  const e = clock.epochAt(now);
  if (e < 0) return null;
  if (now - clock.start(e) < offsetS) return null;
  if (lastDone !== null && lastDone >= e) return null;
  return e;
}

/**
 * burnExpired slices for one tide in one keeper round: at most `maxSlices` calls of at most `slice` each.
 * The keeper stops at the first failing slice (see runKeeper), so this is an upper bound.
 */
export function burnSlices(remaining: bigint, slice: bigint, maxSlices: number): bigint[] {
  const out: bigint[] = [];
  let left = remaining;
  while (left > 0n && out.length < maxSlices) {
    const s = left < slice ? left : slice;
    out.push(s);
    left -= s;
  }
  return out;
}
