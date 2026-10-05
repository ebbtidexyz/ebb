import { API_URL } from "./env";

export class ApiError extends Error {
  status: number;
  type: string;
  constructor(status: number, type: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
  }
  /** True when the API could not be reached at all (down, CORS, timeout). */
  get offline() {
    return this.status === 0;
  }
}

export interface ApiInit extends Omit<RequestInit, "body"> {
  /** Send the httpOnly session cookie (SIWE session endpoints only). */
  session?: boolean;
  /** Bearer API key (sk-ebb-…) for key-auth endpoints. */
  apiKey?: string;
  json?: unknown;
  timeoutMs?: number;
}

export function apiUrl(path: string) {
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function timeoutSignal(ms: number, outer?: AbortSignal | null) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), ms);
  outer?.addEventListener("abort", () => ctrl.abort(outer.reason), { once: true });
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

/** fetch → JSON with the API's error envelope mapped onto ApiError. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { session, apiKey, json, timeoutMs = 10_000, headers, signal, ...rest } = init;
  const h = new Headers(headers);
  if (json !== undefined) h.set("content-type", "application/json");
  if (apiKey) h.set("authorization", `Bearer ${apiKey}`);
  const t = timeoutSignal(timeoutMs, signal);
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...rest,
      headers: h,
      body: json !== undefined ? JSON.stringify(json) : undefined,
      credentials: session ? "include" : "omit",
      signal: t.signal,
      cache: "no-store",
    });
  } catch (e) {
    t.clear();
    const msg = e instanceof Error && e.name === "TimeoutError" ? "The API took too long to answer." : "The API is unreachable.";
    throw new ApiError(0, "offline", msg);
  }
  t.clear();
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const err = (body as { error?: { type?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, err?.type ?? `http_${res.status}`, err?.message ?? (res.statusText || "Request failed"));
  }
  return body as T;
}

/** Normalise list endpoints that may answer with `[...]` or `{ items | data | holders | entries: [...] }`. */
export function asList<T>(body: unknown, ...keys: string[]): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    for (const k of [...keys, "items", "data", "results", "entries"]) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.offline) return "The API is not answering right now. Figures will fill in when it is back.";
    if (e.status === 401) return "Not signed in, or the key was not recognised.";
    if (e.status === 402) return "Not enough credit in your tidepools for this request.";
    if (e.status === 429) return "Rate limit reached for your depth tier. Try again in a moment.";
    if (e.status === 503) return "Spending is paused while settlement catches up. Your credit is safe.";
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
