// End-to-end check against a running chain-mode API: SIWE sign-in as a holder, mint a key,
// stream a completion, check the balance moved, then verify the holder's grant on-chain.
// Usage: HOLDER_PK=0x... TIDE=1 npx tsx scripts/e2e-testnet.ts
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { ebbVaultAbi } from "@ebb/shared";

const API = process.env.API_URL ?? "http://localhost:8787";
const RPC = process.env.RPC_URL ?? "https://robinhood-sepolia-rpc.publicnode.com";
const account = privateKeyToAccount(process.env.HOLDER_PK as `0x${string}`);
const tide = Number(process.env.TIDE ?? 1);
const DOMAIN = process.env.SIWE_DOMAIN ?? "localhost:3000";
const ORIGIN = process.env.WEB_ORIGIN ?? `http://${DOMAIN}`;
let cookie = "";

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, { ...init, headers: { "content-type": "application/json", origin: ORIGIN, cookie, ...(init.headers ?? {}) } });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return res;
}

const { nonce } = await (await call("/api/auth/nonce")).json();
const message = createSiweMessage({
  address: account.address, chainId: 46630, domain: DOMAIN, nonce,
  uri: ORIGIN, version: "1", statement: "Sign in to Ebb", issuedAt: new Date(),
});
const verify = await call("/api/auth/verify", { method: "POST", body: JSON.stringify({ message, signature: await account.signMessage({ message }) }) });
console.log("siwe", verify.status);

const me = await (await call("/api/me")).json();
console.log("me", { addr: me.addr, tier: me.tier, credit: me.credit, pools: me.pools?.length });

const created = await call("/api/keys", { method: "POST", body: JSON.stringify({ label: "e2e" }) });
const { key } = await created.json();
console.log("key", created.status, key?.slice(0, 12) + "…");

const before = await (await fetch(API + "/v1/key", { headers: { authorization: `Bearer ${key}` } })).json();
const chat = await fetch(API + "/v1/chat/completions", {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ model: process.env.MODEL ?? "ebb-mock", stream: true, max_tokens: 64, messages: [{ role: "user", content: process.env.PROMPT ?? "Say hi from the tide." }] }),
});
const body = await chat.text();
console.log("chat", chat.status, "chunks", body.split("\n\n").length, "done", body.includes("[DONE]"));
const reply = body.split("\n").filter((l) => l.startsWith("data: ") && !l.includes("[DONE]")).map((l) => { try { return JSON.parse(l.slice(6)).choices?.[0]?.delta?.content ?? ""; } catch { return ""; } }).join("");
console.log("reply:", reply.slice(0, 300));
const costLine = body.split("\n").find((l) => l.includes("\"ebb\""));
if (costLine) console.log("ebb:", JSON.stringify(JSON.parse(costLine.slice(6)).ebb));
const after = await (await fetch(API + "/v1/key", { headers: { authorization: `Bearer ${key}` } })).json();
console.log("balance", before.balance, "→", after.balance);

const proof = await (await fetch(`${API}/api/grants/${account.address}/${tide}`)).json();
const client = createPublicClient({ transport: http(RPC) });
const vault = process.env.VAULT_ADDRESS as `0x${string}`;
const ok = await client.readContract({
  address: vault, abi: ebbVaultAbi, functionName: "verifyGrant",
  args: [BigInt(tide), account.address, BigInt(proof.amount_micro), proof.proof],
});
console.log("grant", proof.amount, "verifyGrant on-chain:", ok);
