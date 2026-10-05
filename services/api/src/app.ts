// HTTP app: CORS, routers, error envelope.
import { Hono } from "hono";
import type { Ctx } from "./context.js";
import { corsMiddleware } from "./routes/session.js";
import { publicRoutes } from "./routes/public.js";
import { authRoutes } from "./routes/auth.js";
import { v1Routes } from "./routes/v1.js";
import { errorResponse, HttpError } from "./routes/errors.js";
import { errMsg, logger } from "./log.js";

const log = logger("http");

export function createApp(ctx: Ctx) {
  const app = new Hono();
  app.use("*", corsMiddleware(ctx));
  app.use("*", async (c, next) => {
    const t = Date.now();
    await next();
    if (c.req.path !== "/api/health") log.debug(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - t}ms`);
  });
  app.get("/", () =>
    Response.json({
      name: "ebb-api",
      sandbox: ctx.cfg.mode === "sandbox",
      docs: "see services/api/README.md",
      endpoints: ["/v1/models", "/v1/chat/completions", "/v1/key", "/v1/usage", "/api/stats", "/api/logbook", "/api/soundings", "/api/health"],
    }),
  );
  app.route("/", publicRoutes(ctx));
  app.route("/", authRoutes(ctx));
  app.route("/", v1Routes(ctx));
  app.notFound((c) => errorResponse(404, "not_found", `no route for ${c.req.method} ${c.req.path}`));
  app.onError((e) => {
    if (e instanceof HttpError) return e.toResponse();
    log.error("unhandled", { error: errMsg(e), stack: e instanceof Error ? e.stack : undefined });
    return errorResponse(500, "internal_error", "internal error");
  });
  return app;
}
