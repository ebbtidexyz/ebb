// Pro-rata split of a tide's booked USDG (SPEC.md §5.3):
//   eligible = TWAB >= GRANT_FLOOR and not excluded
//   amount   = floor(booked * twab / Σ eligible twab)   (micro-dollars)
// Floor division dust (booked - Σ amount) is never granted; it stays in the epoch and burns at expiry.
import { getAddress, type Address } from "viem";

export interface Allocation {
  grants: { addr: Address; amount: bigint; twab: bigint }[]; // sorted by address, zero amounts dropped
  total: bigint; // Σ amount  (<= booked)
  dust: bigint; // booked - total
  eligibleTwab: bigint;
  eligible: number;
}

export function allocate(
  booked: bigint,
  twabs: ReadonlyMap<string, bigint>,
  opts: { floor: bigint; excluded: Iterable<string> },
): Allocation {
  if (booked < 0n) throw new Error("allocate: negative booked");
  const excluded = new Set([...opts.excluded].map((a) => a.toLowerCase()));
  const eligible = [...twabs.entries()]
    .map(([a, t]) => [a.toLowerCase(), t] as const)
    .filter(([a, t]) => t >= opts.floor && t > 0n && !excluded.has(a))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const sum = eligible.reduce((s, [, t]) => s + t, 0n);
  const grants: Allocation["grants"] = [];
  let total = 0n;
  if (sum > 0n && booked > 0n) {
    for (const [a, t] of eligible) {
      const amount = (booked * t) / sum;
      if (amount === 0n) continue;
      grants.push({ addr: getAddress(a), amount, twab: t });
      total += amount;
    }
  }
  return { grants, total, dust: booked - total, eligibleTwab: sum, eligible: eligible.length };
}
