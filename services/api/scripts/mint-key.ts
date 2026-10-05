// Mints an API key for a holder via SIWE and writes it to a file (never prints it).
// Usage: HOLDER_PK=0x.. OUT=path npx tsx scripts/mint-key.ts
import { writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
const API = process.env.API_URL ?? "https://api.ebbtide.xyz";
const DOMAIN = process.env.SIWE_DOMAIN ?? "ebbtide.xyz";
const ORIGIN = `https://${DOMAIN}`;
const account = privateKeyToAccount(process.env.HOLDER_PK as `0x${string}`);
let cookie = "";
const call = async (p: string, init: RequestInit = {}) => {
  const r = await fetch(API + p, { ...init, headers: { "content-type": "application/json", origin: ORIGIN, cookie, ...(init.headers ?? {}) } });
  const c = r.headers.get("set-cookie"); if (c) cookie = c.split(";")[0];
  return r;
};
const { nonce } = await (await call("/api/auth/nonce")).json();
const chainId = Number((await (await fetch(API + "/api/health")).json()).chain_id);
const message = createSiweMessage({ address: account.address, chainId, domain: DOMAIN, nonce, uri: ORIGIN, version: "1", statement: "Sign in to Ebb", issuedAt: new Date() });
const v = await call("/api/auth/verify", { method: "POST", body: JSON.stringify({ message, signature: await account.signMessage({ message }) }) });
if (!v.ok) throw new Error("siwe " + v.status);
const r = await call("/api/keys", { method: "POST", body: JSON.stringify({ label: process.env.LABEL ?? "demo" }) });
const { key } = await r.json();
writeFileSync(process.env.OUT as string, key, { mode: 0o600 });
console.log("key written", r.status);
