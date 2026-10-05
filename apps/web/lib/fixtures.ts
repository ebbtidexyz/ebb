/* Development-only fixtures for the landing counters, used when the API is
   not running. Never shipped as real data: callers must check IS_DEV and
   label the figures as a fixture. */
import type { StatsResponse, SoundingsResponse } from "@ebb/shared";

const GENESIS = Date.UTC(2026, 8, 26, 12, 0, 0) / 1000;

export function statsFixture(nowMs = Date.now()): StatsResponse {
  const now = nowMs / 1000;
  const current = Math.max(0, Math.floor((now - GENESIS) / 1800));
  const startsAt = GENESIS + current * 1800;
  return {
    sandbox: true,
    tide: { current, starts_at: new Date(startsAt * 1000).toISOString(), next_at: new Date((startsAt + 1800) * 1000).toISOString() },
    last_24h: { granted: "4210.552100", used: "688.120400", expired: "0.000000", requests: 18234, wallets: 412 },
    all_time: {
      granted: "27984.310922",
      used: "4402.875510",
      expired: "1220.402200",
      requests: 120554,
      wallets: 611,
      tides: current,
      burned_ebb: "3184220.500000",
      burned_usdg: "1217.351200",
      burns: 14,
    },
    block: null,
  };
}

export function soundingsFixture(): SoundingsResponse {
  return {
    sandbox: true,
    vault_usdg: "22361.035212",
    open_credits: "22297.811900",
    unsettled_used: "63.223312",
    difference: "0.000000",
    block: null,
    addresses: { vault: null, token: null, usdg: null, treasury: null, settlement: null },
  };
}
