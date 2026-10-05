// Wallet session endpoints: SIWE sign-in, /api/me, key management (SPEC.md §5.5).
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { tierFor, type MeResponse } from "@ebb/shared";
import type { Ctx } from "../context.js";
import { isSandbox } from "../context.js";
import { errorResponse, json } from "./errors.js";
import { sameOriginOnly, sessionAddr } from "./session.js";
import { issueNonce, verifySiwe, NONCE_TTL_S } from "../auth/siwe.js";
import { SESSION_COOKIE, SESSION_TTL_S, signSession } from "../auth/session.js";
import { createKey, KeyError, listKeys, revokeKey } from "../auth/apikeys.js";
import { latestBalance } from "../core/records.js";
import { SPEND_GUARD_S, spendablePools } from "../gateway/ledger.js";
import { formatToken, iso, microToDecimal, parseMicro } from "../money.js";
import { logger } from "../log.js";

const log = logger("auth");

export function walletView(ctx: Ctx, addr: string, now = ctx.now()) {
  const balance = latestBalance(ctx.db, addr);
  const tier = tierFor(balance);
  const pools = spendablePools(ctx.db, addr, now);
  return {
    addr,
    tier: tier.id,
    tier_label: tier.label,
    limits: { rpm: tier.rpm, concurrent: tier.concurrent },
    ebb_balance: formatToken(balance),
    credit: microToDecimal(pools.reduce((s, p) => s + p.remaining, 0n)),
    pools: pools.map((p) => ({ tide: p.epoch, remaining: microToDecimal(p.remaining), expires_at: iso(p.expires_at), spend_until: iso(p.expires_at - SPEND_GUARD_S) })),
  };
}

const verifyBody = z.object({ message: z.string().min(1).max(4000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });
const keyBody = z.object({
  label: z.string().trim().max(64).optional().default(""),
  spend_cap: z.union([z.string(), z.number()]).optional().nullable(),
  parent_id: z.string().optional().nullable(),
});

export function authRoutes(ctx: Ctx) {
  const app = new Hono();
  const secure = ctx.cfg.webOrigins.some((o) => o.startsWith("https://"));

  app.get("/api/auth/nonce", () => {
    const now = ctx.now();
    const { nonce, expires_at } = issueNonce(ctx.db, now);
    return json({
      nonce,
      expires_at: iso(expires_at),
      ttl_s: NONCE_TTL_S,
      domain: ctx.cfg.siweDomain,
      uri: ctx.cfg.webOrigins[0],
      chain_id: ctx.cfg.chainId,
      statement: "Sign in to Ebb. This signature does not move funds.",
    }, 200, { "cache-control": "no-store" });
  });

  app.post("/api/auth/verify", async (c) => {
    if (!sameOriginOnly(ctx, c)) return errorResponse(403, "forbidden_origin", "origin not allowed");
    const parsed = verifyBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(400, "invalid_request", "body must be { message, signature }");
    const now = ctx.now();
    const r = await verifySiwe(ctx.db, {
      message: parsed.data.message,
      signature: parsed.data.signature as `0x${string}`,
      domain: ctx.cfg.siweDomain,
      chainIds: isSandbox(ctx) ? null : [ctx.cfg.chainId],
      now,
      client: ctx.pub,
    });
    if (!r.ok) return errorResponse(401, r.type, r.message);
    let sandbox: unknown = undefined;
    if (ctx.world) sandbox = ctx.world.onSignIn(r.addr, now, ctx.cfg.sandbox.welcomeCredit);
    const exp = now + SESSION_TTL_S;
    setCookie(c, SESSION_COOKIE, signSession(ctx.sessionSecret, r.addr, exp), {
      httpOnly: true, sameSite: "Lax", secure, path: "/", maxAge: SESSION_TTL_S,
    });
    log.info("signed in", { addr: r.addr });
    return c.json(JSON.parse(JSON.stringify({ ok: true, addr: r.addr, expires_at: iso(exp), sandbox }, (_k, v) => (typeof v === "bigint" ? microToDecimal(v) : v))));
  });

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure, httpOnly: true, sameSite: "Lax" });
    return c.json({ ok: true });
  });

  app.get("/api/me", (c) => {
    const addr = sessionAddr(ctx, c);
    if (!addr) return errorResponse(401, "unauthenticated", "sign in with Ethereum first");
    const v = walletView(ctx, addr);
    const body: MeResponse & Record<string, unknown> = { ...v, keys: listKeys(ctx.db, addr), sandbox: isSandbox(ctx) };
    return json(body, 200, { "cache-control": "no-store" });
  });

  app.post("/api/keys", async (c) => {
    if (!sameOriginOnly(ctx, c)) return errorResponse(403, "forbidden_origin", "origin not allowed");
    const addr = sessionAddr(ctx, c);
    if (!addr) return errorResponse(401, "unauthenticated", "sign in with Ethereum first");
    const parsed = keyBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(400, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    let cap: bigint | null = null;
    if (parsed.data.spend_cap !== undefined && parsed.data.spend_cap !== null && parsed.data.spend_cap !== "") {
      try {
        cap = parseMicro(parsed.data.spend_cap);
      } catch {
        return errorResponse(400, "invalid_request", "spend_cap must be a USD amount like \"5.00\"");
      }
    }
    try {
      const { key, info } = createKey(ctx.db, addr, { label: parsed.data.label, spendCap: cap, parentId: parsed.data.parent_id ?? null }, ctx.now());
      return json({ key, info, note: "Store this key now. It is shown once and only its hash is kept." }, 201, { "cache-control": "no-store" });
    } catch (e) {
      if (e instanceof KeyError) return errorResponse(e.status, e.type, e.message);
      throw e;
    }
  });

  app.post("/api/keys/:id/revoke", (c) => {
    if (!sameOriginOnly(ctx, c)) return errorResponse(403, "forbidden_origin", "origin not allowed");
    const addr = sessionAddr(ctx, c);
    if (!addr) return errorResponse(401, "unauthenticated", "sign in with Ethereum first");
    try {
      return json({ ok: true, info: revokeKey(ctx.db, addr, c.req.param("id"), ctx.now()) });
    } catch (e) {
      if (e instanceof KeyError) return errorResponse(e.status, e.type, e.message);
      throw e;
    }
  });

  return app;
}

