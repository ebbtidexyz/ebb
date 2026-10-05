// Basin backed by the sandbox DB: the "vault" is the epochs table, txs are fake hashes.
import { CALLER_TIP_BPS, CALLER_TIP_CAP_MICRO, MICRO } from "@ebb/shared";
import type { Address, Hex } from "viem";
import type { Basin, BasinAddresses, HarvestOutcome } from "../chain/basin.js";
import type { Db } from "../db/index.js";
import type { TideClock } from "../core/tides.js";
import { recordBurn } from "../core/records.js";
import type { SandboxWorld } from "./world.js";
import { nowS } from "../money.js";

export class SandboxBasin implements Basin {
  readonly kind = "sandbox" as const;
  readonly addresses: BasinAddresses = { vault: null, token: null, usdg: null, treasury: null, settlement: null };
  private n = 0;

  constructor(private db: Db, private clock: TideClock, private world: SandboxWorld, private now: () => number = nowS) {}

  get genesis() {
    return this.clock.genesis;
  }
  indexedThrough() {
    return Number.MAX_SAFE_INTEGER; // the world writes balance points synchronously
  }
  headBlock() {
    return this.world.simBlock(this.now());
  }

  private epoch(e: number) {
    return this.db.getBig<{ booked_micro: bigint; withdrawn_micro: bigint; burned_micro: bigint; root: string | null; status: string }>(
      "SELECT booked_micro, withdrawn_micro, burned_micro, root, status FROM epochs WHERE n = ?", e,
    );
  }

  async readBooked(e: number) {
    this.world.catchUpInflow(e, this.now());
    return this.epoch(e)?.booked_micro ?? 0n;
  }
  async readCommittedRoot(e: number) {
    const r = this.epoch(e);
    return r && r.status !== "open" && r.status !== "committing" && r.root ? (r.root as Hex) : null;
  }
  async commitGrants(e: number, root: Hex, total: bigint, wallets: Address[]) {
    return this.world.fakeTx(`commit:${e}:${root}:${total}:${wallets.length}`);
  }
  async withdrawForUsage(e: number, amount: bigint, usageRoot: Hex) {
    return this.world.fakeTx(`withdraw:${e}:${amount}:${usageRoot}:${this.n++}`);
  }
  async harvest(): Promise<HarvestOutcome> {
    const cur = this.clock.epochAt(this.now());
    this.world.catchUpInflow(cur, this.now());
    return { kind: "skipped", reason: "sandbox: inflow is simulated" };
  }
  async remaining(e: number) {
    const r = this.epoch(e);
    return r ? r.booked_micro - r.withdrawn_micro - r.burned_micro : 0n;
  }
  async burnExpired(e: number, maxAmount: bigint) {
    const now = this.now();
    if (!this.clock.isExpired(e, now)) throw new Error("not expired");
    const r = this.epoch(e);
    if (!r) return null;
    const rem = r.booked_micro - r.withdrawn_micro - r.burned_micro;
    const amount = rem < maxAmount ? rem : maxAmount;
    if (amount <= 0n) return null;
    let tip = (amount * BigInt(CALLER_TIP_BPS)) / 10_000n;
    if (tip > CALLER_TIP_CAP_MICRO) tip = CALLER_TIP_CAP_MICRO;
    const ebbBurned = ((amount - tip) * this.world.ebbPerUsd(now) * 10n ** 18n) / MICRO;
    const tx = this.world.fakeTx(`burn:${e}:${r.burned_micro}`);
    recordBurn(
      this.db, this.clock,
      { tx, logIndex: 0, epoch: e, block: this.world.simBlock(now), ts: now, usdgIn: amount, ebbBurned, caller: this.world.keeper, tip },
      { burned: r.burned_micro + amount, withdrawn: r.withdrawn_micro, remaining: rem - amount },
    );
    return tx;
  }
  async vaultUsdg() {
    const v = this.db.getBig<{ v: bigint | null }>("SELECT SUM(booked_micro - withdrawn_micro - burned_micro) AS v FROM epochs")!.v ?? 0n;
    return { value: v, block: this.headBlock() };
  }
  async operatorFrozen() {
    return false;
  }
}
