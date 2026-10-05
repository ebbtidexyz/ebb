// Key-authenticated OpenAI-compatible routes. /v1/key and /v1/usage also accept the wallet
// session cookie so the console can show them without handling a raw key.
import { Hono } from "hono";
import type { Context } from "hono";
import type { Ctx } from "../context.js";
import { isSandbox } from "../context.js";
import { chatCompletions, authenticateKey, bearer } from "../gateway/proxy.js";
import { errorResponse, json } from "./errors.js";
import { sessionAddr } from "./session.js";
import { walletView } from "./auth.js";
import { iso, microToDecimal } from "../money.js";
import { toKeyInfo } from "../auth/apikeys.js";

type Who = { addr: string; keyId: string | null };

function who(ctx: Ctx, c: Context): Who | Response {
  if (bearer(c.req.raw)) {
    const id = authenticateKey(ctx, c.req.raw);
    return id instanceof Response ? id : { addr: id.addr, keyId: id.keyId };
  }
  const addr = sessionAddr(ctx, c);
  if (addr) return { addr, keyId: null };
  return errorResponse(401, "invalid_api_key", "missing Authorization: Bearer sk-ebb-… header");
}

/** a key and all its sub-keys */
function keyFamily(ctx: Ctx, keyId: string): string[] {
  const out = [keyId];
  for (let i = 0; i < out.length; i++) {
    for (const r of ctx.db.all<{ id: string }>("SELECT id FROM keys WHERE parent_id = ?", out[i])) out.push(r.id);
  }
  return out;
}

function parseFrom(v: string | undefined, now: number): number | null {
  if (!v) return now - 30 * 86_400;
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

export function v1Routes(ctx: Ctx) {
  const app = new Hono();

  app.post("/v1/chat/completions", (c) => chatCompletions(ctx, c.req.raw));

  app.get("/v1/key", (c) => {
    const w = who(ctx, c);
    if (w instanceof Response) return w;
    const key = w.keyId ? ctx.db.getBig<Parameters<typeof toKeyInfo>[0]>("SELECT * FROM keys WHERE id = ?", w.keyId) : undefined;
    const v = walletView(ctx, w.addr);
    return json({
      sandbox: isSandbox(ctx),
      key: key ? toKeyInfo(key) : null,
      addr: v.addr,
      tier: v.tier,
      tier_label: v.tier_label,
      limits: v.limits,
      ebb_balance: v.ebb_balance,
      balance: v.credit,
      pools: v.pools,
    }, 200, { "cache-control": "no-store" });
  });

  app.get("/v1/usage", (c) => {
    const w = who(ctx, c);
    if (w instanceof Response) return w;
    const now = ctx.now();
    const from = parseFrom(c.req.query("from"), now);
    if (from === null) return errorResponse(400, "invalid_request", "from must be unix seconds or an ISO date");
    const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit") ?? 200) || 200));
    let where = "addr = ?";
    const params: (string | number)[] = [w.addr];
    if (w.keyId) {
      const fam = keyFamily(ctx, w.keyId);
      where = `key_id IN (${fam.map(() => "?").join(",")})`;
      params.splice(0, 1, ...fam);
    }
    const rows = ctx.db.allBig<{
      id: string; key_id: string | null; model: string; in_tokens: bigint; out_tokens: bigint; cost_micro: bigint;
      reserved_micro: bigint; status: string; error: string | null; created_at: bigint; finished_at: bigint | null; settled_epoch: bigint | null;
    }>(`SELECT * FROM requests WHERE ${where} AND created_at >= ? ORDER BY created_at DESC, id DESC LIMIT ?`, ...params, from, limit);
    const debits = new Map<string, { tide: number; amount: string }[]>();
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      for (const d of ctx.db.allBig<{ request_id: string; epoch: bigint; amount_micro: bigint }>(
        `SELECT request_id, epoch, amount_micro FROM debits WHERE request_id IN (${ids.map(() => "?").join(",")}) ORDER BY epoch`, ...ids,
      )) {
        if (!debits.has(d.request_id)) debits.set(d.request_id, []);
        debits.get(d.request_id)!.push({ tide: Number(d.epoch), amount: microToDecimal(d.amount_micro) });
      }
    }
    const daily = ctx.db.allBig<{ day: string; requests: bigint; cost: bigint | null; in_tokens: bigint | null; out_tokens: bigint | null }>(
      `SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, COUNT(*) AS requests, SUM(cost_micro) AS cost,
              SUM(in_tokens) AS in_tokens, SUM(out_tokens) AS out_tokens
         FROM requests WHERE ${where} AND created_at >= ? AND status = 'ok' GROUP BY day ORDER BY day`,
      ...params, from,
    );
    return json({
      object: "list",
      from: iso(from),
      data: rows.map((r) => ({
        id: r.id,
        key_id: r.key_id,
        model: r.model,
        in_tokens: Number(r.in_tokens),
        out_tokens: Number(r.out_tokens),
        cost: microToDecimal(r.cost_micro),
        reserved: r.status === "pending" ? microToDecimal(r.reserved_micro) : null,
        status: r.status,
        error: r.error,
        created_at: iso(Number(r.created_at)),
        finished_at: r.finished_at === null ? null : iso(Number(r.finished_at)),
        settled: r.settled_epoch !== null,
        pools: debits.get(r.id) ?? [],
      })),
      daily: daily.map((d) => ({
        day: d.day, requests: Number(d.requests), cost: microToDecimal(d.cost ?? 0n),
        in_tokens: Number(d.in_tokens ?? 0n), out_tokens: Number(d.out_tokens ?? 0n),
      })),
      total_cost: microToDecimal(daily.reduce((s, d) => s + (d.cost ?? 0n), 0n)),
    }, 200, { "cache-control": "no-store" });
  });

  return app;
}
