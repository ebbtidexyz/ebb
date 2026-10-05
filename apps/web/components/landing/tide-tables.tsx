"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { LAUNCHPAD_KEEP_BPS, TRADER_FEE_BPS, VAULT_FEE_BPS } from "@ebb/shared";
import { almanac, FLOOR, logToValue, nice, tierForTokens, valueToLog, type Almanac } from "@/lib/model";
import { compact, int, shortHash, toNum, usd, utcStamp, toUnix } from "@/lib/format";
import { useLogbook } from "@/lib/queries";
import { Flip, gsap, prefersReduced, useGsap } from "@/lib/gsap";
import { ChartBg, LHead, LSection, revealIn, Scramble } from "./kit";
import { Dial } from "./dial";

const VOL = [10_000, 5_000_000] as const;
const BAG = [10_000, 50_000_000] as const;
const MONEY_CHARS = "0123456789$.,";

function money(n: number) {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n >= 100) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(2)}`;
}

interface Print {
  id: number;
  vol: number;
  bag: number;
  spend: number;
  perTide: number;
  perWeek: number;
}

export function TideTables() {
  const ref = useRef<HTMLDivElement>(null);
  // dial positions 0..1 are the state; values derive from them
  const [tVol, setTVol] = useState(valueToLog(100_000, ...VOL));
  const [tBag, setTBag] = useState(valueToLog(1_000_000, ...BAG));
  const [tElig, setTElig] = useState(0.5625); // 55%
  const [tSpend, setTSpend] = useState(0.25);
  const [mode, setMode] = useState<"model" | "latest">("model");

  const vol = nice(logToValue(tVol, ...VOL));
  const bag = nice(logToValue(tBag, ...BAG));
  const elig = Math.round((0.1 + tElig * 0.8) * 100) / 100;
  const spend = Math.round(tSpend * 100) / 100;
  const a = almanac({ dailyVolume: vol, holding: bag, eligiblePct: elig, spendShare: spend });
  const tier = tierForTokens(bag);

  // the print history: every settled change prints a line; older lines are pushed down with Flip
  const seq = useRef(1);
  const [prints, setPrints] = useState<Print[]>(() => [{ id: 0, vol: 100_000, bag: 1_000_000, spend: 0.25, perTide: a.perTide, perWeek: a.perWeek }]);
  const flipState = useRef<Flip.FlipState | null>(null);
  const latest = useRef({ vol, bag, spend, a });
  latest.current = { vol, bag, spend, a };

  const print = () => {
    // wait a tick so the state from the last onChange has rendered
    requestAnimationFrame(() => {
      const { vol: v, bag: b, spend: s, a: al } = latest.current;
      setPrints((ps) => {
        const top = ps[0];
        if (top && top.vol === v && top.bag === b && top.spend === s) return ps;
        const list = ref.current?.querySelectorAll(".print-row");
        flipState.current = list && !prefersReduced() ? Flip.getState(list) : null;
        return [{ id: seq.current++, vol: v, bag: b, spend: s, perTide: al.perTide, perWeek: al.perWeek }, ...ps].slice(0, 4);
      });
    });
  };

  useLayoutEffect(() => {
    const st = flipState.current;
    if (!st) return;
    flipState.current = null;
    Flip.from(st, {
      targets: ref.current?.querySelectorAll(".print-row"),
      duration: 0.65,
      ease: "tide",
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, yPercent: -60 }, { opacity: 1, yPercent: 0, duration: 0.6, ease: "tide" }),
    });
  }, [prints]);

  useGsap(ref, ({ motion }) => {
    const root = ref.current!;
    if (!motion) return;
    revealIn(root);
    const dials = root.querySelectorAll(".dial");
    gsap.from(dials, { scale: 0.85, opacity: 0, rotate: -40, duration: 1.1, stagger: 0.1, ease: "tide", scrollTrigger: { trigger: root.querySelector("[data-dials]"), start: "top 80%", once: true } });
    const tape = root.querySelector("[data-tape]");
    if (tape) gsap.from(tape, { clipPath: "inset(0% 0% 100% 0%)", y: -30, duration: 1.4, ease: "ebb", scrollTrigger: { trigger: tape, start: "top 80%", once: true } });
  });

  return (
    <LSection id="tide-tables" numeral="IV" label="Tide tables" className="isolate py-28 md:py-40">
      <ChartBg opacity={0.06} />
      <div ref={ref}>
        <LHead
          id="tide-tables"
          numeral="IV"
          kicker="Tide tables"
          coord="the Basin's arithmetic, printed"
          title="The same arithmetic the Basin runs, printed as an almanac."
          lede="Turn a dial and the strip reprints. Every line comes from the fixed fee split in the contract, not from a projection. Switch to the latest tide to read a real entry from the Logbook."
        />

        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <figure>
            <div data-dials className="neatline p-5 sm:p-8">
              <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-4">
                <div>
                  <Dial label="Daily volume" t={tVol} onChange={setTVol} onSettle={print} detents={28} display={`$${compact(vol, 1)}`} valueText={`${usd(vol, { whole: true })} traded per day`} />
                  <Presets values={[25_000, 100_000, 500_000, 2_000_000]} fmt={(v) => `$${compact(v)}`} current={vol} onPick={(v) => (setTVol(valueToLog(v, ...VOL)), print())} />
                </div>
                <div>
                  <Dial label="Your $EBB" t={tBag} onChange={setTBag} onSettle={print} detents={28} display={compact(bag, 2)} valueText={`${int(bag)} EBB held`} />
                  <Presets values={[100_000, 1_000_000, 10_000_000]} fmt={(v) => compact(v)} current={bag} onPick={(v) => (setTBag(valueToLog(v, ...BAG)), print())} />
                </div>
                <div>
                  <Dial
                    label="Eligible supply"
                    t={tElig}
                    onChange={setTElig}
                    onSettle={print}
                    detents={16}
                    display={`${Math.round(elig * 100)}%`}
                    valueText={`${Math.round(elig * 100)} percent of supply held by eligible wallets`}
                  />
                  <p className="mt-2 text-center text-[11px] leading-snug text-mist">pool, curve, vault, treasury and burn address never count</p>
                </div>
                <div>
                  <Dial label="Spend share" t={tSpend} onChange={setTSpend} onSettle={print} detents={20} display={`${Math.round(spend * 100)}%`} valueText={`Holders spend ${Math.round(spend * 100)} percent of their credit`} />
                  <Presets values={[0.15, 0.5, 1]} fmt={(v) => `${Math.round(v * 100)}%`} current={spend} onPick={(v) => (setTSpend(v), print())} />
                </div>
              </div>
            </div>
            <figcaption className="mt-3 flex gap-3 font-mono text-[11px] leading-relaxed text-mist">
              <span className="shrink-0 text-brass-ink">Fig. 4</span>
              <span>Four dials. Drag in a circle and let go, they coast and click into detents. Or focus one with Tab and use the arrow keys.</span>
            </figcaption>

            <div className="mt-10">
              <div className="flex items-baseline justify-between">
                <h3 className="eyebrow">Printed so far</h3>
                <span className="font-mono text-[10.5px] text-mist">newest first</span>
              </div>
              <ol className="mt-3 border-t border-line" aria-live="polite">
                {prints.map((p, i) => (
                  <li key={p.id} data-flip-id={`print-${p.id}`} className={`print-row grid grid-cols-[1fr_auto] items-baseline gap-4 border-b border-line/60 py-2.5 font-mono text-[12px] ${i === 0 ? "text-foam" : "text-mist"}`}>
                    <span className="truncate">
                      ${compact(p.vol, 1)}/day · {compact(p.bag, 2)} $EBB · {Math.round(p.spend * 100)}% spent
                    </span>
                    <span className="tnum">
                      {money(p.perTide)}/tide · <span className={i === 0 ? "text-brass-ink" : ""}>{money(p.perWeek)}/wk</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </figure>

          <div>
            <div role="tablist" aria-label="Almanac source" className="mb-6 inline-flex rounded-[2px] border border-line p-0.5">
              {(["model", "latest"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`rounded-[2px] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${mode === m ? "bg-brass text-on-brass" : "text-mist hover:text-foam"}`}
                >
                  {m === "model" ? "Model day" : "Latest tide"}
                </button>
              ))}
            </div>
            <div data-tape>{mode === "model" ? <ModelTape a={a} spend={spend} bag={bag} tierLabel={tier.label} /> : <LatestTape />}</div>
          </div>
        </div>
      </div>
    </LSection>
  );
}

function Presets({ values, fmt, onPick, current }: { values: number[]; fmt: (v: number) => string; onPick: (v: number) => void; current: number }) {
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-1">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10.5px] transition-colors ${Math.abs(v - current) / v < 0.001 ? "text-brass-ink underline underline-offset-4" : "text-mist hover:text-foam"}`}
        >
          {fmt(v)}
        </button>
      ))}
    </div>
  );
}

function Row({ k, v, strong, tone, plain }: { k: string; v: string; strong?: boolean; tone?: "kelp" | "coral"; plain?: boolean }) {
  const color = tone === "kelp" ? "text-[color:var(--tape-kelp)]" : tone === "coral" ? "text-[color:var(--tape-coral)]" : "";
  return (
    <div className={`flex items-baseline text-[12.5px] leading-7 ${strong ? "font-semibold" : ""}`}>
      <span className="shrink-0">{k}</span>
      <span className="leader" aria-hidden="true" />
      <span className={`shrink-0 ${color}`}>{plain ? v : <Scramble text={v} chars={MONEY_CHARS} duration={0.5} />}</span>
    </div>
  );
}

function Rule() {
  return <div className="my-2 border-t border-dashed border-[color:var(--tape-muted)]/50" aria-hidden="true" />;
}

function ModelTape({ a, spend, bag, tierLabel }: { a: Almanac; spend: number; bag: number; tierLabel: string }) {
  const ai = a.perWeek * spend;
  const burn = a.perWeek - ai;
  return (
    <div className="tape px-5 pb-7 pt-8 sm:px-7">
      <div className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.14em]">
        <span className="font-semibold">Ebb · Tide tables</span>
        <span className="text-[color:var(--tape-muted)]">model day</span>
      </div>
      <div className="mt-1 text-[11px] text-[color:var(--tape-muted)]">48 tides · {VAULT_FEE_BPS / 100}% of volume reaches the Basin</div>
      <Rule />
      <Row k="volume traded" v={money(a.volume)} />
      <Row k={`traders pay · ${TRADER_FEE_BPS / 100}%`} v={money(a.tradersPay)} />
      <Row k={`Pons keeps · ${LAUNCHPAD_KEEP_BPS / 100}%`} v={money(a.pons)} />
      <Row k={`to the Basin · ${VAULT_FEE_BPS / 100}%`} v={money(a.vault)} strong />
      <Row k="treasury · 30%" v={money(a.treasury)} />
      <Row k="credit pool · 70%" v={money(a.pool)} strong />
      <Rule />
      <Row k={`your bag · ${tierLabel}`} v={`${compact(bag, 2)} $EBB`} />
      <Row k="your share of the pool" v={a.eligibleForGrants ? `${(a.share * 100).toFixed(a.share < 0.001 ? 4 : 3)}%` : "below floor"} />
      <Row k="per tide" v={money(a.perTide)} />
      <Row k="per day" v={money(a.perDay)} />
      <Row k="per week" v={money(a.perWeek)} strong />
      <Rule />
      <Row k={`your week as AI · ${Math.round(spend * 100)}%`} v={money(ai)} tone="kelp" />
      <Row k="your week to the Trench" v={money(burn)} tone="coral" />
      <Row k="whole pool / day as AI" v={money(a.poolAiPerDay)} />
      <Row k="whole pool / day burns $EBB" v={money(a.poolBurnPerDay)} />
      <div className="mt-4 flex h-2.5 overflow-hidden" role="img" aria-label={`${Math.round(spend * 100)} percent becomes AI, ${100 - Math.round(spend * 100)} percent buys and burns EBB`}>
        <div className="bg-[color:var(--tape-kelp)]" style={{ width: `${spend * 100}%`, transition: "width 400ms cubic-bezier(.25,.1,.25,1)" }} />
        <div className="flex-1 bg-[repeating-linear-gradient(135deg,var(--tape-coral)_0_2px,transparent_2px_5px)]" />
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] uppercase tracking-[0.1em] text-[color:var(--tape-muted)]">
        <span>AI</span>
        <span>buy + burn</span>
      </div>
      {!a.eligibleForGrants ? (
        <p className="mt-4 text-[11.5px] leading-relaxed">Under the {FLOOR.toLocaleString("en-US")} $EBB floor no new tides flood for this wallet. It can still spend credit it already holds.</p>
      ) : null}
      <Rule />
      <p className="text-[11px] leading-relaxed text-[color:var(--tape-muted)]">A model, not a forecast. Grants follow real volume tide by tide and are never promised.</p>
    </div>
  );
}

function LatestTape() {
  const q = useLogbook(6);
  const entry = q.data?.find((e) => e.status !== "open") ?? q.data?.[0];
  if (q.isLoading)
    return (
      <div className="tape px-7 pb-7 pt-8">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="skeleton my-2 h-4" style={{ width: `${60 + ((i * 17) % 40)}%` }} />
        ))}
      </div>
    );
  if (!entry)
    return (
      <div className="tape px-7 pb-7 pt-8 text-[12.5px]">
        <div className="text-[11px] uppercase tracking-[0.14em]">Ebb · Logbook</div>
        <Rule />
        <p className="leading-relaxed">{q.isError ? "The Logbook is offline right now, so there is no real tide to print." : "No tide has been logged yet. The first entry prints 30 minutes after genesis."}</p>
        <p className="mt-3 text-[11px] text-[color:var(--tape-muted)]">Switch back to the model day to explore the arithmetic.</p>
      </div>
    );
  const used = toNum(entry.used) ?? 0;
  const granted = toNum(entry.granted) ?? 0;
  return (
    <div className="tape px-5 pb-7 pt-8 sm:px-7">
      <div className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.14em]">
        <span className="font-semibold">Ebb · Logbook</span>
        <span className="text-[color:var(--tape-muted)]">tide #{int(entry.tide)}</span>
      </div>
      <div className="mt-1 text-[11px] text-[color:var(--tape-muted)]">
        {utcStamp(toUnix(entry.starts_at))} · {entry.status}
      </div>
      <Rule />
      <Row k="booked to the pool" v={usd(entry.booked)} strong />
      <Row k="granted" v={usd(entry.granted)} />
      <Row k="wallets flooded" v={int(entry.wallets)} />
      <Row k="spent on AI" v={usd(entry.used)} tone="kelp" />
      <Row k="paid to providers" v={usd(entry.withdrawn)} />
      <Row k="still open" v={usd(entry.open)} />
      <Row k="used so far" v={granted > 0 ? `${((used / granted) * 100).toFixed(1)}%` : "—"} />
      <Rule />
      <Row k="grant root" v={shortHash(entry.grant_root, 8, 6)} plain />
      <Row k="commit tx" v={shortHash(entry.commit_tx, 8, 6)} plain />
      {entry.burn ? (
        <>
          <Rule />
          <Row k="drawn into the Trench" v={usd(entry.burn.usdg_in)} tone="coral" />
          <Row k="$EBB burned" v={compact(toNum(entry.burn.ebb_burned), 2)} tone="coral" />
        </>
      ) : null}
      <Rule />
      <p className="text-[11px] leading-relaxed text-[color:var(--tape-muted)]">Printed from /api/logbook. Every figure matches the Basin&apos;s events for this tide.</p>
    </div>
  );
}
