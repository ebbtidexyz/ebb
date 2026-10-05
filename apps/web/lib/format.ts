/** Formatting helpers. Every figure on the site goes through one of these. */

export const DASH = "—";

/** Parse a 6-dp decimal money string (or number) into a JS number of dollars. */
export function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Token amounts may arrive as decimals ("1234.5") or as raw 18-dp integers. */
export function tokenNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && /^\d{19,}$/.test(v)) return Number(BigInt(v) / 10n ** 12n) / 1e6;
  return toNum(v);
}

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function usd(v: string | number | null | undefined, opts: { precise?: boolean; whole?: boolean } = {}): string {
  const n = toNum(v);
  if (n === null) return DASH;
  if (opts.whole) return usd0.format(n);
  const a = Math.abs(n);
  if (opts.precise || (a > 0 && a < 0.01)) {
    const digits = a === 0 ? 2 : a < 0.0001 ? 6 : a < 0.01 ? 4 : 2;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, opts.precise ? 6 : 2) }).format(n);
  }
  return usd2.format(n);
}

export function compactUsd(n: number | null): string {
  if (n === null) return DASH;
  if (Math.abs(n) >= 1e6) return `$${trim(n / 1e6, 2)}M`;
  if (Math.abs(n) >= 1e3) return `$${trim(n / 1e3, 1)}k`;
  return usd(n);
}

export function compact(n: number | null, digits = 1): string {
  if (n === null) return DASH;
  const a = Math.abs(n);
  if (a >= 1e9) return `${trim(n / 1e9, digits)}B`;
  if (a >= 1e6) return `${trim(n / 1e6, digits)}M`;
  if (a >= 1e3) return `${trim(n / 1e3, digits)}k`;
  return trim(n, digits);
}

function trim(n: number, digits: number) {
  return Number(n.toFixed(digits)).toString();
}

export function int(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return Math.round(n).toLocaleString("en-US");
}

export function pct(n: number | null, digits = 0): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  return `${(n * 100).toFixed(digits)}%`;
}

export function shortHash(h: string | null | undefined, head = 6, tail = 4): string {
  if (!h) return DASH;
  if (h.length <= head + tail + 2) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

/** Seconds → "6d 19h", "4h 12m", "12:04". */
export function duration(sec: number, style: "long" | "clock" = "long"): string {
  if (!Number.isFinite(sec)) return DASH;
  const s = Math.max(0, Math.floor(sec));
  if (style === "clock") {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(r)}` : `${pad2(m)}:${pad2(r)}`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Accepts ISO strings or unix seconds/millis (as string or number). Returns unix seconds. */
export function toUnix(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : v;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return n > 1e12 ? Math.floor(n / 1000) : n;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

export function utcStamp(unix: number | null, withDate = true): string {
  if (unix === null) return DASH;
  const d = new Date(unix * 1000);
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  if (!withDate) return `${time} UTC`;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  return `${date} · ${time} UTC`;
}

export function relTime(unix: number | null, nowSec: number): string {
  if (unix === null) return DASH;
  const diff = nowSec - unix;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Round SVG coordinates so server and client render identical attributes. */
export function r2(n: number) {
  return Math.round(n * 100) / 100;
}
