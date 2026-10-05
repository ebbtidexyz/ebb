"use client";

import { useRef, useState } from "react";
import { LAUNCHPAD_KEEP_BPS, TRADER_FEE_BPS, TREASURY_SPLIT, VAULT_FEE_BPS } from "@ebb/shared";
import { feeSplit } from "@/lib/model";
import { r2 } from "@/lib/format";
import { gsap, useGsap } from "@/lib/gsap";
import { LHead, LSection, revealIn } from "./kit";

const W = 820;
const S = 0.088; // px per dollar: $3,000 → 264 px
const X = [128, 336, 528, 690];
const GAP = 16;
const f = feeSplit(100_000);

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (bps: number) => `${bps / 100}%`;
const SEG_COLORS = ["var(--brass)", "var(--water)", "var(--kelp)", "var(--mist)", "var(--coral)"];

/** centre-line of a flow from (x0, y0) to (x1, y1) */
const flow = (x0: number, y0: number, x1: number, y1: number) => {
  const m = (x0 + x1) / 2;
  return `M${r2(x0)} ${r2(y0)} C${r2(m)} ${r2(y0)} ${r2(m)} ${r2(y1)} ${r2(x1)} ${r2(y1)}`;
};

/** geometry of the whole sankey for a spend share */
function geo(spend: number) {
  const ai = f.pool * spend;
  const burn = f.pool - ai;
  const tr = { y: 70, h: f.tradersPay * S };
  const lp = { y: 40, h: f.pons * S };
  const bs = { y: 120, h: f.vault * S };
  const ts = { y: 86, h: f.treasury * S };
  const pl = { y: 210, h: f.pool * S };
  const aiN = { y: 216, h: ai * S };
  const brN = { y: 216 + ai * S + GAP, h: burn * S };
  return {
    ai,
    burn,
    tr,
    lp,
    bs,
    ts,
    pl,
    aiN,
    brN,
    flows: {
      launch: { d: flow(X[0] + 10, tr.y + lp.h / 2, X[1], lp.y + lp.h / 2), w: lp.h },
      basin: { d: flow(X[0] + 10, tr.y + lp.h + bs.h / 2, X[1], bs.y + bs.h / 2), w: bs.h },
      treasury: { d: flow(X[1] + 10, bs.y + ts.h / 2, X[2], ts.y + ts.h / 2), w: ts.h },
      pool: { d: flow(X[1] + 10, bs.y + ts.h + pl.h / 2, X[2], pl.y + pl.h / 2), w: pl.h },
      ai: { d: flow(X[2] + 10, pl.y + aiN.h / 2, X[3], aiN.y + aiN.h / 2), w: Math.max(0.01, aiN.h) },
      burn: { d: flow(X[2] + 10, pl.y + aiN.h + brN.h / 2, X[3], brN.y + brN.h / 2), w: Math.max(0.01, brN.h) },
    },
  };
}

const ORDER = ["launch", "basin", "treasury", "pool", "ai", "burn"] as const;
const FLOW_STYLE: Record<(typeof ORDER)[number], { stroke: string; opacity: number }> = {
  launch: { stroke: "var(--mist)", opacity: 0.22 },
  basin: { stroke: "var(--brass)", opacity: 0.28 },
  treasury: { stroke: "var(--mist)", opacity: 0.22 },
  pool: { stroke: "var(--water)", opacity: 0.55 },
  ai: { stroke: "var(--kelp)", opacity: 0.55 },
  burn: { stroke: "url(#sk-hatch)", opacity: 1 },
};

export function Charts() {
  const ref = useRef<HTMLDivElement>(null);
  const [spend, setSpend] = useState(0.25);
  const g0 = useRef(geo(0.25)).current;
  const api = useRef<(s: number) => void>(() => {});

  const onSpend = (s: number) => {
    setSpend(s);
    api.current(s);
  };

  useGsap(ref, ({ motion }) => {
    const root = ref.current!;
    const svg = root.querySelector<SVGSVGElement>("[data-sankey]")!;
    const paths = Object.fromEntries(ORDER.map((k) => [k, svg.querySelector<SVGPathElement>(`[data-flow='${k}']`)!])) as Record<(typeof ORDER)[number], SVGPathElement>;
    const nodes = Object.fromEntries(["aiN", "brN"].map((k) => [k, svg.querySelector<SVGRectElement>(`[data-node='${k}']`)!]));
    const labels = Object.fromEntries(["ai", "burn"].map((k) => [k, svg.querySelector<SVGGElement>(`[data-label='${k}']`)!]));
    const vals = Array.from(svg.querySelectorAll<SVGTextElement>("[data-count]"));
    const aiVal = svg.querySelector<SVGTextElement>("[data-v='ai']")!;
    const burnVal = svg.querySelector<SVGTextElement>("[data-v='burn']")!;
    const cur = { ai: g0.ai, burn: g0.burn };

    // spend share: reflow the last two flows (stroke-width + path), nodes and labels follow
    api.current = (s: number) => {
      const g = geo(s);
      const d = motion ? 0.6 : 0;
      for (const k of ["ai", "burn"] as const) gsap.to(paths[k], { attr: { "stroke-width": g.flows[k].w, d: g.flows[k].d }, duration: d, ease: "tide", overwrite: "auto" });
      gsap.to(nodes.aiN, { attr: { y: g.aiN.y, height: Math.max(0.01, g.aiN.h) }, duration: d, ease: "tide", overwrite: "auto" });
      gsap.to(nodes.brN, { attr: { y: g.brN.y, height: Math.max(0.01, g.brN.h) }, duration: d, ease: "tide", overwrite: "auto" });
      gsap.to(labels.ai, { y: g.aiN.y + g.aiN.h / 2 - (g0.aiN.y + g0.aiN.h / 2), duration: d, ease: "tide", overwrite: "auto" });
      gsap.to(labels.burn, { y: g.brN.y + g.brN.h / 2 - (g0.brN.y + g0.brN.h / 2), duration: d, ease: "tide", overwrite: "auto" });
      gsap.to(cur, {
        ai: g.ai,
        burn: g.burn,
        duration: d,
        ease: "tide",
        overwrite: "auto",
        onUpdate: () => {
          aiVal.textContent = fmt(cur.ai);
          burnVal.textContent = fmt(cur.burn);
        },
        onComplete: () => {
          aiVal.textContent = fmt(g.ai);
          burnVal.textContent = fmt(g.burn);
        },
      });
    };

    const ring = root.querySelector<SVGSVGElement>("[data-ring]")!;
    const segs = Array.from(ring.querySelectorAll<SVGPathElement>("[data-seg]"));
    if (!motion) return;
    revealIn(root);

    // every flow draws in order, the figures count up as their flow lands
    gsap.set(Object.values(paths), { drawSVG: "0%" });
    gsap.set(svg.querySelectorAll("[data-node]"), { scaleY: 0, transformOrigin: "50% 50%", transformBox: "fill-box" });
    gsap.set(svg.querySelectorAll("[data-label], [data-basin]"), { opacity: 0 });
    const tl = gsap.timeline({ scrollTrigger: { trigger: svg, start: "top 72%", once: true }, defaults: { ease: "tide" } });
    tl.to(svg.querySelector("[data-node='tr']"), { scaleY: 1, duration: 0.6 }).to(svg.querySelector("[data-label='tr']"), { opacity: 1, duration: 0.4 }, "<0.2");
    const steps: [(typeof ORDER)[number], string, string][] = [
      ["launch", "lp", "lp"],
      ["basin", "bs", "basin"],
      ["treasury", "ts", "ts"],
      ["pool", "pl", "pl"],
      ["ai", "aiN", "ai"],
      ["burn", "brN", "burn"],
    ];
    steps.forEach(([k, node, label], i) => {
      const at = 0.35 + i * 0.32;
      tl.to(paths[k], { drawSVG: "100%", duration: 0.75, ease: "ebb" }, at)
        .to(svg.querySelector(`[data-node='${node}']`), { scaleY: 1, duration: 0.5 }, at + 0.5)
        .to(svg.querySelector(`[data-label='${label}']`) ?? svg.querySelector("[data-basin]"), { opacity: 1, duration: 0.4 }, at + 0.55);
    });
    tl.to(svg.querySelector("[data-basin]"), { opacity: 1, duration: 0.4 }, 0.9);
    vals.forEach((el) => {
      const to = Number(el.dataset.count);
      const o = { v: 0 };
      el.textContent = fmt(0);
      const lbl = el.closest("[data-label], [data-basin]");
      const idx = steps.findIndex(([, , l]) => lbl?.getAttribute("data-label") === l || (l === "basin" && lbl?.hasAttribute("data-basin")));
      tl.to(o, { v: to, duration: 1.1, ease: "ebb", snap: { v: 1 }, onUpdate: () => (el.textContent = fmt(o.v)) }, idx < 0 ? 0.2 : 0.35 + idx * 0.32 + 0.45);
    });

    // treasury ring: segments draw one after another
    gsap.set(segs, { drawSVG: "0%" });
    gsap.to(segs, { drawSVG: "100%", duration: 0.8, stagger: 0.28, ease: "ebb", scrollTrigger: { trigger: ring, start: "top 75%", once: true } });
    gsap.from(root.querySelectorAll("[data-seg-row]"), { x: -20, opacity: 0, duration: 0.7, stagger: 0.28, ease: "tide", scrollTrigger: { trigger: ring, start: "top 75%", once: true } });
  });

  const g = g0;
  return (
    <LSection id="charts" numeral="VII" label="Charts" className="py-28 md:py-40">
      <div ref={ref}>
        <LHead
          id="charts"
          numeral="VII"
          kicker="Charts"
          coord="per $100,000 traded"
          title="Where $100,000 of trading goes, to the dollar."
          lede="Trading fees are the only engine at launch. Slide the spend share to see the credit pool divide between AI and the Trench."
        />

        <figure>
          <div className="neatline grid gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_260px] lg:gap-10">
            <div className="-mx-2 overflow-x-auto px-2">
              <svg data-sankey viewBox={`0 0 ${W} 440`} className="h-auto w-full min-w-[620px]" role="img" aria-labelledby="sankey-t">
                <title id="sankey-t">{`Per $100,000 traded: traders pay ${fmt(f.tradersPay)} in Pons fees. Pons keeps ${fmt(f.pons)} and ${fmt(f.vault)} reaches the Basin. ${fmt(f.treasury)} goes to the treasury and ${fmt(f.pool)} to the credit pool. At ${Math.round(spend * 100)}% spend, ${fmt(f.pool * spend)} becomes AI and ${fmt(f.pool * (1 - spend))} buys and burns $EBB.`}</title>
                <defs>
                  <pattern id="sk-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="7" height="7" fill="var(--coral)" fillOpacity="0.14" />
                    <line x1="0" y1="0" x2="0" y2="7" stroke="var(--coral)" strokeOpacity="0.7" strokeWidth="1.4" />
                  </pattern>
                </defs>
                {ORDER.map((k) => (
                  <path key={k} data-flow={k} d={g.flows[k].d} fill="none" stroke={FLOW_STYLE[k].stroke} strokeOpacity={FLOW_STYLE[k].opacity} strokeWidth={g.flows[k].w} strokeLinecap="butt" />
                ))}
                <rect data-node="tr" x={X[0]} y={g.tr.y} width="10" height={g.tr.h} fill="var(--foam)" />
                <rect data-node="lp" x={X[1]} y={g.lp.y} width="10" height={g.lp.h} fill="var(--mist)" />
                <rect data-node="bs" x={X[1]} y={g.bs.y} width="10" height={g.bs.h} fill="var(--brass)" />
                <rect data-node="ts" x={X[2]} y={g.ts.y} width="10" height={g.ts.h} fill="var(--mist)" />
                <rect data-node="pl" x={X[2]} y={g.pl.y} width="10" height={g.pl.h} fill="var(--water)" />
                <rect data-node="aiN" x={X[3]} y={g.aiN.y} width="10" height={g.aiN.h} fill="var(--kelp)" />
                <rect data-node="brN" x={X[3]} y={g.brN.y} width="10" height={g.brN.h} fill="var(--coral)" />

                <Label k="tr" x={X[0] - 12} y={g.tr.y + g.tr.h / 2 - 6} anchor="end" name={`Traders pay ${pct(TRADER_FEE_BPS)}`} value={f.tradersPay} />
                <Label k="lp" x={X[1] + 22} y={g.lp.y + g.lp.h / 2 - 6} name={`Pons keeps ${pct(LAUNCHPAD_KEEP_BPS)}`} value={f.pons} />
                <Label k="ts" x={X[2] + 22} y={g.ts.y + g.ts.h / 2 - 6} name="Treasury 30%" value={f.treasury} />
                <Label k="pl" x={X[2] + 22} y={g.pl.y + g.pl.h + 18} name="Credit pool 70%" value={f.pool} />
                <Label k="ai" x={X[3] + 22} y={g.aiN.y + g.aiN.h / 2 - 6} name="Becomes AI" value={g.ai} tone="kelp" live="ai" />
                <Label k="burn" x={X[3] + 22} y={g.brN.y + g.brN.h / 2 - 6} name="Buys + burns" value={g.burn} tone="coral" live="burn" />
                <g data-basin>
                  <rect x={X[1] - 104} y={g.bs.y + g.bs.h / 2 - 24} width="94" height="44" fill="var(--abyss)" fillOpacity="0.9" stroke="var(--brass)" strokeOpacity="0.7" />
                  <text x={X[1] - 57} y={g.bs.y + g.bs.h / 2 - 8} textAnchor="middle" fontSize="10" letterSpacing="1.2" fontFamily="var(--font-mono)" fill="var(--brass-ink)">
                    THE BASIN
                  </text>
                  <text data-count={f.vault} x={X[1] - 57} y={g.bs.y + g.bs.h / 2 + 12} textAnchor="middle" fontSize="16" fontFamily="var(--font-display)" fill="var(--foam)">
                    {fmt(f.vault)}
                  </text>
                </g>
              </svg>
            </div>
            <div className="lg:border-l lg:border-line lg:pl-8">
              <label className="block">
                <span className="flex items-baseline justify-between">
                  <span className="eyebrow">Share holders spend</span>
                  <span className="font-mono text-lg text-foam tnum">{Math.round(spend * 100)}%</span>
                </span>
                <input
                  type="range"
                  className="range mt-2"
                  min={0}
                  max={100}
                  value={Math.round(spend * 100)}
                  onChange={(e) => onSpend(Number(e.target.value) / 100)}
                  style={{ ["--fill" as string]: `${spend * 100}%` }}
                  aria-valuetext={`${Math.round(spend * 100)} percent`}
                />
              </label>
              <dl className="mt-4 grid gap-x-6 border-t border-line pt-3 font-mono text-[12px] sm:grid-cols-2 lg:grid-cols-1">
                {[
                  ["traders pay", fmt(f.tradersPay)],
                  ["Pons keeps", fmt(f.pons)],
                  [`the Basin · ${pct(VAULT_FEE_BPS)}`, fmt(f.vault)],
                  ["treasury", fmt(f.treasury)],
                  ["credit pool", fmt(f.pool)],
                  ["becomes AI", fmt(f.pool * spend)],
                  ["buys + burns", fmt(f.pool * (1 - spend))],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 border-b border-line/50 py-1.5">
                    <dt className="text-mist">{k}</dt>
                    <dd className="text-foam tnum">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[13px] leading-relaxed text-mist">At any spend share, the whole credit pool goes back to holders: as AI they used, or as a burn that shrinks supply.</p>
            </div>
          </div>
          <figcaption className="mt-3 flex gap-3 font-mono text-[11px] leading-relaxed text-mist">
            <span className="shrink-0 text-brass-ink">Fig. 8</span>
            <span>The fee split per $100,000 of volume, widths to scale: 1% Pons base fee + 2% creator tax, on the curve and after graduation alike. Hatched coral is what the Trench takes.</span>
          </figcaption>
        </figure>

        <div className="mt-20 grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <figure className="mx-auto w-full max-w-[380px]">
            <TreasuryRing />
          </figure>
          <div>
            <div className="flex items-baseline justify-between">
              <h3 data-reveal className="font-display text-3xl text-foam">
                The treasury&apos;s 30%
              </h3>
              <span className="font-mono text-[12px] text-mist">35 · 20 · 15 · 20 · 10</span>
            </div>
            <ul className="mt-5 divide-y divide-line/70 border-y border-line">
              {TREASURY_SPLIT.map((s, i) => (
                <li key={s.key} data-seg-row className="grid grid-cols-[14px_1fr_auto] items-baseline gap-3 py-3">
                  <span className="h-2.5 w-2.5 self-center rounded-full" style={{ background: SEG_COLORS[i] }} aria-hidden="true" />
                  <span>
                    <span className="text-[14.5px] text-foam">{s.label}</span>
                    <span className="ml-2 text-[13px] text-mist">{s.note}</span>
                  </span>
                  <span className="font-mono text-[13px] text-foam tnum">{s.pct}%</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 font-mono text-[11px] text-mist">
              <span className="text-brass-ink">Fig. 9</span> Published monthly in Soundings, with a transaction link for every movement.
            </p>
          </div>
        </div>
      </div>
    </LSection>
  );
}

function Label({ k, x, y, name, value, anchor = "start", tone, live }: { k: string; x: number; y: number; name: string; value: number; anchor?: "start" | "end"; tone?: "kelp" | "coral"; live?: "ai" | "burn" }) {
  const color = tone === "kelp" ? "var(--kelp)" : tone === "coral" ? "var(--coral)" : "var(--foam)";
  return (
    <g data-label={k}>
      <text x={x} y={y} textAnchor={anchor} fontSize="10.5" letterSpacing="0.5" fontFamily="var(--font-mono)" fill="var(--mist)">
        {name}
      </text>
      <text x={x} y={y + 19} textAnchor={anchor} fontSize="17" fontFamily="var(--font-display)" fill={color} data-count={live ? undefined : value} data-v={live}>
        {fmt(value)}
      </text>
    </g>
  );
}

function TreasuryRing() {
  const R = 120;
  const C = 160;
  let acc = 0;
  const arcs = TREASURY_SPLIT.map((s, i) => {
    const gap = 1.6; // degrees between segments
    const a0 = acc * 3.6 + gap / 2;
    const a1 = (acc + s.pct) * 3.6 - gap / 2;
    acc += s.pct;
    const p = (deg: number) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return `${r2(C + R * Math.cos(a))} ${r2(C + R * Math.sin(a))}`;
    };
    return { key: s.key, d: `M${p(a0)} A${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`, color: SEG_COLORS[i], pct: s.pct, label: s.label, mid: (a0 + a1) / 2 };
  });
  return (
    <svg data-ring viewBox="0 0 320 320" className="h-auto w-full" role="img" aria-label="Treasury split: operations 35%, provider float 20%, free demo 15%, growth 20%, reserve 10%.">
      <circle cx={C} cy={C} r={R} fill="none" stroke="var(--line)" strokeWidth="26" strokeOpacity="0.5" />
      {arcs.map((a) => (
        <path key={a.key} data-seg d={a.d} fill="none" stroke={a.color} strokeWidth="26" strokeOpacity={a.key === "reserve" ? 0.85 : 0.75} />
      ))}
      {arcs.map((a) => {
        const rad = ((a.mid - 90) * Math.PI) / 180;
        return (
          <text key={a.key} x={r2(C + R * Math.cos(rad))} y={r2(C + R * Math.sin(rad) + 4)} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill="var(--abyss)" fontWeight="600">
            {a.pct}
          </text>
        );
      })}
      <text x={C} y={C - 6} textAnchor="middle" fontSize="11" letterSpacing="2" fontFamily="var(--font-mono)" fill="var(--mist)">
        TREASURY
      </text>
      <text x={C} y={C + 24} textAnchor="middle" fontSize="30" fontFamily="var(--font-display)" fill="var(--foam)">
        {fmt(f.treasury)}
      </text>
      <text x={C} y={C + 44} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--mist)">
        per $100k traded
      </text>
    </svg>
  );
}
