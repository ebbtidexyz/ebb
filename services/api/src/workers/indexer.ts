// Indexer (chain mode, every 5 s): $EBB Transfer logs → transfers + balance_points,
// vault Harvested/Burned logs → harvests/burns. Lags INDEXER_LAG_BLOCKS behind head for reorg safety.
import { decodeEventLog, type Abi, type Hex, type Log } from "viem";
import { ebbVaultAbi } from "@ebb/shared";
import type { Ctx } from "../context.js";
import type { ChainBasin } from "../chain/chainBasin.js";
import { erc20Abi } from "../chain/abis.js";
import { latestBalance, lc, recordBurn, recordHarvest, setBalancePoint } from "../core/records.js";
import { errMsg, logger } from "../log.js";

const log = logger("indexer");
const ZERO = "0x0000000000000000000000000000000000000000";
const CURSOR = "indexer_block";
const vaultAbi = ebbVaultAbi as unknown as Abi;

export async function runIndexer(ctx: Ctx, basin: ChainBasin, budgetMs = 4_000): Promise<void> {
  const t0 = Date.now();
  const pub = basin.pub;
  const token = basin.addresses.token!;
  const vault = basin.addresses.vault!;
  const head = await pub.getBlockNumber();
  const safe = head - BigInt(ctx.cfg.indexerLagBlocks);
  let from = BigInt(ctx.db.getCursor(CURSOR) ?? String(ctx.cfg.deployBlock ?? 0n));
  if (!ctx.db.getCursor(CURSOR) && ctx.cfg.deployBlock === undefined) {
    log.warn("DEPLOY_BLOCK not set: indexing from block 0 (slow). Set it to the token deploy block.");
  }

  const tsCache = new Map<bigint, number>();
  const blockTs = async (n: bigint) => {
    let t = tsCache.get(n);
    if (t === undefined) {
      t = Number((await pub.getBlock({ blockNumber: n })).timestamp);
      tsCache.set(n, t);
    }
    return t;
  };

  while (from <= safe && Date.now() - t0 < budgetMs) {
    const to = from + BigInt(ctx.cfg.indexerBatchBlocks) - 1n < safe ? from + BigInt(ctx.cfg.indexerBatchBlocks) - 1n : safe;
    const logs = (await pub.getLogs({ address: [token, vault], fromBlock: from, toBlock: to })) as Log<bigint, number, false>[];
    logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));

    // resolve timestamps first (async), then write the batch in one transaction (sync)
    for (const l of logs) {
      const withTs = l as Log<bigint, number, false> & { blockTimestamp?: bigint | Hex };
      if (withTs.blockTimestamp !== undefined && !tsCache.has(l.blockNumber)) tsCache.set(l.blockNumber, Number(BigInt(withTs.blockTimestamp)));
      else await blockTs(l.blockNumber);
    }
    const toTs = await blockTs(to);

    const burns: { rec: Parameters<typeof recordBurn>[2] }[] = [];
    ctx.db.tx(() => {
      const balances = new Map<string, bigint>();
      const bal = (a: string) => {
        const k = lc(a);
        if (!balances.has(k)) balances.set(k, latestBalance(ctx.db, k));
        return balances.get(k)!;
      };
      for (const l of logs) {
        const ts = tsCache.get(l.blockNumber)!;
        const block = Number(l.blockNumber);
        if (lc(l.address) === lc(token)) {
          let ev;
          try {
            ev = decodeEventLog({ abi: erc20Abi, data: l.data, topics: l.topics });
          } catch {
            continue;
          }
          if (ev.eventName !== "Transfer") continue;
          const { from: f, to: t, value } = ev.args;
          ctx.db.run(
            "INSERT OR IGNORE INTO transfers(block, log_index, ts, from_addr, to_addr, amount, tx) VALUES (?,?,?,?,?,?,?)",
            block, l.logIndex, ts, lc(f), lc(t), value.toString(), l.transactionHash,
          );
          if (lc(f) !== ZERO) {
            const nb = bal(f) - value;
            balances.set(lc(f), nb);
            setBalancePoint(ctx.db, f, block, ts, nb < 0n ? 0n : nb);
          }
          if (lc(t) !== ZERO) {
            const nb = bal(t) + value;
            balances.set(lc(t), nb);
            setBalancePoint(ctx.db, t, block, ts, nb);
          }
        } else if (lc(l.address) === lc(vault)) {
          let ev: { eventName: string; args: Record<string, unknown> };
          try {
            ev = decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics }) as unknown as typeof ev;
          } catch {
            continue;
          }
          const a = ev.args;
          if (ev.eventName === "Harvested") {
            recordHarvest(ctx.db, ctx.clock, {
              tx: l.transactionHash, logIndex: l.logIndex, epoch: Number(a.epoch as bigint), block, ts,
              ethIn: a.ethIn as bigint, usdgOut: a.usdgOut as bigint, toPool: a.toPool as bigint, toTreasury: a.toTreasury as bigint,
            });
          } else if (ev.eventName === "Burned") {
            burns.push({
              rec: {
                tx: l.transactionHash, logIndex: l.logIndex, epoch: Number(a.epoch as bigint), block, ts,
                usdgIn: a.usdgIn as bigint, ebbBurned: a.ebbBurned as bigint, caller: a.caller as string, tip: a.tip as bigint,
              },
            });
          }
        }
      }
      ctx.db.setCursor(CURSOR, (to + 1n).toString());
    });

    // burns: read the epoch's authoritative state after the burn
    for (const b of burns) {
      try {
        const e = await basin.readEpoch(b.rec.epoch);
        recordBurn(ctx.db, ctx.clock, b.rec, { burned: e.burned, withdrawn: e.withdrawn, remaining: e.booked - e.withdrawn - e.burned });
      } catch (err) {
        log.warn("could not read epoch after burn; recording from event only", { error: errMsg(err) });
        recordBurn(ctx.db, ctx.clock, b.rec);
      }
    }

    basin.setIndexed(Number(to), toTs);
    if (logs.length) log.info(`indexed ${from}..${to}`, { logs: logs.length });
    from = to + 1n;
  }
  if (from > safe) {
    // fully caught up: everything strictly before the safe block's timestamp is final
    basin.setIndexed(Number(safe), await blockTs(safe));
  }
}
