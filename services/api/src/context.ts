// Everything a route or worker needs, built once at boot.
import type { Config } from "./config.js";
import type { Db } from "./db/index.js";
import type { Basin } from "./chain/basin.js";
import type { TideClock } from "./core/tides.js";
import type { UpstreamRegistry } from "./gateway/upstreams.js";
import type { RateLimiter } from "./gateway/ratelimit.js";
import type { Pub } from "./chain/clients.js";
import type { SandboxWorld } from "./sandbox/world.js";
import type { PonsChain } from "./chain/pons.js";

export interface WorkerStatus { last_run: number | null; last_ok: number | null; last_error: string | null; runs: number }

export interface Ctx {
  cfg: Config;
  db: Db;
  basin: Basin;
  clock: TideClock;
  upstreams: UpstreamRegistry;
  limiter: RateLimiter;
  /** public client in chain mode (SIWE smart-wallet checks, soundings) */
  pub: Pub | null;
  world: SandboxWorld | null;
  /** Pons v2 vault extras (mainnet); null for sandbox and legacy/testnet vaults */
  pons: PonsChain | null;
  sessionSecret: string;
  /** lowercase addresses never eligible for grants and hidden from the depth wall */
  excluded: Set<string>;
  /** request ids currently streaming (never reaped as stale) */
  inFlight: Set<string>;
  workers: Map<string, WorkerStatus>;
  startedAt: number;
  now(): number;
}

export const isSandbox = (ctx: Ctx) => ctx.cfg.mode === "sandbox";

const HALT_KEY = "settlement_halted";
export function settlementHalted(ctx: Ctx): string | null {
  const v = ctx.db.getCursor(HALT_KEY);
  return v ? v : null;
}
export function setSettlementHalted(ctx: Ctx, reason: string | null): void {
  ctx.db.setCursor(HALT_KEY, reason ?? "");
}
