"use client";

import type { Pool } from "@ebb/shared";
import { useNow } from "@/lib/use-now";
import { ebbFraction } from "@/lib/tide";
import { duration, int, toUnix, usd } from "@/lib/format";
import { Empty } from "./ui";

/** Tidepools, oldest first, each with its ebb bar counting down to the Trench. */
export function PoolList({ pools }: { pools: Pool[] }) {
  const now = useNow();
  const nowSec = now === null ? null : now / 1000;
  const sorted = [...pools].sort((a, b) => (toUnix(a.expires_at) ?? 0) - (toUnix(b.expires_at) ?? 0));
  if (!sorted.length)
    return (
      <Empty title="No tidepools yet">
        Hold at least 100,000 $EBB through a whole tide and your first pool floods at the next :00 or :30.
      </Empty>
    );
  return (
    <ul className="divide-y divide-line/60">
      {sorted.map((p, i) => {
        const exp = toUnix(p.expires_at);
        const left = exp !== null && nowSec !== null ? exp - nowSec : null;
        const frac = exp !== null && nowSec !== null ? ebbFraction(exp, nowSec) : 1;
        const urgent = left !== null && left < 86400;
        return (
          <li key={p.tide} className="grid gap-2 px-5 py-4 sm:grid-cols-[7rem_1fr_7rem] sm:items-center sm:gap-5">
            <div className="flex items-baseline justify-between gap-2 sm:block">
              <div className="font-mono text-[12.5px] text-foam tnum">tide #{int(p.tide)}</div>
              {i === 0 ? <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-brass-ink">spent next</div> : null}
            </div>
            <div>
              <div className="relative h-2 overflow-hidden bg-line/60" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label={`Tide ${p.tide}: ${Math.round(frac * 100)}% of its week left`}>
                <div className={`absolute inset-y-0 left-0 ${urgent ? "bg-coral" : "bg-water"}`} style={{ width: `${frac * 100}%`, transition: "width 1s linear" }} />
              </div>
              <div className={`mt-1.5 font-mono text-[11.5px] tnum ${urgent ? "text-coral" : "text-mist"}`}>{left === null ? "—" : left <= 0 ? "drawn into the Trench" : `${duration(left)} to the Trench`}</div>
            </div>
            <div className="font-mono text-[15px] text-foam tnum sm:text-right">{usd(p.remaining)}</div>
          </li>
        );
      })}
    </ul>
  );
}
