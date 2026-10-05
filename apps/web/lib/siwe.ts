import { createSiweMessage } from "viem/siwe";
import type { Address } from "viem";
import { api } from "./api";

/** SIWE against the API: nonce → EIP-4361 message → wallet signature → session cookie. */
export async function siweSignIn(opts: { address: Address; chainId: number; sign: (message: string) => Promise<`0x${string}`> }) {
  const res = await api<{ nonce: string } | string>("/api/auth/nonce", { session: true });
  const nonce = typeof res === "string" ? res : res.nonce;
  if (!nonce) throw new Error("The API did not return a nonce.");
  const now = new Date();
  const message = createSiweMessage({
    address: opts.address,
    chainId: opts.chainId,
    domain: window.location.host,
    uri: window.location.origin,
    version: "1",
    nonce,
    statement: "Sign in to Ebb. This creates no transaction and costs no gas.",
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 10 * 60 * 1000),
  });
  const signature = await opts.sign(message);
  await api("/api/auth/verify", { method: "POST", session: true, json: { message, signature } });
}

export async function siweSignOut() {
  await api("/api/auth/logout", { method: "POST", session: true }).catch(() => undefined);
}
