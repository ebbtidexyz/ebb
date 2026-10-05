import { isAddress, type Address } from "viem";
import { CHAIN_ID_MAINNET, CHAIN_ID_TESTNET } from "@ebb/shared";

function addr(v: string | undefined): Address | undefined {
  return v && isAddress(v) ? (v as Address) : undefined;
}

/** Base URL of the Ebb API (no trailing slash). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787").replace(/\/+$/, "");

const rawChain = Number(process.env.NEXT_PUBLIC_CHAIN_ID || CHAIN_ID_TESTNET);
export const CHAIN_ID = rawChain === CHAIN_ID_MAINNET ? CHAIN_ID_MAINNET : CHAIN_ID_TESTNET;
export const IS_TESTNET = CHAIN_ID === CHAIN_ID_TESTNET;

export const TOKEN_ADDRESS = addr(process.env.NEXT_PUBLIC_TOKEN_ADDRESS);
export const VAULT_ADDRESS = addr(process.env.NEXT_PUBLIC_VAULT_ADDRESS);

export const EXPLORER_URL = (
  process.env.NEXT_PUBLIC_EXPLORER_URL ||
  (IS_TESTNET ? "https://explorer.testnet.chain.robinhood.com" : "https://explorer.chain.robinhood.com")
).replace(/\/+$/, "");

export const DEX_URL = process.env.NEXT_PUBLIC_DEX_URL || "";
/** Empty until a public repo exists; links to it are hidden while empty. */
export const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL || "";
export const X_URL = process.env.NEXT_PUBLIC_X_URL || "https://x.com/ebbtidexyz";
export const TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL || "https://t.me/ebbtidexyz";

/** The mainnet $EBB contract shown on the landing. Deliberately separate from TOKEN_ADDRESS (the
 *  testnet token the console reads), so a test deployment is never presented as the real CA. */
export const LAUNCH_CA = addr(process.env.NEXT_PUBLIC_LAUNCH_CA);
/** Where "Buy $EBB" goes: the token's page on the Pons launchpad once it exists. */
export const BUY_URL = process.env.NEXT_PUBLIC_BUY_URL || "https://www.ponsfamily.com";
/** Fair launch on Pons, Robinhood Chain. */
export const LAUNCH_AT = Date.parse(process.env.NEXT_PUBLIC_LAUNCH_AT || "2026-10-05T15:00:00Z");

export const IS_DEV = process.env.NODE_ENV !== "production";

/** Mainnet site before the token exists: no API data is shown (the API still runs the testnet demo),
 *  the console shows an "opens at launch" panel. Turned off at cutover. */
export const PRELAUNCH = process.env.NEXT_PUBLIC_PRELAUNCH === "1";
