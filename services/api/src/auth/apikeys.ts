// API keys: "sk-ebb-" + 32 base62 chars (crypto.randomBytes, rejection-sampled, ~190 bits).
// Only sha256(key) and a short display prefix are stored; the key is shown once.
import { createHash, randomBytes } from "node:crypto";
import type { KeyInfo } from "@ebb/shared";
import type { Db } from "../db/index.js";
import { lc } from "../core/records.js";
import { iso, microToDecimal } from "../money.js";

export const KEY_PREFIX = "sk-ebb-";
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** stored display prefix: "sk-ebb-" + the first 10 random characters */
export const DISPLAY_PREFIX_RANDOM_CHARS = 10;

export function randomBase62(len: number): string {
  let out = "";
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < 248) out += ALPHABET[b % 62]; // 248 = 4*62, unbiased
      if (out.length === len) break;
    }
  }
  return out;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateKey(): { key: string; hash: string; prefix: string } {
  const key = KEY_PREFIX + randomBase62(32);
  return { key, hash: hashKey(key), prefix: key.slice(0, KEY_PREFIX.length + DISPLAY_PREFIX_RANDOM_CHARS) };
}

export function isKeyShaped(s: string): boolean {
  return /^sk-ebb-[0-9A-Za-z]{32}$/.test(s);
}

interface KeyRow {
  id: string; addr: string; hash: string; prefix: string; label: string; parent_id: string | null;
  spend_cap_micro: bigint | null; spent_micro: bigint; created_at: bigint; revoked_at: bigint | null;
}

export function toKeyInfo(k: KeyRow): KeyInfo {
  return {
    id: k.id,
    prefix: k.prefix,
    label: k.label,
    parent_id: k.parent_id,
    spend_cap: k.spend_cap_micro === null ? null : microToDecimal(k.spend_cap_micro),
    spent: microToDecimal(k.spent_micro),
    created_at: iso(Number(k.created_at)),
    revoked_at: k.revoked_at === null ? null : iso(Number(k.revoked_at)),
  };
}

export function listKeys(db: Db, addr: string): KeyInfo[] {
  return db.allBig<KeyRow>("SELECT * FROM keys WHERE addr = ? ORDER BY created_at DESC, id", lc(addr)).map(toKeyInfo);
}

/** resolve a bearer key to an active key (it and every ancestor unrevoked) */
export function lookupKey(db: Db, key: string): { id: string; addr: string; label: string } | null {
  if (!isKeyShaped(key)) return null;
  const row = db.get<{ id: string; addr: string; label: string; parent_id: string | null; revoked_at: number | null }>(
    "SELECT id, addr, label, parent_id, revoked_at FROM keys WHERE hash = ?", hashKey(key),
  );
  if (!row || row.revoked_at !== null) return null;
  let parent = row.parent_id;
  const seen = new Set([row.id]);
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const p = db.get<{ parent_id: string | null; revoked_at: number | null }>("SELECT parent_id, revoked_at FROM keys WHERE id = ?", parent);
    if (!p || p.revoked_at !== null) return null;
    parent = p.parent_id;
  }
  return { id: row.id, addr: row.addr, label: row.label };
}

export class KeyError extends Error {
  constructor(readonly type: string, message: string, readonly status: 400 | 403 | 404 = 400) {
    super(message);
  }
}

export function createKey(
  db: Db,
  addr: string,
  p: { label: string; spendCap: bigint | null; parentId: string | null },
  now: number,
): { key: string; info: KeyInfo } {
  return db.tx(() => {
    if (p.parentId) {
      const parent = db.get<{ addr: string; revoked_at: number | null }>("SELECT addr, revoked_at FROM keys WHERE id = ?", p.parentId);
      if (!parent || parent.addr !== lc(addr)) throw new KeyError("invalid_request", "parent key not found", 404);
      if (parent.revoked_at !== null) throw new KeyError("invalid_request", "parent key is revoked");
    }
    const active = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM keys WHERE addr = ? AND revoked_at IS NULL", lc(addr))!.n;
    if (active >= 50) throw new KeyError("too_many_keys", "at most 50 active keys per wallet");
    const g = generateKey();
    const id = "key_" + randomBytes(8).toString("hex");
    db.run(
      "INSERT INTO keys(id, addr, hash, prefix, label, parent_id, spend_cap_micro, spent_micro, created_at) VALUES (?,?,?,?,?,?,?,0,?)",
      id, lc(addr), g.hash, g.prefix, p.label, p.parentId, p.spendCap, now,
    );
    const row = db.getBig<KeyRow>("SELECT * FROM keys WHERE id = ?", id)!;
    return { key: g.key, info: toKeyInfo(row) };
  });
}

/** revoke a key and all of its sub-keys */
export function revokeKey(db: Db, addr: string, id: string, now: number): KeyInfo {
  return db.tx(() => {
    const row = db.get<{ addr: string }>("SELECT addr FROM keys WHERE id = ?", id);
    if (!row || row.addr !== lc(addr)) throw new KeyError("not_found", "key not found", 404);
    const queue = [id];
    while (queue.length) {
      const k = queue.shift()!;
      db.run("UPDATE keys SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", now, k);
      for (const c of db.all<{ id: string }>("SELECT id FROM keys WHERE parent_id = ?", k)) queue.push(c.id);
    }
    return toKeyInfo(db.getBig<KeyRow>("SELECT * FROM keys WHERE id = ?", id)!);
  });
}
