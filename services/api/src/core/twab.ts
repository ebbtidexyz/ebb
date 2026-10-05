// Time-weighted average balance over a tide window [start, end) (SPEC.md §5.3 allocator).
// Balance is a step function: each point sets the balance from its timestamp onwards;
// before an address's first point its balance is 0.

export interface BalancePoint {
  ts: number; // unix seconds (block timestamp)
  balance: bigint; // wei
}

/**
 * points: one address's points sorted ascending by (ts, block). Points at or before `start`
 * only set the opening balance; points at or after `end` are ignored.
 * Returns floor(∫ balance dt / (end - start)).
 */
export function twab(points: readonly BalancePoint[], start: number, end: number): bigint {
  if (!(end > start)) throw new Error("twab: empty window");
  let acc = 0n;
  let cur = 0n;
  let curTs = start;
  for (const p of points) {
    if (p.ts <= start) {
      cur = p.balance;
      continue;
    }
    if (p.ts >= end) break;
    acc += cur * BigInt(p.ts - curTs);
    cur = p.balance;
    curTs = p.ts;
  }
  acc += cur * BigInt(end - curTs);
  return acc / BigInt(end - start);
}

/** TWAB for every address; input rows may be interleaved but must be sorted by ts within an address. */
export function twabAll(
  rows: readonly { addr: string; ts: number; balance: bigint }[],
  start: number,
  end: number,
): Map<string, bigint> {
  const by = new Map<string, BalancePoint[]>();
  for (const r of rows) {
    const k = r.addr.toLowerCase();
    let list = by.get(k);
    if (!list) by.set(k, (list = []));
    list.push({ ts: r.ts, balance: r.balance });
  }
  const out = new Map<string, bigint>();
  for (const [addr, pts] of by) {
    pts.sort((a, b) => a.ts - b.ts);
    const v = twab(pts, start, end);
    if (v > 0n) out.set(addr, v);
  }
  return out;
}
