// Stateless session cookie: base64url(JSON{a,exp}) + "." + base64url(HMAC-SHA256(secret, payload)).
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "ebb_session";
export const SESSION_TTL_S = 24 * 3600;

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signSession(secret: string, addr: string, exp: number): string {
  const payload = b64(JSON.stringify({ a: addr.toLowerCase(), exp }));
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifySession(secret: string, token: string | undefined, now: number): { addr: string; exp: number } | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const want = createHmac("sha256", secret).update(payload).digest();
  let got: Buffer;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { a?: unknown; exp?: unknown };
    if (typeof p.a !== "string" || typeof p.exp !== "number" || p.exp <= now) return null;
    if (!/^0x[0-9a-f]{40}$/.test(p.a)) return null;
    return { addr: p.a, exp: p.exp };
  } catch {
    return null;
  }
}
