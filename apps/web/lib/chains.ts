import { defineChain } from "viem";
import { CHAIN_ID_MAINNET, CHAIN_ID_TESTNET } from "@ebb/shared";
import { CHAIN_ID, EXPLORER_URL } from "./env";

export const robinhoodChain = defineChain({
  id: CHAIN_ID_MAINNET,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://robinhood-rpc.publicnode.com"] } },
  blockExplorers: {
    default: { name: "Explorer", url: CHAIN_ID === CHAIN_ID_MAINNET ? EXPLORER_URL : "https://explorer.chain.robinhood.com" },
  },
});

export const robinhoodTestnet = defineChain({
  id: CHAIN_ID_TESTNET,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://robinhood-sepolia-rpc.publicnode.com"] } },
  blockExplorers: {
    default: { name: "Explorer", url: CHAIN_ID === CHAIN_ID_TESTNET ? EXPLORER_URL : "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

export const activeChain = CHAIN_ID === CHAIN_ID_MAINNET ? robinhoodChain : robinhoodTestnet;
export const otherChain = CHAIN_ID === CHAIN_ID_MAINNET ? robinhoodTestnet : robinhoodChain;

export function explorerAddress(a: string) {
  return `${EXPLORER_URL}/address/${a}`;
}
export function explorerTx(h: string) {
  return `${EXPLORER_URL}/tx/${h}`;
}
