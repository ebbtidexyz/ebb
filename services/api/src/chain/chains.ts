// Robinhood Chain definitions (Arbitrum Orbit L2, ETH gas).
import { defineChain, type Chain } from "viem";
import { CHAIN_ID_MAINNET, CHAIN_ID_TESTNET } from "@ebb/shared";

export const robinhood = defineChain({
  id: CHAIN_ID_MAINNET,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } }, // publicnode: https://robinhood-rpc.publicnode.com
});

export const robinhoodTestnet = defineChain({
  id: CHAIN_ID_TESTNET,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://robinhood-sepolia-rpc.publicnode.com"] } },
  testnet: true,
});

export const localAnvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export function chainFor(id: number, rpcUrl?: string): Chain {
  const base = id === CHAIN_ID_MAINNET ? robinhood : id === CHAIN_ID_TESTNET ? robinhoodTestnet : localAnvil;
  return rpcUrl ? { ...base, rpcUrls: { default: { http: [rpcUrl] } } } : base;
}
