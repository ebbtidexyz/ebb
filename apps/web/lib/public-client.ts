import { createPublicClient, http, type PublicClient } from "viem";
import { activeChain } from "./chains";

let client: PublicClient | undefined;

/** A read-only client for the active chain, created lazily in the browser. */
export function publicClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      chain: activeChain,
      transport: http(undefined, { timeout: 8_000, retryCount: 1 }),
    }) as PublicClient;
  }
  return client;
}
