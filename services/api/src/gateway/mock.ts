// Built-in "mock" upstream: an OpenAI-compatible chat completion that streams nautical lorem
// and reports usage, so the whole gateway works with no provider key.
import { randomBytes } from "node:crypto";
import { contentChars } from "./tokens.js";

const WORDS = (
  "the tide comes in over the reef and fills every pool with credit before it ebbs away " +
  "soundings read the depth of the basin and the logbook keeps an honest record of each flood " +
  "brass gauges turn slowly while the chart is drawn in fathoms along the shelf toward the abyss " +
  "what you leave on the shore for seven days is drawn into the trench and burned"
).split(" ");

interface MockBody {
  model?: string;
  messages?: { content?: unknown }[];
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream_options?: { include_usage?: boolean };
}

/** mock tokenizer: ~4 chars per token, same as most providers in practice */
function promptTokens(body: MockBody): number {
  let chars = 0;
  for (const m of body.messages ?? []) chars += contentChars(m.content).chars;
  return Math.ceil(chars / 4) + 3 * (body.messages?.length ?? 0) + 3;
}

function pickWords(n: number): string[] {
  const out: string[] = [];
  const r = randomBytes(n * 2);
  for (let i = 0; i < n; i++) out.push(WORDS[r.readUInt16LE(i * 2) % WORDS.length]);
  if (out.length) out[0] = out[0][0].toUpperCase() + out[0].slice(1);
  return out;
}

export interface MockOptions { delayMs?: number }

/** behaves like fetch(base_url + "/chat/completions") */
export function mockChatCompletion(body: MockBody, signal?: AbortSignal, opts: MockOptions = {}): Response {
  const id = "chatcmpl-mock" + randomBytes(6).toString("hex");
  const created = Math.floor(Date.now() / 1000);
  const model = body.model ?? "mock-1";
  const limit = body.max_completion_tokens ?? body.max_tokens ?? 256;
  const n = Math.max(1, Math.min(limit, 24 + (randomBytes(1)[0] % 48)));
  const words = pickWords(n);
  const pt = promptTokens(body);
  const usage = { prompt_tokens: pt, completion_tokens: n, total_tokens: pt + n };
  const finish = n >= limit ? "length" : "stop";

  if (!body.stream) {
    return Response.json({
      id, object: "chat.completion", created, model,
      choices: [{ index: 0, message: { role: "assistant", content: words.join(" ") + "." }, finish_reason: finish }],
      usage,
    });
  }

  const enc = new TextEncoder();
  const delay = opts.delayMs ?? 15;
  const sse = (o: unknown) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
  const chunk = (delta: object, finish_reason: string | null) => ({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason }] });
  let i = -1;
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (signal?.aborted) {
        ctrl.error(new Error("aborted"));
        return;
      }
      if (i === -1) ctrl.enqueue(sse(chunk({ role: "assistant", content: "" }, null)));
      else if (i < words.length) {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        ctrl.enqueue(sse(chunk({ content: (i === 0 ? "" : " ") + words[i] + (i === words.length - 1 ? "." : "") }, null)));
      } else if (i === words.length) ctrl.enqueue(sse(chunk({}, finish)));
      else if (i === words.length + 1 && body.stream_options?.include_usage) {
        ctrl.enqueue(sse({ id, object: "chat.completion.chunk", created, model, choices: [], usage }));
      } else {
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctrl.close();
      }
      i++;
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}
