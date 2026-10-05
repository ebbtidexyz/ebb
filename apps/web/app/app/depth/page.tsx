"use client";

import { useMemo, useState } from "react";
import { useConnection } from "wagmi";
import { TIERS } from "@ebb/shared";
import { useHolders } from "@/lib/queries";
import { errorText } from "@/lib/api";
import { explorerAddress } from "@/lib/chains";
import { compact, int, shortHash, tokenNum } from "@/lib/format";
import { Empty, Notice, PageHead, Panel, SkeletonRows, TierBadge } from "@/components/console/ui";

export default function DepthPage() {
  const q = useHolders(100);
  const conn = useConnection();
  const [filter, setFilter] = useState<string>("all");
  const rows = useMemo(() => (q.data ?? []).map((h, i) => ({ ...h, rank: h.rank ?? i + 1, bal: tokenNum(h.balance) })), [q.data]);
  const counts = useMemo(() => Object.fromEntries(TIERS.map((t) => [t.id, rows.filter((r) => r.tier?.toLowerCase() === t.id).length])), [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.tier?.toLowerCase() === filter);
  const me = conn.address?.toLowerCase();
  const abyss = rows.filter((r) => r.tier?.toLowerCase() === "abyss");

  return (
    <>
      <PageHead kicker="Console · depth wall" title="The depth wall" lede="The deepest holders, by current balance. Abyss wallets get their name on the wall; depth never changes what a credit is worth." />
      {q.isLoading ? (
        <Panel pad={false}>
          <SkeletonRows rows={10} cols={4} />
        </Panel>
      ) : q.isError ? (
        <Notice tone="error">{errorText(q.error)}</Notice>
      ) : rows.length === 0 ? (
        <Panel>
          <Empty title="The wall is still blank">Holders appear here once the indexer has read the first transfers.</Empty>
        </Panel>
      ) : (
        <div className="space-y-6">
          {abyss.length ? (
            <Panel title={`Abyss · ${abyss.length}`}>
              <ul className="flex flex-wrap gap-2">
                {abyss.map((r) => (
                  <li key={r.addr} className="border border-brass/60 bg-brass/10 px-3 py-1.5 font-mono text-[12.5px] text-foam">
                    {r.label || shortHash(r.addr, 6, 4)} <span className="text-brass-ink">{compact(r.bal, 1)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          <div role="radiogroup" aria-label="Filter by tier" className="flex flex-wrap gap-1.5">
            {[{ id: "all", label: `All · ${rows.length}` }, ...TIERS.map((t) => ({ id: t.id, label: `${t.label} · ${counts[t.id] ?? 0}` }))].map((f) => (
              <button
                key={f.id}
                role="radio"
                aria-checked={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-[2px] border px-2.5 py-1 font-mono text-[11.5px] transition-colors ${filter === f.id ? "border-brass text-foam" : "border-line text-mist hover:text-foam"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Panel pad={false}>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[560px]">
                <thead>
                  <tr>
                    <th scope="col" className="num w-16">#</th>
                    <th scope="col">Holder</th>
                    <th scope="col">Tier</th>
                    <th scope="col" className="num">$EBB</th>
                    <th scope="col" className="num">Supply</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const mine = me && r.addr.toLowerCase() === me;
                    return (
                      <tr key={r.addr} className={mine ? "bg-brass/10" : ""}>
                        <td className="num font-mono text-[12px] text-mist">{int(r.rank)}</td>
                        <td>
                          <a href={explorerAddress(r.addr)} target="_blank" rel="noreferrer noopener" className="font-mono text-[12.5px] text-foam hover:text-brass-ink">
                            {r.label || shortHash(r.addr, 8, 6)}
                          </a>
                          {mine ? <span className="ml-2 font-mono text-[10.5px] uppercase text-brass-ink">you</span> : null}
                        </td>
                        <td>
                          <TierBadge tier={r.tier} />
                        </td>
                        <td className="num font-mono text-[12.5px] text-foam">{r.bal !== null ? int(r.bal) : "—"}</td>
                        <td className="num font-mono text-[12px] text-mist">{r.bal !== null ? `${((r.bal / 1e9) * 100).toFixed(3)}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
