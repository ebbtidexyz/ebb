"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { TIERS } from "@ebb/shared";
import { compact, int } from "@/lib/format";
import { logToValue, nice, tierForTokens, valueToLog } from "@/lib/model";
import { Draggable, Flip, gsap, prefersReduced, ScrollTrigger, useGsap } from "@/lib/gsap";
import { IconCheck, IconClose } from "../site/icons";
import { LHead, LSection, revealIn, Scramble } from "./kit";
import { stage } from "./three/store";

const MIN = 1_000;
const MAX = 100_000_000;
const W = 320;
const H = 640;
const TOP = 96; // the surface
const BOT = H - 24;
const LINE_X = 168;
const yOf = (v: number) => TOP + 22 + valueToLog(Math.max(MIN, Math.min(MAX, v)), MIN, MAX) * (BOT - TOP - 22);
const tierMin = (i: number) => Number(TIERS[i].min / 10n ** 18n);

export function Depth() {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(valueToLog(1_700_000, MIN, MAX));
  const bag = nice(logToValue(t, MIN, MAX));
  const tier = tierForTokens(bag);
  const flip = useRef<Flip.FlipState | null>(null);
  const lastFlip = useRef<gsap.core.Timeline | null>(null);
  const api = useRef<{ toBag: (b: number, instant?: boolean) => void; syncHandle: (t: number) => void }>({ toBag: () => {}, syncHandle: () => {} });
  const dragging = useRef(false);

  /** set the slider position; captures a Flip state when the tier is about to change */
  const move = (nt: number) => {
    const nb = nice(logToValue(nt, MIN, MAX));
    if (tierForTokens(nb).id !== tier.id && !prefersReduced()) {
      lastFlip.current?.progress(1).kill();
      flip.current = Flip.getState(ref.current!.querySelectorAll("[data-flip-id]"));
    }
    setT(nt);
  };
  const moveRef = useRef(move);
  moveRef.current = move;

  // the badge (and the card highlight) move to the new tier
  useLayoutEffect(() => {
    const st = flip.current;
    if (!st) return;
    flip.current = null;
    lastFlip.current = Flip.from(st, { duration: 0.7, ease: "tide", scale: true, nested: true });
  }, [tier.id]);

  // lead weight and tether follow the bag
  useLayoutEffect(() => {
    api.current.toBag(bag);
    if (!dragging.current) api.current.syncHandle(t);
  }, [bag, t]);

  useGsap(ref, ({ motion, desktop }) => {
    const root = ref.current!;
    const fig = root.querySelector<SVGSVGElement>("[data-depth-fig]")!;
    const lead = fig.querySelector<SVGGElement>("[data-lead]")!;
    const tether = fig.querySelector<SVGLineElement>("[data-tether]")!;
    const sound = fig.querySelector<SVGPathElement>("[data-sound]")!;
    const track = root.querySelector<HTMLElement>("[data-track]")!;
    const handle = root.querySelector<HTMLElement>("[data-handle]")!;
    const buoy = stage.models.buoy;
    buoy.anchor = desktop ? root.querySelector<HTMLElement>("[data-buoy]") : null;

    api.current.toBag = (b: number) => {
      const y = yOf(b);
      gsap.to(lead, { y, duration: motion ? 0.7 : 0, ease: "back.out(1.4)", overwrite: "auto" });
      gsap.to(tether, { attr: { y2: y - 16 }, duration: motion ? 0.7 : 0, ease: "back.out(1.4)", overwrite: "auto" });
      // the buoy dips a little as the line pays out
      if (desktop) gsap.fromTo(buoy, { sink2: 0.05 }, { sink2: 0, duration: 1.2, ease: "elastic.out(1, 0.4)", overwrite: "auto" });
    };
    api.current.syncHandle = (nt: number) => gsap.set(handle, { x: nt * (track.clientWidth - handle.offsetWidth) });
    gsap.set(lead, { y: yOf(nice(logToValue(t, MIN, MAX))) });
    gsap.set(tether, { attr: { y2: yOf(nice(logToValue(t, MIN, MAX))) - 16 } });
    api.current.syncHandle(t);

    if (desktop)
      ScrollTrigger.create({
        trigger: fig,
        start: "top 85%",
        end: "bottom 15%",
        onToggle: (self) => gsap.to(buoy, { show: self.isActive ? 1 : 0, duration: motion ? 0.9 : 0, overwrite: "auto" }),
      });

    if (motion) {
      revealIn(root);
      gsap.fromTo(sound, { drawSVG: "0%" }, { drawSVG: "100%", ease: "none", scrollTrigger: { trigger: fig, start: "top 75%", end: "bottom 55%", scrub: true } });
      gsap.from(fig.querySelectorAll("[data-tier-mark]"), { opacity: 0, x: 16, stagger: 0.12, duration: 0.8, ease: "tide", scrollTrigger: { trigger: fig, start: "top 60%", once: true } });
      // the buoy rides a slow swell
      if (desktop) gsap.to(buoy, { sink: -0.07, rz: 0.09, duration: 1.8, ease: "sine.inOut", yoyo: true, repeat: -1 });
    }

    const d = Draggable.create(handle, {
      type: "x",
      bounds: track,
      inertia: motion,
      onPress() {
        dragging.current = true;
      },
      onDrag() {
        moveRef.current(this.x / Math.max(1, this.maxX));
      },
      onThrowUpdate() {
        moveRef.current(this.x / Math.max(1, this.maxX));
      },
      onRelease() {
        if (!this.tween || !this.tween.isActive()) dragging.current = false;
      },
      onThrowComplete() {
        dragging.current = false;
      },
    })[0];
    const onResize = () => api.current.syncHandle(Number((root.querySelector("[data-range]") as HTMLInputElement).value) / 1000);
    window.addEventListener("resize", onResize);
    return () => {
      d.kill();
      window.removeEventListener("resize", onResize);
      buoy.anchor = null;
    };
  });

  return (
    <LSection id="depth" numeral="VI" label="Depth" className="py-28 md:py-40">
      <div ref={ref}>
        <LHead
          id="depth"
          numeral="VI"
          kicker="Depth"
          coord="Shore · Reef · Shelf · Abyss"
          title="Hold it. That is the whole setup."
          lede="No staking, no locking, no second token. Depth buys room, not priority: every credit is worth the same dollar of usage, and grants are strictly pro-rata to time-weighted balance."
        />

        <div className="grid gap-12 md:grid-cols-[minmax(0,340px)_1fr] lg:grid-cols-[380px_1fr] lg:gap-16">
          <figure className="relative">
            <div data-buoy aria-hidden="true" className="pointer-events-none absolute aspect-square w-[34%] -translate-x-1/2" style={{ left: `${(LINE_X / W) * 100}%`, top: `${((TOP - 74) / H) * 100}%` }} />
            <svg data-depth-fig viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label={`Sounding line: a bag of ${int(bag)} EBB hangs at ${tier.label} depth.`}>
              <defs>
                <linearGradient id="depth-sea" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="var(--water)" stopOpacity="0.08" />
                  <stop offset="1" stopColor="var(--water)" stopOpacity="0.5" />
                </linearGradient>
              </defs>
              <rect x="86" y={TOP} width={W - 86} height={BOT - TOP} fill="url(#depth-sea)" />
              {/* surface swell */}
              <g className="motion-safe:[animation:wave-x_6s_linear_infinite]">
                <path d={`M46 ${TOP} ${Array.from({ length: 9 }, () => "q10 -5 20 0 t20 0").join(" ")}`} fill="none" stroke="var(--foam)" strokeOpacity="0.55" />
              </g>
              {/* tier bands */}
              {TIERS.map((tr, i) => {
                const y0 = i === 0 ? TOP : yOf(tierMin(i));
                const y1 = i === TIERS.length - 1 ? BOT : yOf(tierMin(i + 1));
                const on = tr.id === tier.id;
                return (
                  <g key={tr.id} data-tier-mark>
                    <rect x="86" y={y0} width={W - 86} height={y1 - y0} fill="var(--brass)" fillOpacity={on ? 0.1 : 0} style={{ transition: "fill-opacity 400ms" }} />
                    {i > 0 ? <line x1="86" x2={W} y1={y0} y2={y0} stroke="var(--line)" strokeDasharray="3 3" /> : null}
                    <text x={W - 6} y={y0 + 22} textAnchor="end" fontSize="19" fontStyle="italic" fontFamily="var(--font-display)" fill={on ? "var(--foam)" : "var(--mist)"} style={{ transition: "fill 300ms" }}>
                      {tr.label}
                    </text>
                    <text x={W - 6} y={y0 + 38} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--mist)" opacity="0.8">
                      {i === 0 ? "hold 0" : `≥ ${compact(tierMin(i), 0)}`}
                    </text>
                  </g>
                );
              })}
              {/* log scale */}
              <line x1="76" x2="76" y1={TOP + 22} y2={BOT} stroke="var(--mist)" strokeOpacity="0.6" />
              {[1e3, 1e4, 1e5, 1e6, 1e7, 1e8].map((v) => (
                <g key={v}>
                  <line x1="68" x2="84" y1={yOf(v)} y2={yOf(v)} stroke="var(--mist)" />
                  <text x="60" y={yOf(v) + 4} textAnchor="end" fontSize="11" fontFamily="var(--font-mono)" fill="var(--mist)">
                    {compact(v, 0)}
                  </text>
                </g>
              ))}
              {Array.from({ length: 40 }, (_, i) => {
                const y = TOP + 22 + (i / 40) * (BOT - TOP - 22);
                return <line key={i} x1="72" x2="76" y1={y} y2={y} stroke="var(--mist)" strokeOpacity="0.35" />;
              })}
              {/* the sounding line, drawn as you descend */}
              <path data-sound d={`M${LINE_X} ${TOP} V${BOT}`} stroke="var(--mist)" strokeOpacity="0.35" strokeDasharray="1 4" fill="none" />
              {/* tether from the buoy to the lead */}
              <line data-tether x1={LINE_X} x2={LINE_X} y1={TOP - 8} y2={TOP + 60} stroke="var(--foam)" strokeOpacity="0.85" strokeWidth="1.2" />
              <g data-lead>
                <path d={`M${LINE_X - 7} -16 h14 l5 22 h-24 z`} fill="var(--brass)" />
                <line x1="86" x2={LINE_X - 14} y1="0" y2="0" stroke="var(--brass)" strokeWidth="1" strokeDasharray="2 3" />
                <text x="92" y="-6" fontSize="11" fontFamily="var(--font-mono)" fill="var(--brass-ink)">
                  {compact(bag, 1)}
                </text>
              </g>
              {/* a drawn buoy for phones (the 3D one floats on wider screens) */}
              <g className="md:hidden">
                <path d={`M${LINE_X - 14} ${TOP - 6} q14 -34 28 0 z`} fill="var(--coral)" />
                <rect x={LINE_X - 15} y={TOP - 8} width="30" height="6" fill="var(--foam)" />
                <circle cx={LINE_X} cy={TOP - 40} r="3" fill="var(--brass)" />
              </g>
            </svg>
            <figcaption className="mt-3 flex gap-3 font-mono text-[11px] leading-relaxed text-mist">
              <span className="shrink-0 text-brass-ink">Fig. 7</span>
              <span>A sounding line on a log scale. The buoy rides the surface; drag the lead to try a bag.</span>
            </figcaption>
          </figure>

          <div className="min-w-0">
            <div className="neatline p-5 sm:p-6">
              <div className="flex items-baseline justify-between gap-3">
                <span className="eyebrow">Try a bag</span>
                <span className="font-mono text-lg text-foam tnum">
                  <Scramble text={`${int(bag)} $EBB`} chars="0123456789," duration={0.35} />
                </span>
              </div>
              <div className="relative mt-4 h-10">
                <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-line" />
                <div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 bg-brass" style={{ width: `calc(${t * 100}% + ${11 - 22 * t}px)` }} />
                {TIERS.slice(1).map((tr, i) => {
                  const p = valueToLog(tierMin(i + 1), MIN, MAX);
                  return (
                    <span key={tr.id} className="absolute top-[calc(50%+10px)] -translate-x-1/2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-mist" style={{ left: `calc(${p * 100}% + ${11 - 22 * p}px)` }}>
                      {tr.label}
                    </span>
                  );
                })}
                <div data-track className="absolute inset-x-0 top-0 h-full">
                  <input
                    data-range
                    type="range"
                    min={0}
                    max={1000}
                    value={Math.round(t * 1000)}
                    onChange={(e) => move(Number(e.target.value) / 1000)}
                    aria-label="Try a bag of $EBB"
                    aria-valuetext={`${int(bag)} EBB, ${tier.label} tier`}
                    className="mirror-range peer"
                  />
                  <div data-handle className="mirror-handle absolute left-0 top-1/2 -mt-[11px] h-[22px] w-[22px] rounded-full border-2 border-brass bg-abyss shadow-[0_0_0_6px_color-mix(in_oklab,var(--brass)_18%,transparent)]" />
                </div>
              </div>
            </div>

            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {TIERS.map((tr, i) => {
                const on = tr.id === tier.id;
                const min = tierMin(i);
                return (
                  <li key={tr.id} className={`relative rounded-[2px] border p-5 transition-colors duration-500 ${on ? "border-brass bg-brass/[0.06]" : "border-line bg-deep/40"}`}>
                    {on ? <span data-flip-id="tier-glow" aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[2px] shadow-[0_0_0_1px_var(--brass),0_20px_50px_-24px_var(--brass)]" /> : null}
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-display text-2xl italic text-foam">{tr.label}</h3>
                      {on ? (
                        <span data-flip-id="bag-badge" className="inline-block rounded-[2px] bg-brass px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-on-brass">
                          your bag
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 font-mono text-[12px] text-mist tnum">{min === 0 ? "hold 0" : `hold ${int(min)} · ${((min / 1e9) * 100).toFixed(2)}%`}</div>
                    <dl className="mt-4 grid grid-cols-2 gap-2 border-y border-line py-3 font-mono text-[12px]">
                      <div>
                        <dt className="text-mist">requests / min</dt>
                        <dd className="mt-0.5 text-lg text-foam tnum">{tr.rpm}</dd>
                      </div>
                      <div>
                        <dt className="text-mist">concurrent</dt>
                        <dd className="mt-0.5 text-lg text-foam tnum">{tr.concurrent}</dd>
                      </div>
                    </dl>
                    <ul className="mt-3 space-y-1.5 text-[13.5px] text-mist">
                      {tr.perks.map((p) => (
                        <li key={p} className="flex gap-2">
                          <IconCheck size={14} className="mt-0.5 shrink-0 text-kelp" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <p className="mt-5 text-[13.5px] text-mist">Tiers raise rate limits and add cosmetic marks. They never change what a credit is worth or how a tide is split.</p>

            <div className="mt-12 grid gap-10 lg:grid-cols-2">
              <div data-reveal>
                <h3 className="eyebrow">What $EBB never does</h3>
                <ul className="mt-4 space-y-2.5 text-[14px] text-foam">
                  {["Pay holders cash, ETH or stablecoins", "Make one holder’s credit worth more than another’s", "Ask you to stake, lock or mint a second token", "Let the team move the credit pool", "Promise a fixed amount per tide"].map((x) => (
                    <li key={x} className="flex gap-2.5">
                      <IconClose size={14} className="mt-1 shrink-0 text-coral" />
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
              <div id="token" data-reveal="0.1">
                <h3 className="eyebrow">Token facts</h3>
                <dl className="mt-4 divide-y divide-line/70 border-y border-line text-[13.5px]">
                  {[
                    ["Supply", "1,000,000,000, fixed, no mint"],
                    ["Chain", "Robinhood Chain · 4663"],
                    ["Launch", "Pons v2 curve · Uniswap v4 at 4.2 ETH"],
                    ["Trader fee", "3%: 1% Pons base + 2% creator tax"],
                    ["Reaches the Basin", "2.7% of volume, in ETH"],
                    ["Pool / treasury", "70% / 30%"],
                    ["Tide", "30 minutes, on :00 and :30 UTC"],
                    ["Life of a pool", "336 tides · 7 days"],
                    ["Grant floor", "100,000 $EBB · 0.01%"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 py-2">
                      <dt className="text-mist">{k}</dt>
                      <dd className="text-right text-foam tnum">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>
    </LSection>
  );
}
