// The Basin: everything workers need from "the chain". Two implementations:
//   ChainBasin   (src/chain/chainBasin.ts)  — EbbVault on Robinhood Chain via viem
//   SandboxBasin (src/sandbox/basin.ts)     — simulated, backed by the DB
// Allocator / keeper / settlement run the same code against either.
import type { Address, Hex } from "viem";

export interface BasinAddresses {
  vault: Address | null;
  token: Address | null;
  usdg: Address | null;
  treasury: Address | null;
  settlement: Address | null;
}

/** decoded vault `Harvested` event */
export interface HarvestedEvent { epoch: number; ethIn: bigint; usdgOut: bigint; toPool: bigint; toTreasury: bigint }

export type HarvestOutcome =
  | { kind: "sent"; tx: Hex; event: HarvestedEvent | null }
  /** nothing done on purpose: no keeper key, below threshold, nothing pending */
  | { kind: "skipped"; reason: string }
  /** simulation reverted, nothing sent */
  | { kind: "reverted"; reason: string };

export interface Basin {
  readonly kind: "sandbox" | "chain";
  readonly genesis: number;
  readonly addresses: BasinAddresses;
  /** balance_points are complete for every timestamp < this value */
  indexedThrough(): number;
  /** latest known block (indexer head in chain mode, simulated in sandbox) */
  headBlock(): number | null;
  /** epochs(e).booked on the vault, micro-dollars */
  readBooked(epoch: number): Promise<bigint>;
  /** epochs(e).grantRoot, null when zero */
  readCommittedRoot(epoch: number): Promise<Hex | null>;
  commitGrants(epoch: number, root: Hex, total: bigint, wallets: Address[]): Promise<Hex | null>;
  withdrawForUsage(epoch: number, amount: bigint, usageRoot: Hex): Promise<Hex | null>;
  /** harvest() if worthwhile (simulated first). Throws only on transport / tx errors */
  harvest(): Promise<HarvestOutcome>;
  /** remaining(e) on the vault */
  remaining(epoch: number): Promise<bigint>;
  /** one burnExpired(epoch, maxAmount); throws when it reverts (simulation or receipt) */
  burnExpired(epoch: number, maxAmount: bigint): Promise<Hex | null>;
  /** usdg.balanceOf(vault) */
  vaultUsdg(): Promise<{ value: bigint; block: number | null } | null>;
  operatorFrozen(): Promise<boolean>;
}
