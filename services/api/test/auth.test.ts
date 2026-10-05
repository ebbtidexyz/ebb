import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { consumeNonce, issueNonce, verifySiwe } from "../src/auth/siwe.js";
import { createKey, generateKey, hashKey, isKeyShaped, listKeys, lookupKey, revokeKey } from "../src/auth/apikeys.js";
import { signSession, verifySession } from "../src/auth/session.js";
import { testCtx } from "./helpers.js";

async function signIn(db: ReturnType<typeof testCtx>["db"], now: number, opts: { nonce?: string; domain?: string; key?: `0x${string}` } = {}) {
  const account = privateKeyToAccount(opts.key ?? generatePrivateKey());
  const nonce = opts.nonce ?? issueNonce(db, now).nonce;
  const message = createSiweMessage({
    address: account.address, chainId: 46630, domain: opts.domain ?? "localhost:3000", nonce,
    uri: "http://localhost:3000", version: "1", issuedAt: new Date(now * 1000),
  });
  const signature = await account.signMessage({ message });
  return { account, message, signature, nonce };
}

test("SIWE: valid signature signs in; the nonce cannot be replayed", async () => {
  const { db, getNow } = testCtx();
  const s = await signIn(db, getNow());
  const args = { message: s.message, signature: s.signature, domain: "localhost:3000", chainIds: [46630], now: getNow(), client: null };
  const r1 = await verifySiwe(db, args);
  assert.deepEqual(r1, { ok: true, addr: s.account.address.toLowerCase(), chainId: 46630 });
  const r2 = await verifySiwe(db, args);
  assert.equal(r2.ok, false);
  assert.equal(!r2.ok && r2.type, "invalid_nonce");
});

test("SIWE: unknown nonce, expired nonce, wrong domain, wrong chain, bad signature are rejected", async () => {
  const { db, getNow } = testCtx();
  const now = getNow();
  const base = { domain: "localhost:3000", chainIds: [46630], client: null };

  const unknown = await signIn(db, now, { nonce: "neverIssued123" });
  assert.equal((await verifySiwe(db, { ...base, message: unknown.message, signature: unknown.signature, now })).ok, false);

  const old = issueNonce(db, now - 601).nonce; // 10 min + 1 s ago
  const expired = await signIn(db, now, { nonce: old });
  const re = await verifySiwe(db, { ...base, message: expired.message, signature: expired.signature, now });
  assert.equal(!re.ok && re.type, "invalid_nonce");

  const dom = await signIn(db, now, { domain: "evil.example" });
  const rd = await verifySiwe(db, { ...base, message: dom.message, signature: dom.signature, now });
  assert.equal(!rd.ok && rd.type, "invalid_siwe_message");

  const chain = await signIn(db, now);
  const rc = await verifySiwe(db, { ...base, chainIds: [4663], message: chain.message, signature: chain.signature, now });
  assert.equal(!rc.ok && rc.type, "invalid_siwe_message");

  const a = await signIn(db, now);
  const other = privateKeyToAccount(generatePrivateKey());
  const forged = await other.signMessage({ message: a.message });
  const rf = await verifySiwe(db, { ...base, message: a.message, signature: forged, now });
  assert.equal(!rf.ok && rf.type, "invalid_signature");
  // the nonce was burned by the failed attempt too
  assert.equal(consumeNonce(db, a.nonce, now), false);
});

test("API keys: sk-ebb- + 32 base62, only sha256 + prefix stored, revocation cascades", () => {
  const g = generateKey();
  assert.match(g.key, /^sk-ebb-[0-9A-Za-z]{32}$/);
  assert.ok(isKeyShaped(g.key));
  assert.equal(g.hash, createHash("sha256").update(g.key).digest("hex"));
  assert.equal(g.prefix, g.key.slice(0, 17));
  assert.notEqual(generateKey().key, g.key);

  const { db, getNow } = testCtx();
  const W = "0x1111111111111111111111111111111111111111";
  const parent = createKey(db, W, { label: "main", spendCap: null, parentId: null }, getNow());
  const child = createKey(db, W, { label: "bot", spendCap: 5_000_000n, parentId: parent.info.id }, getNow());
  const stored = db.all<Record<string, unknown>>("SELECT * FROM keys");
  for (const row of stored) for (const v of Object.values(row)) assert.notEqual(v, parent.key, "raw key never stored");
  assert.equal(stored.find((r) => r.id === parent.info.id)!.hash, hashKey(parent.key));
  assert.equal(lookupKey(db, child.key)?.id, child.info.id);
  assert.equal(lookupKey(db, "sk-ebb-" + "x".repeat(32)), null);
  revokeKey(db, W, parent.info.id, getNow());
  assert.equal(lookupKey(db, parent.key), null);
  assert.equal(lookupKey(db, child.key), null, "sub-key dies with its parent");
  assert.ok(listKeys(db, W).every((k) => k.revoked_at !== null));
  assert.throws(() => revokeKey(db, "0x2222222222222222222222222222222222222222", child.info.id, getNow()));
});

test("session cookie: HMAC-signed, expires, tamper-evident", () => {
  const secret = "s".repeat(40);
  const tok = signSession(secret, "0xABCDEFabcdef0123456789012345678901234567", 2_000);
  assert.deepEqual(verifySession(secret, tok, 1_000), { addr: "0xabcdefabcdef0123456789012345678901234567", exp: 2_000 });
  assert.equal(verifySession(secret, tok, 2_000), null);
  assert.equal(verifySession("other".repeat(8), tok, 1_000), null);
  const [p, m] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ a: "0x" + "1".repeat(40), exp: 9e9 })).toString("base64url");
  assert.equal(verifySession(secret, `${forged}.${m}`, 1_000), null);
  assert.equal(verifySession(secret, `${p}.`, 1_000), null);
});
