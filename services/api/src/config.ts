// Environment config (SPEC.md §5.1), validated with zod at boot.
import { z } from "zod";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { CHAIN_ID_MAINNET, CHAIN_ID_TESTNET, MICRO } from "@ebb/shared";
import { parseMicro } from "./money.js";

const optStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const optAddress = optStr.refine((v) => v === undefined || isAddress(v), "must be a 0x address")
  .transform((v) => (v ? getAddress(v) : undefined));

const optKey = optStr.refine((v) => v === undefined || /^0x[0-9a-fA-F]{64}$/.test(v), "must be a 0x-prefixed 32-byte hex key")
  .transform((v) => v as Hex | undefined);

const int = (def: number) => optStr.transform((v) => (v === undefined ? def : Number(v))).pipe(z.number().int().nonnegative());

const optBigint = (def: bigint) =>
  optStr.refine((v) => v === undefined || /^\d+$/.test(v), "must be a non-negative integer").transform((v) => (v === undefined ? def : BigInt(v)));

/** "auto" (default): Pons mode when the vault has `quote()`/`feeCurve()` and the curve is non-zero */
const ponsMode = optStr
  .transform((v) => (v === undefined ? "auto" : v.toLowerCase()))
  .pipe(z.enum(["auto", "true", "false", "1", "0", "yes", "no"]))
  .transform((v): boolean | "auto" => (v === "auto" ? "auto" : ["true", "1", "yes"].includes(v)));

/** RPC used when RPC_URL is unset */
export const DEFAULT_RPC: Record<number, string> = {
  [CHAIN_ID_MAINNET]: "https://rpc.mainnet.chain.robinhood.com",
  [CHAIN_ID_TESTNET]: "https://robinhood-sepolia-rpc.publicnode.com",
  31337: "http://127.0.0.1:8545",
};

/** pons v2 factory on Robinhood Chain mainnet (contracts/script/EbbMainnetBase.sol) */
export const PONS_FACTORY_MAINNET = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as Address;

const schema = z.object({
  EBB_MODE: optStr.pipe(z.enum(["sandbox", "chain"]).optional()),
  PORT: int(8787),
  HOST: optStr,
  DB_PATH: optStr.transform((v) => v ?? "./data/ebb.sqlite"),
  RPC_URL: optStr,
  CHAIN_ID: int(CHAIN_ID_TESTNET).refine((v) => v === CHAIN_ID_MAINNET || v === CHAIN_ID_TESTNET || v === 31337, "CHAIN_ID must be 4663, 46630 (or 31337 for a local anvil)"),
  VAULT_ADDRESS: optAddress,
  TOKEN_ADDRESS: optAddress,
  USDG_ADDRESS: optAddress,
  DEPLOY_BLOCK: optStr.transform((v) => (v === undefined ? undefined : BigInt(v))),
  OPERATOR_PRIVATE_KEY: optKey,
  KEEPER_PRIVATE_KEY: optKey,
  EXCLUDED_ADDRESSES: optStr.transform((v) =>
    (v ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      if (!isAddress(s)) throw new Error(`EXCLUDED_ADDRESSES: bad address ${s}`);
      return getAddress(s);
    }),
  ),
  UPSTREAMS_JSON: optStr.transform((v) => v ?? "./upstreams.json"),
  WEB_ORIGIN: optStr.transform((v) => (v ?? "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean)),
  SIWE_DOMAIN: optStr.transform((v) => v ?? "localhost:3000"),
  SESSION_SECRET: optStr,
  // tuning
  INDEXER_INTERVAL_MS: int(5_000),
  INDEXER_BATCH_BLOCKS: int(2_000),
  INDEXER_LAG_BLOCKS: int(3),
  ALLOCATOR_DELAY_S: int(60),
  KEEPER_INTERVAL_MS: int(600_000),
  SETTLEMENT_INTERVAL_MS: int(3_600_000),
  PUBLISHER_INTERVAL_MS: int(30_000),
  KEEPER_HARVEST_MIN_WEI: optBigint(1_000_000_000_000_000n), // 0.001 ETH (legacy / testnet vaults only)
  BURN_SLICE_MICRO: optBigint(50n * MICRO), // maxAmount per burnExpired call ($50)
  BURN_MAX_SLICES: int(10), // burnExpired calls per tide per keeper round
  // Pons v2 (mainnet)
  PONS_MODE: ponsMode,
  POKE_TWAP_ADDRESS: optAddress,
  POKE_INTERVAL_MS: int(155_000),
  HARVEST_OFFSET_S: int(300), // harvest once per tide at :05 / :35
  PONS_FACTORY_ADDRESS: optAddress,
  MONITOR_INTERVAL_MS: int(60_000),
  MONITOR_BATCH_BLOCKS: int(50_000),
  DEFAULT_MAX_TOKENS: int(1024),
  // sandbox
  SANDBOX_HOLDERS: int(40),
  SANDBOX_SEED_TIDES: int(12),
  SANDBOX_TICK_MS: int(15_000),
  SANDBOX_WELCOME_CREDIT: optStr.transform((v) => parseMicro(v ?? "2.00")),
  LOG_LEVEL: optStr.pipe(z.enum(["debug", "info", "warn", "error"]).optional()),
});

export type Mode = "sandbox" | "chain";

export interface Config {
  mode: Mode;
  port: number;
  host: string | undefined;
  dbPath: string;
  rpcUrl: string;
  chainId: number;
  vault: Address | undefined;
  token: Address | undefined;
  usdg: Address | undefined;
  deployBlock: bigint | undefined;
  operatorKey: Hex | undefined;
  keeperKey: Hex | undefined;
  excluded: Address[];
  upstreamsPath: string;
  webOrigins: string[];
  siweDomain: string;
  sessionSecret: string | undefined;
  indexerIntervalMs: number;
  indexerBatchBlocks: number;
  indexerLagBlocks: number;
  allocatorDelayS: number;
  keeperIntervalMs: number;
  settlementIntervalMs: number;
  publisherIntervalMs: number;
  keeperHarvestMinWei: bigint;
  burnSliceMicro: bigint;
  burnMaxSlices: number;
  /** true / false, or "auto" = decided at boot from the vault (see ChainBasin.connect) */
  ponsMode: boolean | "auto";
  pokeTwap: Address | undefined;
  pokeIntervalMs: number;
  harvestOffsetS: number;
  ponsFactory: Address | undefined;
  monitorIntervalMs: number;
  monitorBatchBlocks: number;
  defaultMaxTokens: number;
  sandbox: { holders: number; seedTides: number; tickMs: number; welcomeCredit: bigint };
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${msg}`);
  }
  const e = parsed.data;
  const mode: Mode = e.EBB_MODE ?? (e.VAULT_ADDRESS ? "chain" : "sandbox");
  if (mode === "chain") {
    const missing = (["VAULT_ADDRESS", "TOKEN_ADDRESS"] as const).filter((k) => !e[k]);
    if (missing.length) throw new Error(`EBB_MODE=chain requires ${missing.join(", ")}`);
    if (!e.SESSION_SECRET || e.SESSION_SECRET.length < 32) throw new Error("EBB_MODE=chain requires SESSION_SECRET (>= 32 chars)");
    if (e.BURN_SLICE_MICRO === 0n) throw new Error("BURN_SLICE_MICRO must be > 0");
  }
  return {
    mode,
    port: e.PORT,
    host: e.HOST,
    dbPath: e.DB_PATH,
    rpcUrl: e.RPC_URL ?? DEFAULT_RPC[e.CHAIN_ID],
    chainId: e.CHAIN_ID,
    vault: e.VAULT_ADDRESS,
    token: e.TOKEN_ADDRESS,
    usdg: e.USDG_ADDRESS,
    deployBlock: e.DEPLOY_BLOCK,
    operatorKey: e.OPERATOR_PRIVATE_KEY,
    keeperKey: e.KEEPER_PRIVATE_KEY,
    excluded: e.EXCLUDED_ADDRESSES,
    upstreamsPath: e.UPSTREAMS_JSON,
    webOrigins: e.WEB_ORIGIN,
    siweDomain: e.SIWE_DOMAIN,
    sessionSecret: e.SESSION_SECRET,
    indexerIntervalMs: e.INDEXER_INTERVAL_MS,
    indexerBatchBlocks: Math.max(1, e.INDEXER_BATCH_BLOCKS),
    indexerLagBlocks: e.INDEXER_LAG_BLOCKS,
    allocatorDelayS: e.ALLOCATOR_DELAY_S,
    keeperIntervalMs: e.KEEPER_INTERVAL_MS,
    settlementIntervalMs: e.SETTLEMENT_INTERVAL_MS,
    publisherIntervalMs: e.PUBLISHER_INTERVAL_MS,
    keeperHarvestMinWei: e.KEEPER_HARVEST_MIN_WEI,
    burnSliceMicro: e.BURN_SLICE_MICRO,
    burnMaxSlices: Math.max(1, e.BURN_MAX_SLICES),
    ponsMode: e.PONS_MODE,
    pokeTwap: e.POKE_TWAP_ADDRESS,
    pokeIntervalMs: Math.max(30_000, e.POKE_INTERVAL_MS),
    harvestOffsetS: Math.min(e.HARVEST_OFFSET_S, 1_799),
    ponsFactory: e.PONS_FACTORY_ADDRESS ?? (e.CHAIN_ID === CHAIN_ID_MAINNET ? PONS_FACTORY_MAINNET : undefined),
    monitorIntervalMs: Math.max(5_000, e.MONITOR_INTERVAL_MS),
    monitorBatchBlocks: Math.max(1, e.MONITOR_BATCH_BLOCKS),
    defaultMaxTokens: Math.max(16, e.DEFAULT_MAX_TOKENS),
    sandbox: {
      holders: e.SANDBOX_HOLDERS,
      seedTides: e.SANDBOX_SEED_TIDES,
      tickMs: Math.max(1000, e.SANDBOX_TICK_MS),
      welcomeCredit: e.SANDBOX_WELCOME_CREDIT,
    },
    logLevel: e.LOG_LEVEL ?? "info",
  };
}
