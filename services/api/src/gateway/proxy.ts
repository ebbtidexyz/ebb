// POST /v1/chat/completions (SPEC.md §5.4): auth → rate limit → reserve (FIFO) → upstream → settle cost / refund.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TIERS, tierFor, type TierId } from "@ebb/shared";
import type { Ctx } from "../context.js";
import { settlementHalted } from "../context.js";
import { lookupKey } from "../auth/apikeys.js";
import { latestBalance } from "../core/records.js";
import { abort, capHeadroom, creditOf, finalize, reserve } from "./ledger.js";
import { estimateCompletionTokens, estimatePromptTokens, type ChatMessage } from "./tokens.js";
import { mockChatCompletion } from "./mock.js";
import type { Upstream } from "./upstreams.js";
import { errorResponse } from "../routes/errors.js";
import { microToDecimal, tokenCostMicro } from "../money.js";
import { errMsg, logger } from "../log.js";

const log = logger("gateway");

const tierRank = (t: TierId) => TIERS.findIndex((x) => x.id === t);

const bodySchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() }).loose()).min(1),
    stream: z.boolean().optional(),
    max_tokens: z.number().int().positive().optional().nullable(),
    max_completion_tokens: z.number().int().positive().optional().nullable(),
    stream_options: z.object({}).loose().optional().nullable(),
    n: z.number().int().optional().nullable(),
  })
  .loose();

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export interface Identity { keyId: string; addr: string }

export function authenticateKey(ctx: Ctx, req: Request): Identity | Response {
  const token = bearer(req);
  if (!token) return errorResponse(401, "invalid_api_key", "missing Authorization: Bearer sk-ebb-… header");
  const key = lookupKey(ctx.db, token);
  if (!key) return errorResponse(401, "invalid_api_key", "unknown or revoked API key");
  return { keyId: key.id, addr: key.addr };
}

function newRequestId() {
  return "req_" + randomBytes(12).toString("hex");
}

/** forward to the upstream (or the built-in mock) */
async function callUpstream(u: Upstream, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  if (u.isMock) return mockChatCompletion(body as Parameters<typeof mockChatCompletion>[0], signal);
  const headers: Record<string, string> = { "content-type": "application/json", accept: body.stream ? "text/event-stream" : "application/json", ...u.extraHeaders };
  if (u.apiKey) headers.authorization = `Bearer ${u.apiKey}`;
  return fetch(`${u.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal });
}

export async function chatCompletions(ctx: Ctx, req: Request): Promise<Response> {
  // 1. auth
  const id = authenticateKey(ctx, req);
  if (id instanceof Response) return id;

  const halted = settlementHalted(ctx);
  if (halted) return errorResponse(503, "settlement_halted", `spending is paused until settlement recovers: ${halted}`);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "body must be JSON");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return errorResponse(400, "invalid_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const body = parsed.data;
  if (body.n && body.n > 1) return errorResponse(400, "invalid_request", "n > 1 is not supported");

  const upstream = ctx.upstreams.get(body.model);
  if (!upstream) return errorResponse(404, "model_not_found", `unknown model ${body.model}; see GET /v1/models`);

  const tier = tierFor(latestBalance(ctx.db, id.addr));
  if (tierRank(tier.id) < tierRank(upstream.minTier)) {
    return errorResponse(403, "tier_required", `${upstream.id} needs ${upstream.minTier} tier or deeper; this wallet is ${tier.id}`);
  }

  // 2. rate limit + concurrency
  const rl = ctx.limiter.take(id.addr, tier.rpm);
  if (!rl.ok) return errorResponse(429, "rate_limited", `${tier.label} tier allows ${tier.rpm} requests/minute`, { "retry-after": String(rl.retryAfterS) });
  if (!ctx.limiter.acquire(id.addr, tier.concurrent)) {
    return errorResponse(429, "concurrency_limited", `${tier.label} tier allows ${tier.concurrent} concurrent requests`, { "retry-after": "1" });
  }
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      ctx.limiter.release(id.addr);
    }
  };

  try {
    // 3. estimate + reserve
    const now = ctx.now();
    const promptEst = estimatePromptTokens(body.messages as ChatMessage[], (body as Record<string, unknown>).tools);
    const room = upstream.contextWindow - promptEst;
    if (room < 1) {
      release();
      return errorResponse(400, "context_length_exceeded", `prompt (~${promptEst} tokens) exceeds ${upstream.contextWindow}`);
    }
    const asked = body.max_completion_tokens ?? body.max_tokens ?? null;
    let maxTokens = Math.min(asked ?? ctx.cfg.defaultMaxTokens, room);
    let cost = tokenCostMicro(promptEst, maxTokens, upstream.inMicroPerM, upstream.outMicroPerM);
    if (asked === null) {
      // no explicit max_tokens: shrink the default to what the wallet can afford
      const credit = creditOf(ctx.db, id.addr, now);
      const head = capHeadroom(ctx.db, id.keyId);
      const budget = head !== null && head < credit ? head : credit;
      if (cost > budget && upstream.outMicroPerM > 0n) {
        const afford = (budget * 1_000_000n - BigInt(promptEst) * upstream.inMicroPerM) / upstream.outMicroPerM;
        if (afford >= 16n) {
          maxTokens = Number(afford < BigInt(maxTokens) ? afford : BigInt(maxTokens));
          cost = tokenCostMicro(promptEst, maxTokens, upstream.inMicroPerM, upstream.outMicroPerM);
        }
      }
    }
    const requestId = newRequestId();
    const r = reserve(ctx.db, { requestId, keyId: id.keyId, addr: id.addr, model: upstream.id, amount: cost, now });
    if (!r.ok) {
      release();
      return errorResponse(402, r.type, `${r.message}; available ${microToDecimal(r.available)} USD`, { "x-ebb-request-id": requestId });
    }
    ctx.inFlight.add(requestId);
    const baseHeaders: Record<string, string> = {
      "x-ebb-request-id": requestId,
      "x-ebb-balance": microToDecimal(r.balanceBefore),
      "x-ebb-tier": tier.id,
      "x-ebb-ratelimit-remaining": String(rl.remaining),
    };

    // 4. forward
    const fwd: Record<string, unknown> = { ...body, model: upstream.upstreamModel };
    if (body.max_completion_tokens != null) {
      fwd.max_completion_tokens = maxTokens;
      delete fwd.max_tokens;
    } else fwd.max_tokens = maxTokens;
    if (body.stream) fwd.stream_options = { ...(body.stream_options ?? {}), include_usage: true };
    else delete fwd.stream_options;

    const upstreamAbort = new AbortController();
    const timeout = setTimeout(() => upstreamAbort.abort(new Error("upstream timeout")), 10 * 60_000);
    const done = () => {
      clearTimeout(timeout);
      ctx.inFlight.delete(requestId);
      release();
    };
    const settle = (inTokens: number, outTokens: number) => {
      const c = tokenCostMicro(inTokens, outTokens, upstream.inMicroPerM, upstream.outMicroPerM);
      const f = finalize(ctx.db, requestId, { cost: c, inTokens, outTokens, now: ctx.now() });
      if (f?.shortfall) log.warn("usage exceeded reservation and credit", { requestId, shortfall: f.shortfall });
      return f;
    };
    const fail = (why: string) => {
      abort(ctx.db, requestId, why, ctx.now());
    };

    let res: Response;
    try {
      res = await callUpstream(upstream, fwd, upstreamAbort.signal);
    } catch (e) {
      fail(`upstream unreachable: ${errMsg(e)}`);
      done();
      return errorResponse(502, "upstream_error", `upstream ${upstream.id} unreachable`, baseHeaders);
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      fail(`upstream ${res.status}: ${text.slice(0, 200)}`);
      done();
      log.warn("upstream error", { model: upstream.id, status: res.status, body: text.slice(0, 300) });
      const status = res.status === 429 ? 503 : res.status >= 500 ? 502 : res.status === 400 ? 400 : 502;
      return errorResponse(status, "upstream_error", `upstream ${upstream.id} returned ${res.status}`, baseHeaders);
    }

    // 5a. non-streaming
    if (!body.stream) {
      let data: { usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { message?: { content?: unknown } }[]; model?: string };
      try {
        data = (await res.json()) as typeof data;
      } catch (e) {
        fail(`bad upstream JSON: ${errMsg(e)}`);
        done();
        return errorResponse(502, "upstream_error", "upstream returned invalid JSON", baseHeaders);
      }
      const text = typeof data.choices?.[0]?.message?.content === "string" ? (data.choices[0].message!.content as string) : "";
      const inT = data.usage?.prompt_tokens ?? promptEst;
      const outT = data.usage?.completion_tokens ?? estimateCompletionTokens(text);
      const f = settle(inT, outT);
      done();
      data.model = upstream.id;
      const balanceAfter = creditOf(ctx.db, id.addr, ctx.now());
      return new Response(JSON.stringify({ ...data, ebb: { request_id: requestId, cost: microToDecimal(f?.cost ?? 0n), balance: microToDecimal(balanceAfter) } }), {
        headers: { "content-type": "application/json", ...baseHeaders, "x-ebb-cost": microToDecimal(f?.cost ?? 0n) },
      });
    }

    // 5b. streaming: pass SSE lines through, watch for usage, settle at [DONE]/end/cancel
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    const enc = new TextEncoder();
    let buf = "";
    let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
    let streamedText = "";
    let settled = false;
    let lastChunk: { id?: string; created?: number } = {};

    const settleStream = (reason: "done" | "cancel" | "error"): string | null => {
      if (settled) return null;
      settled = true;
      if (!usage && streamedText.length === 0 && reason !== "done") {
        fail(`stream ${reason} before any output`);
        done();
        return null;
      }
      const inT = usage?.prompt_tokens ?? promptEst;
      const outT = usage?.completion_tokens ?? estimateCompletionTokens(streamedText);
      const f = settle(inT, outT);
      done();
      const balance = creditOf(ctx.db, id.addr, ctx.now());
      return `data: ${JSON.stringify({
        id: lastChunk.id ?? requestId, object: "chat.completion.chunk", created: lastChunk.created ?? Math.floor(Date.now() / 1000),
        model: upstream.id, choices: [],
        ebb: { request_id: requestId, cost: microToDecimal(f?.cost ?? 0n), balance: microToDecimal(balance), prompt_tokens: inT, completion_tokens: outT },
      })}\n\n`;
    };

    const handleLine = (line: string): string | null => {
      // returns text to emit (line + "\n"), or null to drop
      const t = line.trimEnd();
      if (t.startsWith("data:")) {
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") {
          const extra = settleStream("done");
          return (extra ?? "") + "data: [DONE]\n";
        }
        try {
          const j = JSON.parse(payload) as { id?: string; created?: number; usage?: typeof usage; choices?: { delta?: { content?: unknown } }[] };
          lastChunk = { id: j.id, created: j.created };
          if (j.usage) usage = j.usage;
          for (const ch of j.choices ?? []) if (typeof ch.delta?.content === "string") streamedText += ch.delta.content;
          if (j && typeof j === "object" && "model" in j) {
            (j as Record<string, unknown>).model = upstream.id;
            return `data: ${JSON.stringify(j)}\n`;
          }
        } catch {
          /* pass unknown lines through untouched */
        }
      }
      return line + "\n";
    };

    const out = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        try {
          const { value, done: eof } = await reader.read();
          if (eof) {
            let tail = "";
            if (buf.length) tail += handleLine(buf) ?? "";
            buf = "";
            const extra = settleStream("done");
            if (extra) tail += extra + "data: [DONE]\n\n";
            if (tail) ctrl.enqueue(enc.encode(tail));
            ctrl.close();
            return;
          }
          buf += dec.decode(value, { stream: true });
          let emit = "";
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            emit += handleLine(line) ?? "";
          }
          if (emit) ctrl.enqueue(enc.encode(emit));
        } catch (e) {
          log.warn("upstream stream error", { requestId, error: errMsg(e) });
          const extra = settleStream("error");
          if (extra) ctrl.enqueue(enc.encode(extra));
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ error: { type: "upstream_error", message: "upstream stream interrupted" } })}\n\ndata: [DONE]\n\n`));
          ctrl.close();
        }
      },
      cancel() {
        // client went away: stop the upstream and charge only what was produced
        upstreamAbort.abort(new Error("client disconnected"));
        reader.cancel().catch(() => {});
        settleStream("cancel");
      },
    });

    return new Response(out, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        ...baseHeaders,
        // final cost is not known before streaming; this is the reserved upper bound.
        // The exact cost arrives in the last SSE chunk under `ebb.cost` and in /v1/usage.
        "x-ebb-cost": microToDecimal(cost),
        "x-ebb-cost-kind": "reserved-max",
      },
    });
  } catch (e) {
    release();
    log.error("gateway failure", { error: errMsg(e) });
    return errorResponse(500, "internal_error", "gateway failure");
  }
}
