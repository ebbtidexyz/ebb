"use client";

import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import type { MeResponse, ModelInfo, SoundingsResponse, StatsResponse, TideEntry, Pool } from "@ebb/shared";
import { api, ApiError, asList } from "./api";
import { IS_DEV, PRELAUNCH } from "./env";
import { soundingsFixture, statsFixture } from "./fixtures";
import { publicClient } from "./public-client";

/* Response shapes that @ebb/shared does not define yet. Parsed defensively. */
export interface HolderRow {
  addr: string;
  balance: string;
  tier: string;
  rank?: number;
  label?: string | null;
}
export interface UsageRow {
  id: string;
  model: string;
  in_tokens: number;
  out_tokens: number;
  cost: string;
  status: string;
  created_at: string;
  key_id?: string;
}
export interface KeyStatus {
  balance: string;
  tier: string;
  pools: Pool[];
  limits?: { rpm?: number; concurrent?: number };
}
export interface GrantProof {
  amount: string;
  proof: `0x${string}`[];
}

const retryUnlessClientError = (count: number, e: unknown) =>
  !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 1;

export interface WithFixture<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  /** true when we are showing development fixtures because the API is down */
  fixture: boolean;
  error: unknown;
}

/** /api/stats, with a dev-only fixture fallback for the landing counters. */
export function useStats(): WithFixture<StatsResponse> {
  const q = useQuery({
    queryKey: ["stats"],
    enabled: !PRELAUNCH,
    queryFn: () => api<StatsResponse>("/api/stats", { timeoutMs: 6000 }),
    refetchInterval: 30_000,
    retry: retryUnlessClientError,
  });
  if (q.isError && IS_DEV) return { data: statsFixture(), isLoading: false, isError: false, fixture: true, error: q.error };
  return { data: q.data, isLoading: q.isLoading, isError: q.isError, fixture: false, error: q.error };
}

export function useSoundings(opts: { fixture?: boolean } = {}): WithFixture<SoundingsResponse> {
  const q = useQuery({
    queryKey: ["soundings"],
    enabled: !PRELAUNCH,
    queryFn: () => api<SoundingsResponse>("/api/soundings", { timeoutMs: 8000 }),
    refetchInterval: 20_000,
    retry: retryUnlessClientError,
  });
  if (q.isError && IS_DEV && opts.fixture) return { data: soundingsFixture(), isLoading: false, isError: false, fixture: true, error: q.error };
  return { data: q.data, isLoading: q.isLoading, isError: q.isError, fixture: false, error: q.error };
}

/** Chain head block number, read in the browser straight from the RPC. */
export function useChainHead() {
  return useQuery({
    queryKey: ["chain-head"],
    queryFn: async () => Number(await publicClient().getBlockNumber({ cacheTime: 2_000 })),
    refetchInterval: 4_000,
    retry: 1,
    staleTime: 2_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    enabled: !PRELAUNCH,
    queryFn: () => api<{ ok?: boolean; sandbox?: boolean; mode?: string; settlement_halted?: boolean }>("/api/health", { timeoutMs: 5000 }),
    refetchInterval: 60_000,
    retry: 0,
  });
}

/** Sandbox flag from /api/stats (falls back to /api/health). */
export function useSandbox(): boolean | undefined {
  const stats = useQuery({
    queryKey: ["stats"],
    enabled: !PRELAUNCH,
    queryFn: () => api<StatsResponse>("/api/stats", { timeoutMs: 6000 }),
    refetchInterval: 30_000,
    retry: retryUnlessClientError,
  });
  const health = useHealth();
  if (stats.data) return !!stats.data.sandbox;
  if (health.data) return !!(health.data.sandbox ?? health.data.mode === "sandbox");
  return undefined;
}

export function useLogbook(limit = 48, from?: number) {
  return useQuery({
    queryKey: ["logbook", limit, from ?? null],
    enabled: !PRELAUNCH,
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (from !== undefined) qs.set("from", String(from));
      const body = await api<unknown>(`/api/logbook?${qs}`);
      return asList<TideEntry>(body, "tides", "logbook");
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    retry: retryUnlessClientError,
  });
}

export function useTide(n: number | null) {
  return useQuery({
    queryKey: ["tide", n],
    queryFn: () => api<TideEntry>(`/api/tides/${n}`),
    enabled: n !== null && !PRELAUNCH,
    retry: retryUnlessClientError,
  });
}

export function useHolders(limit = 100) {
  return useQuery({
    queryKey: ["holders", limit],
    enabled: !PRELAUNCH,
    queryFn: async () => asList<HolderRow>(await api<unknown>(`/api/holders?limit=${limit}`), "holders"),
    refetchInterval: 120_000,
    retry: retryUnlessClientError,
  });
}

export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: async () => asList<ModelInfo>(await api<unknown>("/v1/models"), "data", "models"),
    staleTime: 5 * 60_000,
    retry: retryUnlessClientError,
  });
}

/** Wallet session. Resolves to null when not signed in (401). */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    enabled: !PRELAUNCH,
    queryFn: async () => {
      try {
        return await api<MeResponse>("/api/me", { session: true });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    refetchInterval: 30_000,
    retry: retryUnlessClientError,
  });
}

export function useKeyStatus(key: string | null) {
  return useQuery({
    queryKey: ["key-status", key],
    queryFn: () => api<KeyStatus>("/v1/key", { apiKey: key! }),
    enabled: !!key && !PRELAUNCH,
    refetchInterval: 30_000,
    retry: retryUnlessClientError,
  });
}

export function useUsage(key: string | null, from?: string) {
  return useQuery({
    queryKey: ["usage", key, from ?? null],
    queryFn: async () => {
      const body = await api<unknown>(`/v1/usage${from ? `?from=${encodeURIComponent(from)}` : ""}`, { apiKey: key! });
      return asList<UsageRow>(body, "requests", "usage");
    },
    enabled: !!key && !PRELAUNCH,
    refetchInterval: 30_000,
    retry: retryUnlessClientError,
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
