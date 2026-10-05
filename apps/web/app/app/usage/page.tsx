"use client";

import { useMemo } from "react";
import { useSessionKey } from "@/lib/session-key";
import { useUsage, type UsageRow } from "@/lib/queries";
import { errorText } from "@/lib/api";
import { int, toNum, toUnix, usd, utcStamp } from "@/lib/format";
import { KeyPicker } from "@/components/console/key-picker";
import { Empty, Notice, PageHead, Panel, SkeletonRows } from "@/components/console/ui";

export default function UsagePage() {
  const [key] = useSessionKey();
  const usage = useUsage(key);
  const rows = usage.data ?? [];
  return (
    <>
      <PageHead kicker="Console · usage" title="Usage" lede="Every request made with this key: tokens, model and what it cost, at list price." />
      <div className="space-y-6">
        <KeyPicker />
        {!key ? null : usage.isLoading ? (
          <Panel title="Requests" pad={false}>
            <SkeletonRows rows={6} cols={5} />
          </Panel>
        ) : usage.isError ? (
          <Notice tone="error">{errorText(usage.error)}</Notice>
        ) : rows.length === 0 ? (
          <Panel title="Requests">
            <Empty title="No requests yet">Send something from the Playground, or point a client at the gateway with this key.</Empty>
          </Panel>
        ) : (
          <>
            <Totals rows={rows} />
            <Panel title="Spend per day · UTC" aside={<span className="font-mono text-[11px] text-mist">last 14 days</span>}>
              <DailyChart rows={rows} />
            </Panel>
            <Panel title={`Requests · ${rows.length}`} pad={false}>
              <div className="overflow-x-auto">
                <table className="data-table min-w-[680px]">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Model</th>
                      <th scope="col" className="num">In</th>
                      <th scope="col" className="num">Out</th>
                      <th scope="col" className="num">Cost</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap font-mono text-[12px] text-mist">{utcStamp(toUnix(r.created_at))}</td>
                        <td className="font-mono text-[12.5px] text-foam">{r.model}</td>
                        <td className="num font-mono text-[12.5px]">{int(r.in_tokens)}</td>
                        <td className="num font-mono text-[12.5px]">{int(r.out_tokens)}</td>
                        <td className="num font-mono text-[12.5px] text-foam">{usd(r.cost, { precise: true })}</td>
                        <td>
                          <span className={`font-mono text-[11px] uppercase tracking-[0.08em] ${/ok|success|settled|done|complete/i.test(r.status) ? "text-kelp" : /error|fail/i.test(r.status) ? "text-coral" : "text-mist"}`}>{r.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}
      </div>
    </>
  );
}

function Totals({ rows }: { rows: UsageRow[] }) {
  const cost = rows.reduce((s, r) => s + (toNum(r.cost) ?? 0), 0);
  const tin = rows.reduce((s, r) => s + (r.in_tokens || 0), 0);
  const tout = rows.reduce((s, r) => s + (r.out_tokens || 0), 0);
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden border border-line bg-line md:grid-cols-4">
      {[
        ["Requests", int(rows.length)],
        ["Spent", usd(cost)],
        ["Input tokens", int(tin)],
        ["Output tokens", int(tout)],
      ].map(([k, v]) => (
        <div key={k} className="bg-abyss px-5 py-4">
          <dt className="eyebrow">{k}</dt>
          <dd className="mt-1.5 font-display text-2xl text-foam tnum">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function DailyChart({ rows }: { rows: UsageRow[] }) {
  const days = useMemo(() => {
    const today = Math.floor(Date.now() / 86400000);
    const buckets = Array.from({ length: 14 }, (_, i) => ({ day: today - 13 + i, cost: 0, n: 0 }));
    for (const r of rows) {
      const t = toUnix(r.created_at);
      if (t === null) continue;
      const d = Math.floor(t / 86400);
      const b = buckets.find((x) => x.day === d);
      if (b) {
        b.cost += toNum(r.cost) ?? 0;
        b.n += 1;
      }
    }
    return buckets;
  }, [rows]);
  const max = Math.max(...days.map((d) => d.cost), 0.000001);
  const W = 700;
  const H = 180;
  const bw = W / days.length;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 24}`} className="h-auto w-full" role="img" aria-label={`Daily spend over the last 14 days. Highest day ${usd(max)}.`}>
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1="0" x2={W} y1={H - H * f * 0.9} y2={H - H * f * 0.9} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={W} y={H - H * f * 0.9 - 4} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--mist)">
              {usd(max * f)}
            </text>
          </g>
        ))}
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
        {days.map((d, i) => {
          const h = (d.cost / max) * H * 0.9;
          const date = new Date(d.day * 86400000);
          return (
            <g key={d.day}>
              <rect x={i * bw + bw * 0.22} y={H - h} width={bw * 0.56} height={Math.max(h, d.n ? 1.5 : 0)} fill="var(--kelp)" fillOpacity={i === days.length - 1 ? 0.95 : 0.6}>
                <title>{`${date.toISOString().slice(0, 10)}: ${usd(d.cost)} over ${d.n} requests`}</title>
              </rect>
              {i % 2 === 1 || i === days.length - 1 ? (
                <text x={i * bw + bw / 2} y={H + 16} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--mist)">
                  {date.getUTCDate()}/{date.getUTCMonth() + 1}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
