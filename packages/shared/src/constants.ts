// Single source of truth: SPEC.md §1. Contracts mirror these as Solidity constants.
export const CHAIN_ID_MAINNET = 4663;
export const CHAIN_ID_TESTNET = 46630;

export const EPOCH_SECONDS = 1800; // one tide
export const EXPIRY_EPOCHS = 336; // 7 days
export const EXPIRY_SECONDS = EPOCH_SECONDS * EXPIRY_EPOCHS;

export const POOL_BPS = 7000;
export const TREASURY_BPS = 3000;
export const MAX_DEVIATION_BPS = 300;
export const TWAP_WINDOW = 1800;
export const CALLER_TIP_BPS = 25;
export const CALLER_TIP_CAP_MICRO = 2_000_000n;

export const TOKEN_DECIMALS = 18;
export const USDG_DECIMALS = 6;
export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const GRANT_FLOOR = 100_000n * 10n ** 18n;

export const MICRO = 1_000_000n; // 1 USD in micro-dollars

// Pons v2 launchpad economics (not ours; set by Pons at launch, used for tide tables).
// Every trade, on the curve and after graduation alike, pays a 1% Pons base fee + a 2% $EBB creator tax = 3%.
// The base fee splits 30% Pons / 70% creator; the creator gets 100% of the tax. Creator = EbbVault (the Basin).
export const PONS_BASE_FEE_BPS = 100; // 1% base fee on every trade
export const CREATOR_TAX_BPS = 200; // 2% $EBB creator tax on every trade
export const PONS_BASE_FEE_CREATOR_SHARE_BPS = 7000; // 70% of the base fee goes to the creator, 30% to Pons
export const TRADER_FEE_BPS = 300; // 3% total paid by traders (1% base + 2% tax)
export const VAULT_FEE_BPS = 270; // 2.7% of volume reaches the Basin (0.7% of base fee + 2% tax), paid in ETH
export const LAUNCHPAD_KEEP_BPS = 30; // 0.3% of volume kept by Pons (30% of the 1% base fee)

// Pons v2 launch terms for $EBB (informational)
export const PONS_PHANTOM_RESERVE_ETH = 1.68; // bonding-curve virtual ETH reserve
export const PONS_GRADUATION_ETH = 4.2; // ETH collected on the curve before it graduates to a Uniswap v4 pool

export const TREASURY_SPLIT = [
  { key: "operations", label: "Operations", pct: 35, note: "servers, indexing, monitoring" },
  { key: "float", label: "Provider float", pct: 20, note: "prepaid balance, so credits never wait" },
  { key: "demo", label: "Free demo", pct: 15, note: "the chat on the landing page, capped" },
  { key: "growth", label: "Growth", pct: 20, note: "creators, dev communities, bounties" },
  { key: "reserve", label: "Reserve", pct: 10, note: "audits, incident fund" },
] as const;

export type TierId = "shore" | "reef" | "shelf" | "abyss";
export const TIERS: readonly {
  id: TierId; label: string; min: bigint; rpm: number; concurrent: number; perks: readonly string[];
}[] = [
  { id: "shore", label: "Shore", min: 0n, rpm: 10, concurrent: 2, perks: ["Spends credit already held", "Logbook, soundings and docs"] },
  { id: "reef", label: "Reef", min: 100_000n * 10n ** 18n, rpm: 60, concurrent: 8, perks: ["Tides every 30 minutes, pro-rata", "Usage dashboard and ebb view"] },
  { id: "shelf", label: "Shelf", min: 1_000_000n * 10n ** 18n, rpm: 120, concurrent: 16, perks: ["Everything in Reef", "Shelf badge on share cards"] },
  { id: "abyss", label: "Abyss", min: 10_000_000n * 10n ** 18n, rpm: 240, concurrent: 32, perks: ["Everything in Shelf", "New models first", "Name on the depth wall"] },
];

export function tierFor(balance: bigint) {
  let t = TIERS[0];
  for (const tier of TIERS) if (balance >= tier.min) t = tier;
  return t;
}

export function epochAt(unixSeconds: number, genesis: number): number {
  return Math.floor((unixSeconds - genesis) / EPOCH_SECONDS);
}

export function epochStart(epoch: number, genesis: number): number {
  return genesis + epoch * EPOCH_SECONDS;
}

/** micro-dollars (bigint) -> "12.345678" */
export function microToDecimal(micro: bigint): string {
  const neg = micro < 0n;
  const v = neg ? -micro : micro;
  const s = `${v / MICRO}.${(v % MICRO).toString().padStart(6, "0")}`;
  return neg ? `-${s}` : s;
}
