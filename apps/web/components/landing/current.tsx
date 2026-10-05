"use client";

import { useRef } from "react";
import { Flip, gsap, ScrollTrigger, scrollToY, triggerY, useGsap } from "@/lib/gsap";
import { r2 } from "@/lib/format";
import { LHead, LSection } from "./kit";
import { stage } from "./three/store";

const STATIONS = [
  {
    name: "Inflow",
    title: "Someone trades $EBB",
    body: "Every buy and sell pays 3% on Pons: its 1% base fee plus the 2% $EBB creator tax, on the bonding curve and after graduation alike. Pons keeps 0.3%, so 2.7% of all volume belongs to the Basin, in ETH.",
    call: "Pons fee escrow → EbbVault",
  },
  {
    name: "Basin",
    title: "The fees reach the Basin",
    body: "Pons does not push fees, so anyone can call harvest(). It claims the ETH from Pons’ fee escrow and swaps it to USDG on the WETH/USDG pool, reverting if the price strays more than 3% from the 30-minute TWAP.",
    call: "harvest()",
  },
  {
    name: "Split",
    title: "Seventy to the pool, thirty to the treasury",
    body: "The swap result is split in the same transaction: 70% is booked to the current tide’s credit pool, 30% goes to the treasury. An invariant test checks the ratio on every harvest.",
    call: "toPool × 3000 == toTreasury × 7000",
  },
  {
    name: "Tide",
    title: "The tide turns on :00 and :30",
    body: "When a tide ends the allocator integrates every wallet’s balance over those 30 minutes. A time-weighted 100,000 $EBB or more is eligible; flash holds earn almost nothing.",
    call: "TWAB over [start, end)",
  },
  {
    name: "Flood",
    title: "The tide comes in",
    body: "Each holder’s pro-rata grant is committed on-chain as a Merkle root, and lands in a fresh tidepool in their dashboard. Anyone can check their own leaf against the root.",
    call: "commitGrants(tide, root, total, wallets)",
  },
  {
    name: "Spend",
    title: "One key, any tool",
    body: "Point any OpenAI-compatible client at the gateway. Each request reserves its maximum cost from your oldest pool first, then settles the real cost and refunds the rest.",
    call: "POST /v1/chat/completions",
  },
  {
    name: "Ebb",
    title: "Every pool counts down",
    body: "A tidepool lives 336 tides, seven days. Spent credit is paid to the model provider hourly, with a Merkle root of the requests it covers, and never more than the tide was granted.",
    call: "withdrawForUsage(tide, amount, usageRoot)",
  },
  {
    name: "Trench",
    title: "What is left is drawn into the Trench",
    body: "At hour 168 the remainder buys $EBB on the market and burns it. Our keeper calls it; if the keeper stops, anyone can, and collects a 0.25% tip capped at $2.",
    call: "burnExpired(tide, maxAmount)",
  },
] as const;

const N = STATIONS.length;
const C = 320;
const R = 236;
/** the ring as a path from north, clockwise: the droplet's motion path */
const RING = `M${C} ${C - R} A${R} ${R} 0 1 1 ${C} ${C + R} A${R} ${R} 0 1 1 ${C} ${C - R}`;

function pos(i: number, r = R): [number, number] {
  const a = ((i / N) * 360 - 90) * (Math.PI / 180);
  return [r2(C + r * Math.cos(a)), r2(C + r * Math.sin(a))];
}

/** compass dial yaw so its north points at station i (clockwise from the top of the screen) */
const COMPASS_NORTH = 0;
const yawFor = (i: number) => COMPASS_NORTH - (i / N) * Math.PI * 2;

export function Current() {
  const ref = useRef<HTMLDivElement>(null);
  const go = useRef<(i: number) => void>(() => {});

  useGsap(ref, ({ motion, desktop }) => {
    const root = ref.current!;
    const pin = root.querySelector<HTMLElement>("[data-pin]")!;
    const ring = root.querySelector<SVGPathElement>("#cur-ring")!;
    const arc = root.querySelector<SVGPathElement>("[data-arc]")!;
    const drop = root.querySelector<SVGGElement>("[data-drop]")!;
    const nodes = Array.from(root.querySelectorAll<SVGGElement>(".st-node"));
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".st-row"));
    const counter = root.querySelector<HTMLElement>("[data-st-count]")!;
    const compass = stage.models.compass;
    compass.anchor = desktop ? root.querySelector<HTMLElement>("[data-compass]") : null;
    let active = -1;
    let lastFlip: gsap.core.Timeline | null = null;

    const setActive = (i: number, animate: boolean) => {
      if (i === active) return;
      // finish any flip still running so the new one starts from clean layout
      lastFlip?.progress(1).kill();
      lastFlip = null;
      const state = animate && desktop ? Flip.getState(rows) : null;
      rows.forEach((r, k) => {
        r.dataset.active = String(k === i);
        r.querySelector("button")?.setAttribute("aria-expanded", String(k === i));
      });
      nodes.forEach((n, k) => {
        n.dataset.on = String(k === i);
        n.dataset.passed = String(k < i);
      });
      counter.textContent = String(i + 1).padStart(2, "0");
      if (state) {
        lastFlip = Flip.from(state, { duration: 0.75, ease: "tide", simple: true });
        const body = rows[i].querySelector(".st-body");
        if (body) gsap.fromTo(body, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6, delay: 0.2, ease: "tide" });
      }
      if (desktop) gsap.to(compass, { ry: yawFor(i), duration: animate ? 1.6 : 0, ease: "elastic.out(1, 0.5)", overwrite: "auto" });
      active = i;
    };

    setActive(0, false);

    // compass presence follows the pinned ring (positions come from the pin itself, so they include its spacer)
    const presence = (pinST?: ScrollTrigger) => {
      if (!desktop) return;
      const toggle = (on: boolean) => gsap.to(compass, { show: on ? 1 : 0, scale: on ? 1 : 0.8, duration: motion ? 1 : 0, ease: "tide", overwrite: "auto" });
      ScrollTrigger.create(
        pinST
          ? { start: () => pinST.start - window.innerHeight * 0.45, end: () => pinST.end + window.innerHeight * 0.35, onToggle: (self) => toggle(self.isActive) }
          : { trigger: pin, start: "top 70%", end: "bottom 30%", onToggle: (self) => toggle(self.isActive) },
      );
    };

    if (motion && desktop) {
      gsap.set(drop, { opacity: 1 });
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: pin,
          start: "top top",
          end: "+=300%",
          pin: true,
          scrub: true,
          onUpdate: (self) => setActive(Math.min(N - 1, Math.floor(self.progress * N + 0.04)), true),
        },
      });
      tl.to(drop, { motionPath: { path: ring, align: ring, alignOrigin: [0.5, 0.5], start: 0, end: 1 }, duration: 1 }, 0).fromTo(arc, { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: 1 }, 0);
      const st = tl.scrollTrigger!;
      go.current = (i) => scrollToY(triggerY(st, (i + 0.5) / N));
      presence(st);
      return;
    }

    if (motion) {
      // phones: the float laps the ring on its own; the cards are stacked below
      gsap.set(drop, { opacity: 1 });
      gsap.to(drop, {
        motionPath: { path: ring, align: ring, alignOrigin: [0.5, 0.5], start: 0, end: 1 },
        duration: 24,
        repeat: -1,
        ease: "none",
        onUpdate() {
          setActive(Math.min(N - 1, Math.floor(this.progress() * N)), false);
        },
      });
      gsap.from(rows, { y: 30, opacity: 0, duration: 0.8, stagger: 0.06, ease: "tide", scrollTrigger: { trigger: rows[0], start: "top 85%", once: true } });
    }
    go.current = (i) => setActive(i, false);
    presence();
  });

  return (
    <LSection id="current" numeral="II" label="Current" className="py-28 md:py-36">
      <div ref={ref}>
        <LHead
          id="current"
          numeral="II"
          kicker="Current"
          coord="8 stations · 1 loop · every 30 min"
          title="From one trade to your editor, or down into the Trench."
          lede="Eight stations, one loop. Nothing in it waits for a person to press a button, and every station leaves a public trace. Scroll to send a drop of fee around the current."
        />
        <div data-pin className="md:flex md:h-screen md:items-center">
          <div className="grid w-full items-center gap-10 md:grid-cols-[1.05fr_0.95fr] lg:gap-16">
            <figure className="relative mx-auto w-full max-w-[min(78vh,620px)]">
              <svg viewBox="-70 -10 780 660" className="h-auto w-full overflow-visible" aria-hidden="true">
                <defs>
                  <radialGradient id="cur-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0" stopColor="#fff6dc" stopOpacity="1" />
                    <stop offset="0.35" stopColor="var(--brass)" stopOpacity="0.6" />
                    <stop offset="1" stopColor="var(--brass)" stopOpacity="0" />
                  </radialGradient>
                </defs>
                {/* rhumb lines + degree ring */}
                {Array.from({ length: 16 }, (_, i) => {
                  const [x1, y1] = pos(i / 2, R - 70);
                  const [x2, y2] = pos(i / 2, R - 20);
                  return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--line)" strokeWidth="0.75" strokeDasharray={i % 2 ? "2 5" : undefined} />;
                })}
                {Array.from({ length: 72 }, (_, i) => {
                  const a = (i / 72) * Math.PI * 2;
                  const r1 = R + 26;
                  const rr = R + (i % 9 === 0 ? 36 : 31);
                  return <line key={i} x1={r2(C + r1 * Math.cos(a))} y1={r2(C + r1 * Math.sin(a))} x2={r2(C + rr * Math.cos(a))} y2={r2(C + rr * Math.sin(a))} stroke="var(--mist)" strokeOpacity="0.35" strokeWidth="0.75" />;
                })}
                <path id="cur-ring" d={RING} fill="none" stroke="var(--line)" strokeWidth="2" />
                <path data-arc d={RING} fill="none" stroke="var(--brass)" strokeWidth="2.5" strokeLinecap="round" />
                {STATIONS.map((st, i) => {
                  const [x, y] = pos(i);
                  const [lx, ly] = pos(i, R + 62);
                  const anchor = Math.abs(lx - C) < 10 ? "middle" : lx > C ? "start" : "end";
                  return (
                    <g key={st.name} className="st-node cursor-pointer" data-on="false" onClick={() => go.current(i)}>
                      <circle className="st-dot" cx={x} cy={y} r="21" fill="var(--abyss)" stroke="var(--line)" strokeWidth="1.5" style={{ transition: "fill 300ms, stroke 300ms" }} />
                      <text className="st-num" x={x} y={y + 5} textAnchor="middle" fontSize="14" fontFamily="var(--font-mono)" fill="var(--foam)" style={{ transition: "fill 300ms" }}>
                        {String(i + 1).padStart(2, "0")}
                      </text>
                      <text className="st-label" x={lx} y={ly + 6} textAnchor={anchor} fontSize="19" fontStyle="italic" fontFamily="var(--font-display)" fill="var(--mist)" style={{ transition: "fill 300ms" }}>
                        {st.name}
                      </text>
                    </g>
                  );
                })}
                {/* the drop of fee */}
                <g data-drop opacity="0">
                  <circle r="26" fill="url(#cur-glow)" />
                  <circle r="6.5" fill="#fff6dc" />
                </g>
              </svg>
              {/* the brass compass is drawn by the WebGL stage onto this box */}
              <div data-compass aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[44%] -translate-x-1/2 -translate-y-1/2" />
              <figcaption className="mt-4 flex gap-3 font-mono text-[11px] leading-relaxed text-mist">
                <span className="shrink-0 text-brass-ink">Fig. 2</span>
                <span>The current. A drop of fee travels the ring; the compass needle points at the station it has reached. Choose a station to jump to it.</span>
              </figcaption>
            </figure>

            <div>
              <div className="mb-4 flex items-baseline justify-between">
                <span className="eyebrow">
                  Station <span data-st-count className="text-foam tnum">01</span> / 08
                </span>
                <span className="hidden font-mono text-[10.5px] text-mist md:inline">scroll to advance · click to jump</span>
              </div>
              <ol className="space-y-1.5">
                {STATIONS.map((st, i) => (
                  <li key={st.name} className="st-row rounded-[2px] border border-line transition-colors duration-300" data-active={i === 0 ? "true" : "false"}>
                    <button type="button" onClick={() => go.current(i)} aria-expanded={i === 0} className="flex w-full items-baseline gap-3 px-4 py-2 text-left">
                      <span className="font-mono text-[11px] text-brass-ink tnum">{String(i + 1).padStart(2, "0")}</span>
                      <span className="st-name font-display text-[1.125rem] italic text-mist transition-colors">{st.name}</span>
                      <span className="ml-auto hidden truncate font-mono text-[10.5px] text-mist/80 lg:block">{st.call}</span>
                    </button>
                    <div className="st-body px-4 pb-4">
                      <h3 className="font-display text-[1.4rem] leading-tight text-foam">{st.title}</h3>
                      <p className="mt-2 text-[14px] leading-relaxed text-mist">{st.body}</p>
                      <code className="mt-3 inline-block max-w-full break-words rounded-[2px] border border-line bg-abyss/60 px-2.5 py-1.5 font-mono text-[12px] text-brass-ink">{st.call}</code>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </LSection>
  );
}
