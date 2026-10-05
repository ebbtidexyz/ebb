// Pons v2 (Robinhood Chain mainnet) extras around the EbbVault: mode detection, PokeTwapOracle pokes, pending-fee
// reads for harvest, the launch state for /api/stats, and the creator-fee-recipient event scan.
// See contracts/README.md "Mainnet: pons v2 launch".
import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, decodeEventLog, getAddress, pad, toHex, zeroAddress, type Abi, type Address, type Hex } from "viem";
import { ebbVaultAbi } from "@ebb/shared";
import type { Config } from "../config.js";
import { erc20Abi, pokeTwapAbi, ponsCurveAbi, ponsEscrowAbi, ponsFactoryAbi, ponsHookAbi, ponsOracleAbi } from "./abis.js";
import { sendTx, type Pub, type Wal } from "./clients.js";
import { pokeDue } from "../core/keeperPlan.js";
import type { FeeRecipientEvent } from "../core/feeAlerts.js";
import { errMsg, logger } from "../log.js";

const log = logger("pons");
const vaultAbi = ebbVaultAbi as unknown as Abi;

/** pons v2 contracts that hold $EBB but are never holders (contracts/README.md, EbbMainnetBase.sol, factory reads) */
export const PONS_MAINNET = {
  factory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  hook: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
  escrow: "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e",
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951", // Uniswap v4 PoolManager (holds pool liquidity)
  locker: "0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952", // pons LP locker
  buybackVault: "0x42df2a798f82289E177311362e8f5ccC45c1219c",
} as const satisfies Record<string, Address>;

/** 4.2 ETH, the native-ETH launch config's graduationThreshold (used only if the factory record has none) */
export const DEFAULT_GRADUATION_THRESHOLD = 4_200_000_000_000_000_000n;

export type PonsPhase = "not_launched" | "curve" | "swept" | "graduated" | "rescued";
const PHASES: Record<number, PonsPhase> = { 0: "curve", 1: "swept", 2: "graduated", 3: "rescued" };

export interface PonsAddresses {
  vault: Address;
  token: Address;
  usdg: Address;
  /** zeroAddress = native ETH pairing */
  quote: Address;
  curve: Address;
  hook: Address;
  poolId: Hex;
  escrow: Address | null;
  swapAdapter: Address | null;
  oracle: Address | null;
  twap: Address | null;
  factory: Address | null;
}

export interface PonsState {
  phase: PonsPhase;
  /** quote collected on the curve / graduation threshold, 0..1 (1 once the curve is done) */
  curve_progress: number;
  pool_id: Hex;
  quote: "ETH" | "USDG";
  quote_collected: string | null;
  graduation_threshold: string;
  token: Address;
  curve: Address;
  hook: Address;
  creator_fee_recipient: Address | null;
  fee_recipient_is_vault: boolean | null;
  updated_at: string;
  error?: string;
}

export type PokeOutcome =
  | { kind: "sent"; tx: Hex }
  | { kind: "skipped"; reason: string }
  | { kind: "reverted"; reason: string }
  | { kind: "disabled"; reason: string };

export interface PendingFees {
  /** true when at least one source is non-zero (or could not be read) */
  worthIt: boolean;
  unknown: string[];
  parts: Record<string, bigint>;
}

const fmtUnits = (v: bigint, decimals: number) => {
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${v / base}${frac ? "." + frac : ""}`;
};

export class PonsChain {
  private twapMeta: { assets: Address[]; minInterval: number } | null = null;
  private cache: { at: number; state: PonsState } | null = null;
  private inflight: Promise<PonsState> | null = null;

  constructor(
    readonly pub: Pub,
    private keeper: Wal | null,
    readonly addresses: PonsAddresses,
  ) {}

  /**
   * Pons mode when PONS_MODE=true, or PONS_MODE=auto (default) and the vault answers `quote()` / `feeCurve()` with a
   * non-zero curve. Legacy (testnet) vaults don't have these views → null.
   */
  static async detect(cfg: Config, pub: Pub, keeper: Wal | null, vault: Address, token: Address, usdg: Address): Promise<PonsChain | null> {
    if (cfg.ponsMode === false) return null;
    const read = <T>(functionName: string) => pub.readContract({ address: vault, abi: vaultAbi, functionName }) as Promise<T>;
    let quote: Address, curve: Address, hook: Address, poolId: Hex;
    try {
      [quote, curve, hook, poolId] = await Promise.all([read<Address>("quote"), read<Address>("feeCurve"), read<Address>("feeHook"), read<Hex>("feePoolId")]);
    } catch (e) {
      // only a revert means "no such view"; a transport error must not silently downgrade a mainnet vault
      if (!isRevert(e)) throw e;
      if (cfg.ponsMode === true) throw new Error(`PONS_MODE=true but the vault has no quote()/feeCurve() views: ${errMsg(e)}`);
      log.info("vault has no Pons views: legacy (testnet) keeper mode");
      return null;
    }
    if (curve === zeroAddress && cfg.ponsMode !== true) {
      log.info("vault.feeCurve() is zero: legacy keeper mode");
      return null;
    }
    const [escrow, swapAdapter, oracle] = await Promise.all([
      read<Address>("feeSource").catch(() => null),
      read<Address>("swapAdapter").catch(() => null),
      read<Address>("oracle").catch(() => null),
    ]);
    let twap: Address | null = cfg.pokeTwap ?? null;
    if (!twap && oracle) {
      twap = await (pub.readContract({ address: oracle, abi: ponsOracleAbi, functionName: "tokenTwap" }) as Promise<Address>).catch(() => null);
      if (twap) log.info("POKE_TWAP_ADDRESS not set: using vault.oracle().tokenTwap()", { twap });
    }
    if (!twap) log.error("Pons mode without a PokeTwapOracle (set POKE_TWAP_ADDRESS): nobody keeps the TWAP fresh, harvest/burn will fail closed");
    if (!cfg.ponsFactory) log.warn("PONS_FACTORY_ADDRESS not set: creator-fee-recipient monitor disabled");
    const p = new PonsChain(pub, keeper, {
      vault, token, usdg, quote: getAddress(quote), curve: getAddress(curve), hook: getAddress(hook), poolId,
      escrow, swapAdapter, oracle, twap, factory: cfg.ponsFactory ?? null,
    });
    log.info("Pons v2 mode", { ...p.addresses });
    return p;
  }

  /** addresses the allocator must never grant to (curve holds unsold supply, PoolManager holds pool liquidity) */
  excludedAddresses(chainId: number): Address[] {
    const a = this.addresses;
    const list: (Address | null)[] = [a.curve, a.hook, a.escrow, a.swapAdapter, a.oracle, a.twap, a.factory];
    if (chainId === 4663) list.push(...Object.values(PONS_MAINNET));
    return list.filter((x): x is Address => !!x && x !== zeroAddress);
  }

  // ---- poke --------------------------------------------------------------------------------------------------

  private async meta() {
    if (!this.twapMeta) {
      const t = this.addresses.twap!;
      const [assets, minInterval] = await Promise.all([
        this.pub.readContract({ address: t, abi: pokeTwapAbi, functionName: "assets" }),
        this.pub.readContract({ address: t, abi: pokeTwapAbi, functionName: "minInterval" }),
      ]);
      this.twapMeta = { assets: [...assets], minInterval: Number(minInterval) };
    }
    return this.twapMeta;
  }

  /** newest sample per feed (count, timestamp) */
  async feeds() {
    const t = this.addresses.twap!;
    const { assets } = await this.meta();
    return Promise.all(assets.map(async (asset) => {
      const [, count] = await this.pub.readContract({ address: t, abi: pokeTwapAbi, functionName: "feeds", args: [asset] });
      const obs = await this.pub.readContract({ address: t, abi: pokeTwapAbi, functionName: "latest", args: [asset] });
      return { asset, count: Number(count), lastTs: Number(obs.timestamp) };
    }));
  }

  /** poke() when a feed is due; simulated first so a too-early or reverting poke costs nothing */
  async poke(): Promise<PokeOutcome> {
    const t = this.addresses.twap;
    if (!t) return { kind: "disabled", reason: "no PokeTwapOracle configured" };
    if (!this.keeper) return { kind: "disabled", reason: "no KEEPER_PRIVATE_KEY" };
    const [{ minInterval }, feeds, block] = await Promise.all([this.meta(), this.feeds(), this.pub.getBlock()]);
    const now = Number(block.timestamp);
    if (!pokeDue(feeds, minInterval, now)) return { kind: "skipped", reason: `too soon (newest sample ${now - Math.max(...feeds.map((f) => f.lastTs))} s old, min ${minInterval} s)` };
    try {
      await this.pub.simulateContract({ account: this.keeper.account, address: t, abi: pokeTwapAbi, functionName: "poke" });
    } catch (e) {
      return { kind: "reverted", reason: errMsg(e) };
    }
    const r = await sendTx(this.pub, this.keeper, { label: "pokeTwap.poke", address: t, abi: pokeTwapAbi as unknown as Abi, functionName: "poke", attempts: 1 });
    return { kind: "sent", tx: r.hash };
  }

  // ---- harvest -----------------------------------------------------------------------------------------------

  /**
   * What harvest() could collect right now. Fees sit on the curve (pre-graduation), on the hook (post-graduation,
   * creator-sweepable only while no $EBB-side fees are pending), in the escrow, or already in the vault.
   */
  async pendingFees(): Promise<PendingFees> {
    const a = this.addresses;
    const eth = a.quote === zeroAddress;
    const quoteCcy = eth ? zeroAddress : a.usdg;
    const parts: Record<string, bigint> = {};
    const unknown: string[] = [];
    const tryRead = async (name: string, f: () => Promise<bigint>) => {
      try {
        parts[name] = await f();
      } catch (e) {
        unknown.push(name);
        log.debug(`pending fee read ${name} failed`, { error: errMsg(e) });
      }
    };
    const rc = <T>(p: unknown) => p as Promise<T>;
    const curveHasCode = await this.pub.getCode({ address: a.curve }).then((c) => !!c && c !== "0x").catch(() => false);
    await Promise.all([
      eth ? tryRead("vault_eth", () => this.pub.getBalance({ address: a.vault })) : null,
      tryRead("vault_usdg_unbooked", async () => {
        const [bal, open] = await Promise.all([
          this.pub.readContract({ address: a.usdg, abi: erc20Abi, functionName: "balanceOf", args: [a.vault] }),
          rc<bigint>(this.pub.readContract({ address: a.vault, abi: vaultAbi, functionName: "totalOpen" })),
        ]);
        return bal > open ? bal - open : 0n;
      }),
      a.escrow
        ? tryRead("escrow", () => eth
          ? this.pub.readContract({ address: a.escrow!, abi: ponsEscrowAbi, functionName: "balanceOf", args: [a.vault] })
          : this.pub.readContract({ address: a.escrow!, abi: ponsEscrowAbi, functionName: "balanceOfToken", args: [a.vault, a.usdg] }))
        : null,
      curveHasCode
        ? tryRead("curve", async () => {
          const [q, t] = await Promise.all([
            this.pub.readContract({ address: a.curve, abi: ponsCurveAbi, functionName: "quoteFeeBalance" }),
            this.pub.readContract({ address: a.curve, abi: ponsCurveAbi, functionName: "creatorTaxBalance" }),
          ]);
          return q + t;
        })
        : null,
      curveHasCode
        ? tryRead("hook", async () => {
          const r = (ccy: Address) => Promise.all([
            this.pub.readContract({ address: a.hook, abi: ponsHookAbi, functionName: "pendingFees", args: [a.poolId, ccy] }),
            this.pub.readContract({ address: a.hook, abi: ponsHookAbi, functionName: "pendingCreatorTax", args: [a.poolId, ccy] }),
          ]).then(([x, y]) => x + y);
          const [quoteSide, tokenSide] = await Promise.all([r(quoteCcy), r(a.token)]);
          parts.hook_token_side = tokenSide;
          // with $EBB-side fees pending the creator sweep reverts (InternalSwapRequiresOperator): only pons' operator can sweep
          return tokenSide === 0n ? quoteSide : 0n;
        })
        : null,
    ]);
    const worthIt = unknown.length > 0 || Object.entries(parts).some(([k, v]) => k !== "hook_token_side" && v > 0n);
    return { worthIt, unknown, parts };
  }

  // ---- launch state ------------------------------------------------------------------------------------------

  /** best-effort, cached for `ttlMs`; never throws (returns the last good state with `error`, or null) */
  async state(ttlMs = 30_000, now = Date.now()): Promise<PonsState | null> {
    if (this.cache && now - this.cache.at < ttlMs) return this.cache.state;
    if (!this.inflight) {
      this.inflight = this.readState()
        .then((s) => {
          this.cache = { at: Date.now(), state: s };
          return s;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    try {
      return await this.inflight;
    } catch (e) {
      log.warn("pons state read failed", { error: errMsg(e) });
      return this.cache ? { ...this.cache.state, error: errMsg(e) } : null;
    }
  }

  private async readState(): Promise<PonsState> {
    const a = this.addresses;
    const eth = a.quote === zeroAddress;
    const decimals = eth ? 18 : 6;
    const base = {
      pool_id: a.poolId, quote: eth ? "ETH" as const : "USDG" as const, token: a.token, curve: a.curve, hook: a.hook,
      updated_at: new Date().toISOString(),
    };
    let rec: { creatorFeeRecipient: Address; graduationThreshold: bigint; phase: number; exists: boolean } | null = null;
    if (a.factory) {
      rec = await this.pub.readContract({ address: a.factory, abi: ponsFactoryAbi, functionName: "getLaunchedToken", args: [a.token] });
    }
    const threshold = rec?.graduationThreshold && rec.graduationThreshold > 0n ? rec.graduationThreshold : eth ? DEFAULT_GRADUATION_THRESHOLD : 0n;
    const launched = rec ? rec.exists : await this.pub.getCode({ address: a.curve }).then((c) => !!c && c !== "0x");
    if (!launched) {
      return { ...base, phase: "not_launched", curve_progress: 0, quote_collected: null, graduation_threshold: fmtUnits(threshold, decimals), creator_fee_recipient: null, fee_recipient_is_vault: null };
    }
    let phase: PonsPhase;
    if (rec) phase = PHASES[rec.phase] ?? "curve";
    else phase = (await this.pub.readContract({ address: a.curve, abi: ponsCurveAbi, functionName: "graduated" })) ? "graduated" : "curve";
    let collected: bigint | null = null;
    let progress = 1;
    if (phase === "curve") {
      collected = await this.pub.readContract({ address: a.curve, abi: ponsCurveAbi, functionName: "realQuoteReserve" });
      progress = threshold > 0n ? Math.min(1, Number((collected * 1_000_000n) / threshold) / 1_000_000) : 0;
    }
    return {
      ...base,
      phase,
      curve_progress: Math.round(progress * 10_000) / 10_000,
      quote_collected: collected !== null ? fmtUnits(collected, decimals) : null,
      graduation_threshold: fmtUnits(threshold, decimals),
      creator_fee_recipient: rec ? getAddress(rec.creatorFeeRecipient) : null,
      fee_recipient_is_vault: rec ? getAddress(rec.creatorFeeRecipient) === getAddress(a.vault) : null,
    };
  }

  // ---- creator-fee-recipient events --------------------------------------------------------------------------

  /** factory fee-recipient events for our token in [from, to] (token matched on topic1, server-side) */
  async feeRecipientEvents(from: bigint, to: bigint): Promise<FeeRecipientEvent[]> {
    const a = this.addresses;
    if (!a.factory) return [];
    const topics = ponsFactoryAbi
      .filter((x) => x.type === "event")
      .map((x) => topicOf(x.name));
    const logs = await this.pub.request({
      method: "eth_getLogs",
      params: [{ address: a.factory, topics: [topics, pad(a.token.toLowerCase() as Hex)], fromBlock: toHex(from), toBlock: toHex(to) }],
    });
    return decodeFeeRecipientLogs(logs as RawLog[], a.token);
  }
}

function isRevert(e: unknown): boolean {
  return e instanceof BaseError && !!e.walk((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError);
}

interface RawLog { topics: Hex[]; data: Hex; transactionHash: Hex | null; blockNumber: Hex | null; logIndex: Hex | null }

const EVENT_TOPICS: Record<string, Hex> = {
  CreatorFeeRecipientChangeProposed: "0x7f119e44c84a715429bee60d30ad2e14afdef6c60bb1a7eaa01290ecf6d1b2e5",
  CreatorFeeRecipientUpdated: "0x308c390ed1ab5873392818e036cabdf408bc8ad042fbaead3108954ff75ba980",
  CreatorFeeRecipientChangeCancelled: "0xbe2de91c1cbef653c760573fff8355c0c851d35ed2a898342b4db556301cccf4",
};
function topicOf(name: string): Hex {
  const t = EVENT_TOPICS[name];
  if (!t) throw new Error(`unknown pons event ${name}`);
  return t;
}
export { EVENT_TOPICS as PONS_FEE_EVENT_TOPICS };

/** decode raw factory logs into FeeRecipientEvents for `token` (others and undecodable logs are dropped) */
export function decodeFeeRecipientLogs(logs: readonly RawLog[], token: Address): FeeRecipientEvent[] {
  const out: FeeRecipientEvent[] = [];
  const tok = token.toLowerCase();
  for (const l of logs) {
    const base = { tx: l.transactionHash ?? "0x", block: Number(BigInt(l.blockNumber ?? "0x0")), logIndex: Number(BigInt(l.logIndex ?? "0x0")) };
    if (l.topics[0] === EVENT_TOPICS.CreatorFeeRecipientChangeCancelled) {
      // layout never observed on mainnet: accept the token in topic1 or anywhere in data
      const inTopic = l.topics[1]?.toLowerCase() === pad(tok as Hex).toLowerCase();
      if (inTopic || l.data.toLowerCase().includes(tok.slice(2))) out.push({ type: "cancelled", token: tok, ...base });
      continue;
    }
    let ev: { eventName: string; args: Record<string, unknown> };
    try {
      ev = decodeEventLog({ abi: ponsFactoryAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] }) as unknown as typeof ev;
    } catch {
      continue;
    }
    const args = ev.args;
    if (String(args.token).toLowerCase() !== tok) continue;
    if (ev.eventName === "CreatorFeeRecipientChangeProposed") {
      out.push({
        type: "proposed", token: tok, current: String(args.currentRecipient), next: String(args.newRecipient),
        executableAt: Number(args.executableAt as bigint), expiresAt: Number(args.expiresAt as bigint), ...base,
      });
    } else if (ev.eventName === "CreatorFeeRecipientUpdated") {
      out.push({ type: "updated", token: tok, old: String(args.oldRecipient), next: String(args.newRecipient), ...base });
    }
  }
  return out.sort((x, y) => (x.block === y.block ? x.logIndex - y.logIndex : x.block - y.block));
}
