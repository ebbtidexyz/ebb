// Sign-In with Ethereum (EIP-4361) using viem/siwe. Nonces are single-use and expire after 10 minutes.
import { generateSiweNonce, parseSiweMessage, validateSiweMessage, verifySiweMessage } from "viem/siwe";
import { getAddress, recoverMessageAddress, type Hex } from "viem";
import type { Db } from "../db/index.js";
import type { Pub } from "../chain/clients.js";

export const NONCE_TTL_S = 600;

export function issueNonce(db: Db, now: number): { nonce: string; expires_at: number } {
  const nonce = generateSiweNonce();
  db.run("INSERT INTO siwe_nonces(nonce, created_at) VALUES (?, ?)", nonce, now);
  // housekeeping: drop nonces older than a day
  db.run("DELETE FROM siwe_nonces WHERE created_at < ?", now - 86_400);
  return { nonce, expires_at: now + NONCE_TTL_S };
}

/** atomically mark a nonce used; false if unknown, already used or expired */
export function consumeNonce(db: Db, nonce: string, now: number): boolean {
  const r = db.run("UPDATE siwe_nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL AND created_at > ?", now, nonce, now - NONCE_TTL_S);
  return r.changes === 1;
}

export type SiweResult = { ok: true; addr: string; chainId: number } | { ok: false; type: string; message: string };

export async function verifySiwe(
  db: Db,
  p: {
    message: string;
    signature: Hex;
    domain: string;
    chainIds: number[] | null; // null = any
    now: number;
    client: Pub | null; // used for smart-contract wallets (ERC-1271/6492) in chain mode
  },
): Promise<SiweResult> {
  const fail = (type: string, message: string): SiweResult => ({ ok: false, type, message });
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(p.message);
  } catch {
    return fail("invalid_siwe_message", "could not parse SIWE message");
  }
  if (!parsed.address || !parsed.nonce || !parsed.domain || !parsed.chainId || parsed.version !== "1") {
    return fail("invalid_siwe_message", "SIWE message is missing fields");
  }
  if (parsed.domain !== p.domain) return fail("invalid_siwe_message", `domain must be ${p.domain}`);
  if (p.chainIds && !p.chainIds.includes(parsed.chainId)) return fail("invalid_siwe_message", `chain id must be one of ${p.chainIds.join(", ")}`);
  const time = new Date(p.now * 1000);
  if (!validateSiweMessage({ message: parsed, domain: p.domain, time })) return fail("invalid_siwe_message", "SIWE message expired or not yet valid");
  if (parsed.issuedAt && Math.abs(parsed.issuedAt.getTime() / 1000 - p.now) > NONCE_TTL_S) {
    return fail("invalid_siwe_message", "issuedAt is too far from server time");
  }
  // single use: burn the nonce before verifying the signature so it can never be replayed
  if (!consumeNonce(db, parsed.nonce, p.now)) return fail("invalid_nonce", "nonce unknown, expired or already used");

  const address = getAddress(parsed.address);
  let valid = false;
  try {
    const recovered = await recoverMessageAddress({ message: p.message, signature: p.signature });
    valid = recovered === address;
  } catch {
    valid = false;
  }
  if (!valid && p.client) {
    try {
      valid = await verifySiweMessage(p.client, { message: p.message, signature: p.signature, domain: p.domain, nonce: parsed.nonce, time });
    } catch {
      valid = false;
    }
  }
  if (!valid) return fail("invalid_signature", "signature does not match the SIWE address");
  return { ok: true, addr: address.toLowerCase(), chainId: parsed.chainId };
}
