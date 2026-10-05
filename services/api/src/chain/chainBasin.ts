// Basin backed by the real EbbVault.
import { decodeEventLog, erc20Abi as viemErc20, getAddress, zeroHash, type Abi, type Address, type Hex } from "viem";
import { ebbVaultAbi } from "@ebb/shared";
import type { Config } from "../config.js";
import type { Basin, BasinAddresses, HarvestedEvent, HarvestOutcome } from "./basin.js";
import { makePublicClient, makeWalletClient, sendTx, type Pub, type Wal } from "./clients.js";
import { PonsChain } from "./pons.js";
import { errMsg, logger } from "../log.js";

const log = logger("basin");
const vaultAbi = ebbVaultAbi as unknown as Abi;

type EpochTuple = readonly [bigint, bigint, bigint, Hex, bigint, boolean];

export class ChainBasin implements Basin {
  readonly kind = "chain" as const;
  readonly pub: Pub;
  private operator: Wal | null;
  private keeper: Wal | null;
  private head: number | null = null;
  private indexedTs = 0;
  /** set by connect() when the vault is a Pons v2 vault (mainnet); null = legacy/testnet keeper rules */
  pons: PonsChain | null = null;

  private constructor(
    private cfg: Config,
    readonly genesis: number,
    readonly addresses: BasinAddresses,
    pub: Pub,
  ) {
    this.pub = pub;
    this.operator = cfg.operatorKey ? makeWalletClient(cfg.chainId, cfg.rpcUrl, cfg.operatorKey) : null;
    this.keeper = cfg.keeperKey ? makeWalletClient(cfg.chainId, cfg.rpcUrl, cfg.keeperKey) : null;
    if (!this.operator) log.warn("OPERATOR_PRIVATE_KEY not set: commitGrants / withdrawForUsage disabled");
    if (!this.keeper) log.warn("KEEPER_PRIVATE_KEY not set: harvest / burnExpired disabled");
  }

  /** reads immutables from the vault (retries until the RPC answers) */
  static async connect(cfg: Config): Promise<ChainBasin> {
    const pub = makePublicClient(cfg.chainId, cfg.rpcUrl);
    const vault = cfg.vault!;
    for (let attempt = 1; ; attempt++) {
      try {
        const chainId = await pub.getChainId();
        if (chainId !== cfg.chainId) throw new Error(`RPC chain id ${chainId} != CHAIN_ID ${cfg.chainId}`);
        const read = <T>(functionName: string) => pub.readContract({ address: vault, abi: vaultAbi, functionName }) as Promise<T>;
        const [genesis, usdg, treasury, settlement, token] = await Promise.all([
          read<bigint>("genesis"),
          cfg.usdg ? Promise.resolve(cfg.usdg) : read<Address>("usdg"),
          read<Address>("treasury").catch(() => null),
          read<Address>("settlement").catch(() => null),
          read<Address>("token").catch(() => cfg.token!),
        ]);
        if (cfg.token && getAddress(token) !== getAddress(cfg.token)) log.warn("vault.token() differs from TOKEN_ADDRESS", { vault: token, env: cfg.token });
        log.info("connected to vault", { vault, genesis, chainId });
        const basin = new ChainBasin(cfg, Number(genesis), { vault, token: cfg.token!, usdg, treasury, settlement }, pub);
        basin.pons = await PonsChain.detect(cfg, pub, basin.keeper, vault, cfg.token!, usdg);
        return basin;
      } catch (e) {
        log.error(`vault connect failed (attempt ${attempt})`, { error: e });
        if (attempt >= 10) throw e;
        await new Promise((r) => setTimeout(r, 3_000 * attempt));
      }
    }
  }

  /** called by the indexer after each batch */
  setIndexed(head: number, ts: number) {
    this.head = head;
    this.indexedTs = ts;
  }
  indexedThrough() {
    return this.indexedTs;
  }
  headBlock() {
    return this.head;
  }

  private async epoch(e: number): Promise<EpochTuple> {
    return (await this.pub.readContract({ address: this.addresses.vault!, abi: vaultAbi, functionName: "epochs", args: [BigInt(e)] })) as EpochTuple;
  }

  async readBooked(e: number) {
    return (await this.epoch(e))[0];
  }
  async readCommittedRoot(e: number) {
    const root = (await this.epoch(e))[3];
    return root === zeroHash ? null : root;
  }
  async remaining(e: number) {
    return (await this.pub.readContract({ address: this.addresses.vault!, abi: vaultAbi, functionName: "remaining", args: [BigInt(e)] })) as bigint;
  }
  async readEpoch(e: number) {
    const [booked, withdrawn, burned, root, granted, closed] = await this.epoch(e);
    return { booked, withdrawn, burned, root, granted, closed };
  }

  async commitGrants(e: number, root: Hex, total: bigint, wallets: Address[]) {
    if (!this.operator) throw new Error("no operator key");
    // The 4th argument follows whatever the generated ABI declares (count, address list, or absent).
    const fn = (ebbVaultAbi as readonly { type: string; name?: string; inputs?: readonly { type: string }[] }[]).find(
      (x) => x.type === "function" && x.name === "commitGrants",
    );
    const fourth = fn?.inputs?.[3]?.type;
    const args: unknown[] = [BigInt(e), root, total];
    if (fourth === "address[]") args.push(wallets);
    else if (fourth?.startsWith("uint")) args.push(fourth === "uint256" ? BigInt(wallets.length) : wallets.length);
    const r = await sendTx(this.pub, this.operator, { label: `commitGrants(${e})`, address: this.addresses.vault!, abi: vaultAbi, functionName: "commitGrants", args });
    return r.hash;
  }

  async withdrawForUsage(e: number, amount: bigint, usageRoot: Hex) {
    if (!this.operator) throw new Error("no operator key");
    const r = await sendTx(this.pub, this.operator, {
      label: `withdrawForUsage(${e})`,
      address: this.addresses.vault!,
      abi: vaultAbi,
      functionName: "withdrawForUsage",
      args: [BigInt(e), amount, usageRoot],
    });
    return r.hash;
  }

  /**
   * Legacy (testnet) vault: harvest when the vault holds >= KEEPER_HARVEST_MIN_WEI of ETH.
   * Pons vault: fees sit on the curve / hook / escrow, not in the vault, so harvest whenever any source holds
   * something (or can't be read); the keeper calls this once per tide. Always simulated before sending.
   */
  async harvest(): Promise<HarvestOutcome> {
    if (!this.keeper) return { kind: "skipped", reason: "no KEEPER_PRIVATE_KEY" };
    const vault = this.addresses.vault!;
    if (this.pons) {
      const p = await this.pons.pendingFees();
      if (!p.worthIt) return { kind: "skipped", reason: `nothing pending (${fmtParts(p.parts)})` };
      log.debug("harvest: pending fees", { parts: p.parts, unknown: p.unknown });
    } else {
      const bal = await this.pub.getBalance({ address: vault });
      if (bal < this.cfg.keeperHarvestMinWei) return { kind: "skipped", reason: `vault ETH ${bal} below KEEPER_HARVEST_MIN_WEI` };
    }
    try {
      await this.pub.simulateContract({ account: this.keeper.account, address: vault, abi: vaultAbi, functionName: "harvest" });
    } catch (e) {
      return { kind: "reverted", reason: errMsg(e) };
    }
    const r = await sendTx(this.pub, this.keeper, { label: "harvest", address: vault, abi: vaultAbi, functionName: "harvest", attempts: 2 });
    return { kind: "sent", tx: r.hash, event: decodeHarvested(r.logs, vault) };
  }

  /** one attempt: a revert (TWAP not ready, Swept/Rescued phase, slippage bound) throws and the keeper moves on */
  async burnExpired(e: number, maxAmount: bigint) {
    if (!this.keeper) return null;
    const r = await sendTx(this.pub, this.keeper, {
      label: `burnExpired(${e}, ${maxAmount})`,
      address: this.addresses.vault!,
      abi: vaultAbi,
      functionName: "burnExpired",
      args: [BigInt(e), maxAmount],
      attempts: 1,
    });
    return r.hash;
  }

  async vaultUsdg() {
    if (!this.addresses.usdg || !this.addresses.vault) return null;
    const block = await this.pub.getBlockNumber();
    const value = await this.pub.readContract({ address: this.addresses.usdg, abi: viemErc20, functionName: "balanceOf", args: [this.addresses.vault], blockNumber: block });
    return { value, block: Number(block) };
  }

  async operatorFrozen() {
    try {
      return (await this.pub.readContract({ address: this.addresses.vault!, abi: vaultAbi, functionName: "operatorFrozen" })) as boolean;
    } catch {
      return false;
    }
  }
}

const fmtParts = (parts: Record<string, bigint>) => Object.entries(parts).map(([k, v]) => `${k}=${v}`).join(", ") || "no sources";

/** the vault's Harvested event from a receipt, if any */
export function decodeHarvested(logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[], vault: Address): HarvestedEvent | null {
  for (const l of logs) {
    if (l.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] }) as unknown as { eventName: string; args: Record<string, bigint> };
      if (ev.eventName !== "Harvested") continue;
      const a = ev.args;
      return { epoch: Number(a.epoch), ethIn: a.ethIn, usdgOut: a.usdgOut, toPool: a.toPool, toTreasury: a.toTreasury };
    } catch {
      continue;
    }
  }
  return null;
}
