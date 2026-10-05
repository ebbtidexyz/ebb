// viem clients + a transaction wrapper with retries, receipts and logging.
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFor } from "./chains.js";
import { errMsg, logger } from "../log.js";

const log = logger("tx");

export type Pub = PublicClient<Transport, Chain>;
export type Wal = WalletClient<Transport, Chain, Account>;

export function makePublicClient(chainId: number, rpcUrl: string): Pub {
  return createPublicClient({ chain: chainFor(chainId, rpcUrl), transport: http(rpcUrl, { retryCount: 3, timeout: 20_000 }) }) as Pub;
}

export function makeWalletClient(chainId: number, rpcUrl: string, key: Hex): Wal {
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain: chainFor(chainId, rpcUrl),
    transport: http(rpcUrl, { retryCount: 2, timeout: 30_000 }),
  });
}

export class TxError extends Error {
  constructor(message: string, readonly attempts: number) {
    super(message);
  }
}

/**
 * simulate → send → wait for receipt. Retries up to `attempts` times with backoff.
 * A reverted receipt or simulation revert is also retried (state may be racing), then thrown.
 */
export async function sendTx(
  pub: Pub,
  wallet: Wal,
  p: { label: string; address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; attempts?: number; value?: bigint },
): Promise<{ hash: Hex; blockNumber: bigint; logs: readonly { address: Address; topics: readonly Hex[]; data: Hex; logIndex: number | null }[] }> {
  const attempts = p.attempts ?? 3;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const { request } = await pub.simulateContract({
        account: wallet.account,
        address: p.address,
        abi: p.abi,
        functionName: p.functionName,
        args: p.args ?? [],
        value: p.value,
      } as Parameters<Pub["simulateContract"]>[0]);
      const hash = await wallet.writeContract(request as Parameters<Wal["writeContract"]>[0]);
      log.info(`${p.label} sent`, { hash, attempt: i });
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`${p.label} reverted in ${hash}`);
      log.info(`${p.label} confirmed`, { hash, block: receipt.blockNumber, gasUsed: receipt.gasUsed });
      return { hash, blockNumber: receipt.blockNumber, logs: receipt.logs };
    } catch (e) {
      lastErr = e;
      log.warn(`${p.label} failed`, { attempt: i, of: attempts, error: errMsg(e) });
      if (i < attempts) await new Promise((r) => setTimeout(r, 2_000 * 2 ** (i - 1)));
    }
  }
  throw new TxError(`${p.label} failed after ${attempts} attempts: ${errMsg(lastErr)}`, attempts);
}
