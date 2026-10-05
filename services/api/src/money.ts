// Money helpers. Off-chain money is bigint micro-dollars; $EBB amounts are bigint wei (18 dp).
import { MICRO, TOKEN_DECIMALS, microToDecimal } from "@ebb/shared";

export { microToDecimal };

/** "12.34" | "12" | 12.34 -> 12_340_000n. Rejects more than 6 dp and negatives. */
export function parseMicro(v: string | number): bigint {
  const s = typeof v === "number" ? v.toFixed(6) : v.trim();
  const m = /^(\d+)(?:\.(\d{0,6}))?$/.exec(s);
  if (!m) throw new Error(`invalid USD amount: ${v}`);
  return BigInt(m[1]) * MICRO + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

/** USD-per-million-tokens price string -> micro-dollars per million tokens. */
export function pricePerMillionMicro(v: string): bigint {
  return parseMicro(v);
}

/** cost in micro-dollars, rounded up so we never under-charge by a fraction. */
export function tokenCostMicro(inTokens: number, outTokens: number, inPerM: bigint, outPerM: bigint): bigint {
  const num = BigInt(inTokens) * inPerM + BigInt(outTokens) * outPerM;
  return (num + 999_999n) / 1_000_000n;
}

/** wei (18 dp) -> decimal string with trailing zeros trimmed: "100000" / "1234.5" */
export function formatToken(wei: bigint, decimals = TOKEN_DECIMALS): string {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export function toBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  if (v === null || v === undefined) return 0n;
  throw new Error(`not a bigint: ${String(v)}`);
}

export const iso = (unix: number) => new Date(unix * 1000).toISOString();
export const nowS = () => Math.floor(Date.now() / 1000);
