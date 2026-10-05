// API response shapes (SPEC.md §5.5). Money fields are 6-dp decimal strings.
export interface ApiError { error: { type: string; message: string } }

export interface StatsResponse {
  sandbox: boolean;
  tide: { current: number; starts_at: string; next_at: string };
  last_24h: { granted: string; used: string; expired: string; requests: number; wallets: number };
  all_time: { granted: string; used: string; expired: string; requests: number; wallets: number; tides: number; burned_ebb: string; burned_usdg: string; burns: number };
  block: number | null;
}

export interface TideEntry {
  tide: number;
  starts_at: string;
  status: "open" | "committed" | "expired" | "burned";
  booked: string;
  granted: string;
  wallets: number;
  used: string;
  withdrawn: string;
  open: string;
  grant_root: string | null;
  commit_tx: string | null;
  burn: { usdg_in: string; ebb_burned: string; tx: string; caller: string; tip: string } | null;
}

export interface SoundingsResponse {
  sandbox: boolean;
  vault_usdg: string | null;
  open_credits: string;
  unsettled_used: string;
  difference: string | null;
  block: number | null;
  addresses: { vault: string | null; token: string | null; usdg: string | null; treasury: string | null; settlement: string | null };
}

export interface Pool { tide: number; remaining: string; expires_at: string }

export interface KeyInfo { id: string; prefix: string; label: string; parent_id: string | null; spend_cap: string | null; spent: string; created_at: string; revoked_at: string | null }

export interface MeResponse {
  addr: string;
  tier: string;
  ebb_balance: string;
  credit: string;
  pools: Pool[];
  keys: KeyInfo[];
}

export interface ModelInfo {
  id: string; object: "model"; owned_by: string; label: string; upstream_model: string;
  context_window: number; pricing: { input_per_million: string; output_per_million: string; currency: "USD" }; min_tier: string;
}
