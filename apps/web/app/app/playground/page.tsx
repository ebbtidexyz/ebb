"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "@ebb/shared";
import { apiUrl, errorText, ApiError } from "@/lib/api";
import { useInvalidate, useModels } from "@/lib/queries";
import { useSessionKey } from "@/lib/session-key";
import { int, usd } from "@/lib/format";
import { KeyPicker } from "@/components/console/key-picker";
import { Notice, PageHead } from "@/components/console/ui";
import { IconRefresh, IconSend, IconStop } from "@/components/site/icons";

interface Msg {
  role: "user" | "assistant";
  content: string;
  meta?: { cost?: string; costSource?: "header" | "stream" | "estimate"; model?: string; inTok?: number; outTok?: number; requestId?: string; balance?: string; error?: string };
}

export default function PlaygroundPage() {
  const [key] = useSessionKey();
  const models = useModels();
  const invalidate = useInvalidate();
  const [model, setModel] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!model && models.data?.length) setModel(models.data[0].id);
  }, [models.data, model]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [msgs]);

  const info = models.data?.find((m) => m.id === model);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !key || busy) return;
    const history: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs([...history, { role: "assistant", content: "", meta: { model } }]);
    setDraft("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const patch = (fn: (m: Msg) => Msg) =>
      setMsgs((cur) => {
        const next = cur.slice();
        next[next.length - 1] = fn(next[next.length - 1]);
        return next;
      });
    try {
      const res = await fetch(apiUrl("/v1/chat/completions"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: model || undefined,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: 1024,
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
        signal: ctrl.signal,
        credentials: "omit",
      });
      const headerCost = res.headers.get("x-ebb-cost");
      const meta: Msg["meta"] = {
        model,
        requestId: res.headers.get("x-ebb-request-id") ?? undefined,
        balance: res.headers.get("x-ebb-balance") ?? undefined,
        ...(headerCost ? { cost: headerCost, costSource: "header" as const } : {}),
      };
      if (!res.ok || !res.body) {
        let msg = res.statusText;
        try {
          const j = await res.json();
          msg = j?.error?.message ?? msg;
          throw new ApiError(res.status, j?.error?.type ?? "error", msg);
        } catch (err) {
          if (err instanceof ApiError) throw err;
          throw new ApiError(res.status, "error", msg || "Request failed");
        }
      }
      patch((m) => ({ ...m, meta: { ...m.meta, ...meta } }));

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const event = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of event.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let chunk: {
              choices?: { delta?: { content?: string } }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number };
              ebb?: { cost?: string };
              x_ebb_cost?: string;
              error?: { message?: string };
            };
            try {
              chunk = JSON.parse(data);
            } catch {
              continue;
            }
            if (chunk.error) throw new Error(chunk.error.message ?? "Stream error");
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            const streamCost = chunk.ebb?.cost ?? chunk.x_ebb_cost;
            patch((m) => ({
              ...m,
              content: m.content + delta,
              meta: {
                ...m.meta,
                ...(chunk.usage ? { inTok: chunk.usage.prompt_tokens, outTok: chunk.usage.completion_tokens } : {}),
                ...(streamCost && m.meta?.costSource !== "header" ? { cost: streamCost, costSource: "stream" as const } : {}),
              },
            }));
          }
        }
      }
      // fall back to an estimate from usage × list price when the API sent no cost
      patch((m) => {
        if (m.meta?.cost || !info || m.meta?.inTok === undefined) return m;
        const est = ((m.meta.inTok ?? 0) * Number(info.pricing.input_per_million) + (m.meta.outTok ?? 0) * Number(info.pricing.output_per_million)) / 1e6;
        return { ...m, meta: { ...m.meta, cost: est.toFixed(6), costSource: "estimate" } };
      });
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      const msg = aborted ? "Stopped." : err instanceof TypeError ? "Could not reach the gateway. Is the API running, and does it allow this origin?" : errorText(err);
      patch((m) => ({ ...m, meta: { ...m.meta, error: msg } }));
    } finally {
      setBusy(false);
      abort.current = null;
      invalidate("key-status", "usage");
    }
  }

  const total = msgs.reduce((s, m) => s + (m.meta?.cost ? Number(m.meta.cost) : 0), 0);

  return (
    <>
      <PageHead kicker="Console · playground" title="Playground" lede="Chat through the gateway with your key. Streaming, oldest pools first, and the cost of every reply." />
      <div className="space-y-5">
        <KeyPicker />
        <div className="neatline flex min-h-[520px] flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <label className="flex min-w-0 items-center gap-2">
              <span className="eyebrow">Model</span>
              <select className="field !min-h-9 max-w-[18rem] !py-1 font-mono !text-[13px]" value={model} onChange={(e) => setModel(e.target.value)} disabled={!models.data?.length}>
                {models.data?.length ? (
                  models.data.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label || m.id}
                    </option>
                  ))
                ) : (
                  <option value="">{models.isLoading ? "loading…" : "models unavailable"}</option>
                )}
              </select>
            </label>
            {info ? <ModelMeta m={info} /> : null}
            <span className="ml-auto font-mono text-[12px] text-mist">
              session <span className="text-foam tnum">{usd(total, { precise: total > 0 && total < 0.01 })}</span>
            </span>
            <button type="button" className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-mist hover:text-foam disabled:opacity-40" onClick={() => setMsgs([])} disabled={busy || !msgs.length}>
              <IconRefresh size={13} /> Clear
            </button>
          </div>

          <div ref={logRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6" aria-live="polite" style={{ maxHeight: "60vh" }}>
            {msgs.length === 0 ? (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
                <p className="font-display text-2xl italic text-foam">Ask the tide something.</p>
                <p className="mt-2 max-w-sm text-[13.5px] text-mist">{key ? "Each reply shows its cost, taken from your oldest tidepool first." : "Paste a key above to start."}</p>
              </div>
            ) : (
              msgs.map((m, i) => <Bubble key={i} m={m} streaming={busy && i === msgs.length - 1} />)
            )}
          </div>

          <form onSubmit={send} className="border-t border-line p-3 sm:p-4">
            <div className="flex items-end gap-2">
              <label htmlFor="pg-input" className="sr-only">
                Message
              </label>
              <textarea
                id="pg-input"
                className="field min-h-[3rem] resize-none"
                rows={2}
                placeholder={key ? "Message…  (Enter to send, Shift+Enter for a new line)" : "Paste a key above first"}
                value={draft}
                disabled={!key}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              {busy ? (
                <button type="button" className="btn btn-ghost" onClick={() => abort.current?.abort()} aria-label="Stop generating">
                  <IconStop size={15} />
                </button>
              ) : (
                <button type="submit" className="btn btn-brass" disabled={!key || !draft.trim()} aria-label="Send">
                  <IconSend size={15} />
                </button>
              )}
            </div>
          </form>
        </div>
        {models.isError ? <Notice tone="warn">Could not load /v1/models. {errorText(models.error)}</Notice> : null}
      </div>
    </>
  );
}

function ModelMeta({ m }: { m: ModelInfo }) {
  return (
    <span className="hidden font-mono text-[11.5px] text-mist md:inline">
      {m.upstream_model} · ${m.pricing.input_per_million}/${m.pricing.output_per_million} per M · {int(m.context_window)} ctx
    </span>
  );
}

function Bubble({ m, streaming }: { m: Msg; streaming: boolean }) {
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap border border-line bg-shelf/50 px-4 py-2.5 text-[14.5px] text-foam">{m.content}</div>
      </div>
    );
  return (
    <div className="max-w-[92%]">
      <div className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-foam">
        {m.content}
        {streaming ? <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-brass" aria-hidden="true" /> : null}
      </div>
      {m.meta?.error ? (
        <div className="mt-2">
          <Notice tone="error">{m.meta.error}</Notice>
        </div>
      ) : null}
      {!streaming && (m.meta?.cost || m.meta?.inTok !== undefined) ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-mist">
          {m.meta?.cost ? (
            <span>
              cost <span className="text-brass-ink tnum">{usd(m.meta.cost, { precise: true })}</span>
              {m.meta.costSource === "estimate" ? " (est. from usage)" : m.meta.costSource === "header" ? " · x-ebb-cost" : ""}
            </span>
          ) : null}
          {m.meta?.inTok !== undefined ? (
            <span className="tnum">
              {int(m.meta.inTok)} in · {int(m.meta.outTok ?? 0)} out
            </span>
          ) : null}
          {m.meta?.requestId ? <span>id {m.meta.requestId.slice(0, 10)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
