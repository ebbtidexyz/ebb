// OpenAI-compatible upstreams from upstreams.json (SPEC.md §5.1). base_url "mock" = built-in mock.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { ModelInfo, TierId } from "@ebb/shared";
import { pricePerMillionMicro } from "../money.js";
import { logger } from "../log.js";

const log = logger("upstreams");

const priceStr = z.union([z.string(), z.number()]).transform(String).refine((s) => /^\d+(\.\d{1,6})?$/.test(s), "price must be a decimal string like \"0.30\"");

const entry = z.object({
  id: z.string().min(1).regex(/^[A-Za-z0-9._:/-]+$/),
  label: z.string().min(1),
  base_url: z.string().min(1),
  api_key_env: z.string().optional(),
  upstream_model: z.string().min(1),
  input_per_million: priceStr,
  output_per_million: priceStr,
  context_window: z.number().int().positive(),
  min_tier: z.enum(["shore", "reef", "shelf", "abyss"]).default("shore"),
  owned_by: z.string().optional(),
  disabled: z.boolean().optional(),
  extra_headers: z.record(z.string(), z.string()).optional(),
}).loose();

export interface Upstream {
  id: string;
  label: string;
  baseUrl: string; // "mock" or https://…/v1
  apiKey: string | null;
  upstreamModel: string;
  inputPerMillion: string;
  outputPerMillion: string;
  inMicroPerM: bigint;
  outMicroPerM: bigint;
  contextWindow: number;
  minTier: TierId;
  ownedBy: string;
  extraHeaders: Record<string, string>;
  isMock: boolean;
}

export const BUILTIN_MOCK = {
  id: "ebb-mock",
  label: "Ebb Mock (sandbox, streams lorem)",
  base_url: "mock",
  upstream_model: "mock-1",
  input_per_million: "0.30",
  output_per_million: "2.50",
  context_window: 131072,
  min_tier: "shore" as const,
};

export class UpstreamRegistry {
  private byId = new Map<string, Upstream>();
  constructor(list: Upstream[]) {
    for (const u of list) this.byId.set(u.id, u);
  }
  get(id: string): Upstream | undefined {
    return this.byId.get(id);
  }
  all(): Upstream[] {
    return [...this.byId.values()];
  }
  models(): ModelInfo[] {
    return this.all().map((u) => ({
      id: u.id,
      object: "model" as const,
      owned_by: u.ownedBy,
      label: u.label,
      upstream_model: u.upstreamModel,
      context_window: u.contextWindow,
      pricing: { input_per_million: u.inputPerMillion, output_per_million: u.outputPerMillion, currency: "USD" as const },
      min_tier: u.minTier,
    }));
  }
}

function toUpstream(e: z.infer<typeof entry>, env: NodeJS.ProcessEnv): Upstream | null {
  const isMock = e.base_url === "mock";
  let apiKey: string | null = null;
  if (!isMock && e.api_key_env) {
    apiKey = env[e.api_key_env] ?? null;
    if (!apiKey) {
      log.warn(`upstream ${e.id} skipped: env ${e.api_key_env} is not set`);
      return null;
    }
  }
  let ownedBy = e.owned_by ?? "ebb";
  if (!isMock && !e.owned_by) {
    try {
      ownedBy = new URL(e.base_url).hostname;
    } catch {
      log.warn(`upstream ${e.id} skipped: bad base_url`);
      return null;
    }
  }
  return {
    id: e.id,
    label: e.label,
    baseUrl: e.base_url.replace(/\/+$/, ""),
    apiKey,
    upstreamModel: e.upstream_model,
    inputPerMillion: e.input_per_million,
    outputPerMillion: e.output_per_million,
    inMicroPerM: pricePerMillionMicro(e.input_per_million),
    outMicroPerM: pricePerMillionMicro(e.output_per_million),
    contextWindow: e.context_window,
    minTier: e.min_tier,
    ownedBy,
    extraHeaders: e.extra_headers ?? {},
    isMock,
  };
}

export function parseUpstreams(json: unknown, env: NodeJS.ProcessEnv = process.env): Upstream[] {
  const arr = z.array(z.unknown()).parse(json);
  const out: Upstream[] = [];
  for (const raw of arr) {
    const r = entry.safeParse(raw);
    if (!r.success) {
      log.warn("upstream entry ignored", { entry: raw, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      continue;
    }
    if (r.data.disabled) continue;
    const u = toUpstream(r.data, env);
    if (u) out.push(u);
  }
  return out;
}

export function loadUpstreams(path: string, env: NodeJS.ProcessEnv = process.env): UpstreamRegistry {
  const p = resolve(path);
  let list: Upstream[] = [];
  if (existsSync(p)) {
    list = parseUpstreams(JSON.parse(readFileSync(p, "utf8")), env);
    log.info(`loaded ${list.length} upstream(s) from ${p}`, { ids: list.map((u) => u.id) });
  } else {
    log.warn(`${p} not found; using the built-in mock upstream only`);
  }
  if (list.length === 0) list = parseUpstreams([BUILTIN_MOCK], env);
  return new UpstreamRegistry(list);
}
