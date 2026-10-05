// Public endpoints (SPEC.md §5.5).
import { Hono } from "hono";
import { isAddress } from "viem";
import type { Ctx } from "../context.js";
import { isSandbox, settlementHalted } from "../context.js";
import { errorResponse, json } from "./errors.js";
import { holders, logbook, logbookCsv, receiptSvg, soundings, stats, tideEntry } from "../workers/publisher.js";
import { grantProof, loadGrantTree } from "../core/merkle.js";
import { iso, microToDecimal } from "../money.js";
import { activeAlertViews } from "../core/feeAlerts.js";

/** /api/stats `pons` block: on-chain, cached 30 s, never blocks the response for long */
async function ponsBlock(ctx: Ctx) {
  if (!ctx.pons) return null;
  const s = await Promise.race([ctx.pons.state(30_000), new Promise<null>((r) => setTimeout(() => r(null), 3_000).unref())]);
  return s ?? { phase: null, curve_progress: null, pool_id: ctx.pons.addresses.poolId, error: "pons state unavailable" };
}

const intParam = (v: string | undefined, def: number, min: number, max: number) => {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n)) return NaN;
  return Math.min(max, Math.max(min, n));
};

export interface GrantProofResponse {
  tide: number;
  addr: string;
  amount: string; // 6-dp USD
  amount_micro: string; // raw uint256 for verifyGrant
  root: string;
  proof: string[];
  leaf: string;
  committed: boolean;
  verify: { function: "verifyGrant(uint256,address,uint256,bytes32[])"; args: [string, string, string, string[]] };
}

export function publicRoutes(ctx: Ctx) {
  const app = new Hono();
  const treeCache = new Map<number, ReturnType<typeof loadGrantTree>>();
  const treeFor = (epoch: number, root: string) => {
    const t = treeCache.get(epoch);
    if (t && t.root === root) return t;
    const row = ctx.db.get<{ dump: string }>("SELECT dump FROM trees WHERE epoch = ?", epoch);
    if (!row) return null;
    const tree = loadGrantTree(row.dump);
    if (treeCache.size > 64) treeCache.delete(treeCache.keys().next().value!);
    treeCache.set(epoch, tree);
    return tree;
  };

  app.get("/v1/models", (c) => json({ object: "list", data: ctx.upstreams.models() }));

  app.get("/api/health", (c) => {
    const now = ctx.now();
    const workers: Record<string, unknown> = {};
    for (const [k, v] of ctx.workers) {
      workers[k] = { ...v, last_run: v.last_run ? iso(v.last_run) : null, last_ok: v.last_ok ? iso(v.last_ok) : null };
    }
    const halted = settlementHalted(ctx);
    const indexed = ctx.basin.indexedThrough();
    return json({
      ok: !halted,
      mode: ctx.cfg.mode,
      sandbox: isSandbox(ctx),
      chain_id: ctx.cfg.chainId,
      uptime_s: now - ctx.startedAt,
      tide: ctx.clock.epochAt(now),
      genesis: iso(ctx.clock.genesis),
      block: ctx.basin.headBlock(),
      indexed_through: indexed >= Number.MAX_SAFE_INTEGER ? null : indexed ? iso(indexed) : null,
      settlement_halted: halted,
      pons: !!ctx.pons,
      /** active creator-fee-recipient alerts (Pons); empty when all is well */
      alerts: activeAlertViews(ctx.db, now),
      models: ctx.upstreams.all().map((u) => u.id),
      workers,
    });
  });

  app.get("/api/stats", async () => json({ ...stats(ctx), pons: await ponsBlock(ctx) }));

  app.get("/api/tides/:n", (c) => {
    const n = Number(c.req.param("n"));
    if (!Number.isInteger(n) || n < 0) return errorResponse(400, "invalid_request", "tide must be a non-negative integer");
    const t = tideEntry(ctx, n);
    if (!t) return errorResponse(404, "not_found", `no logbook entry for tide ${n}`);
    return json({ sandbox: isSandbox(ctx), ...t, receipt_svg: `/api/receipts/${n}.svg` });
  });

  app.get("/api/logbook", (c) => {
    const from = c.req.query("from");
    const fromN = from === undefined || from === "" ? null : Number(from);
    if (fromN !== null && (!Number.isInteger(fromN) || fromN < 0)) return errorResponse(400, "invalid_request", "from must be a tide number");
    const csv = c.req.query("format") === "csv";
    const limit = intParam(c.req.query("limit"), csv ? 1000 : 50, 1, csv ? 10_000 : 200);
    if (Number.isNaN(limit)) return errorResponse(400, "invalid_request", "limit must be an integer");
    const page = logbook(ctx, fromN, limit);
    if (csv) {
      return new Response(logbookCsv(page.entries), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ebb-logbook${fromN !== null ? "-from-" + fromN : ""}.csv"` },
      });
    }
    return json({ sandbox: isSandbox(ctx), ...page });
  });

  app.get("/api/soundings", async () => {
    const alerts = activeAlertViews(ctx.db, ctx.now());
    return json({ ...(await soundings(ctx)), fee_recipient_alert: alerts[0] ?? null });
  });

  app.get("/api/grants/:addr/:epoch", (c) => {
    const addr = c.req.param("addr");
    const epoch = Number(c.req.param("epoch"));
    if (!isAddress(addr)) return errorResponse(400, "invalid_request", "bad address");
    if (!Number.isInteger(epoch) || epoch < 0) return errorResponse(400, "invalid_request", "bad tide");
    const ep = ctx.db.get<{ root: string | null; status: string }>("SELECT root, status FROM epochs WHERE n = ?", epoch);
    if (!ep || !ep.root) return errorResponse(404, "not_found", `tide ${epoch} has no committed grants`);
    const tree = treeFor(epoch, ep.root);
    const p = tree ? grantProof(tree, addr) : null;
    if (!p) return errorResponse(404, "not_found", `no grant for ${addr} in tide ${epoch}`);
    const body: GrantProofResponse = {
      tide: epoch,
      addr: addr.toLowerCase(),
      amount: microToDecimal(p.amount),
      amount_micro: p.amount.toString(),
      root: ep.root,
      proof: p.proof,
      leaf: p.leaf,
      committed: ep.status !== "open" && ep.status !== "committing",
      verify: { function: "verifyGrant(uint256,address,uint256,bytes32[])", args: [String(epoch), addr, p.amount.toString(), p.proof] },
    };
    return json(body);
  });

  app.get("/api/holders", (c) => {
    const limit = intParam(c.req.query("limit"), 50, 1, 500);
    if (Number.isNaN(limit)) return errorResponse(400, "invalid_request", "limit must be an integer");
    return json(holders(ctx, limit));
  });

  app.get("/api/receipts/:file", (c) => {
    const m = /^(\d+)\.svg$/.exec(c.req.param("file"));
    if (!m) return errorResponse(404, "not_found", "use /api/receipts/<tide>.svg");
    const t = tideEntry(ctx, Number(m[1]));
    if (!t) return errorResponse(404, "not_found", `no logbook entry for tide ${m[1]}`);
    return new Response(receiptSvg(t, isSandbox(ctx)), {
      headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": t.status === "burned" ? "public, max-age=86400" : "public, max-age=30" },
    });
  });

  return app;
}
