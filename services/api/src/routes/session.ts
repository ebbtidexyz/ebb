// Session helpers + CORS / origin checks shared by the routers.
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Ctx } from "../context.js";
import { SESSION_COOKIE, verifySession } from "../auth/session.js";

export function sessionAddr(ctx: Ctx, c: Context): string | null {
  return verifySession(ctx.sessionSecret, getCookie(c, SESSION_COOKIE), ctx.now())?.addr ?? null;
}

const EXPOSE = "x-ebb-balance, x-ebb-cost, x-ebb-cost-kind, x-ebb-request-id, x-ebb-tier, x-ebb-ratelimit-remaining, retry-after, content-disposition";

/**
 * WEB_ORIGIN(s): credentialed CORS (cookies). Any other origin may call /v1/* with a Bearer key,
 * without credentials, so a third-party page can never read a session-authenticated response.
 */
export function corsMiddleware(ctx: Ctx): MiddlewareHandler {
  const allowed = new Set(ctx.cfg.webOrigins);
  return async (c, next) => {
    const origin = c.req.header("origin");
    const trusted = !!origin && allowed.has(origin);
    const open = !!origin && !trusted && c.req.path.startsWith("/v1/");
    if (c.req.method === "OPTIONS" && origin && (trusted || open)) {
      const h: Record<string, string> = {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": c.req.header("access-control-request-headers") ?? "authorization, content-type",
        "access-control-max-age": "600",
        vary: "Origin",
      };
      if (trusted) h["access-control-allow-credentials"] = "true";
      return new Response(null, { status: 204, headers: h });
    }
    await next();
    if (trusted || open) {
      c.res.headers.set("access-control-allow-origin", origin!);
      c.res.headers.set("access-control-expose-headers", EXPOSE);
      c.res.headers.append("vary", "Origin");
      if (trusted) c.res.headers.set("access-control-allow-credentials", "true");
    }
  };
}

/** state-changing cookie endpoints: if the browser sent an Origin, it must be ours */
export function sameOriginOnly(ctx: Ctx, c: Context): boolean {
  const origin = c.req.header("origin");
  return !origin || ctx.cfg.webOrigins.includes(origin);
}
