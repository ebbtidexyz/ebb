"use client";

import Link from "next/link";
import { useRef } from "react";
import { gsap, useGsap } from "@/lib/gsap";
import { BUY_URL, TELEGRAM_URL, X_URL } from "@/lib/env";
import { IconArrowRight, IconBook, IconExternal } from "../site/icons";
import { LHead, LSection, revealIn, splitRise } from "./kit";

const PHASES = [
  { n: "0", name: "Foundation", state: "done", items: ["Mechanism fixed: 30-minute tides, seven-day ebb, burns", "One spec as the single source of every number", "Name, mark and this chart"] },
  { n: "1", name: "Build", state: "done", items: ["EbbVault with invariant tests I1–I8", "Indexer, allocator, gateway, settlement, keeper, publisher", "Sandbox mode, this site and the console"] },
  { n: "2", name: "Testnet", state: "done", items: ["Full stack on Robinhood Chain testnet (46630)", "Public sandbox with simulated holders", "Mainnet-fork test of the swap adapter"] },
  { n: "3", name: "Launch · 5 Oct, 15:00 UTC", state: "now", items: ["Fair launch on Pons, Robinhood Chain", "Fee recipient moved to the Basin right after launch", "A Logbook entry every tide", "First burn, live, at hour 168"] },
  { n: "4", name: "Open water", state: "later", items: ["External audit of EbbVault", "Redundant providers with failover", "Paid top-ups, team plans, editor integrations"] },
] as const;

const WEEK = [
  ["T−24h", "Vault source, test report and addresses published"],
  ["T0", "Launch. Fee recipient moved to the Basin; first-minute fees forwarded to it"],
  ["T+30m", "First tide closes; first grant root committed on-chain"],
  ["T+1h", "First settlement with a usage root"],
  ["T+24h", "Day-one Logbook: volume, fees, grants, usage"],
  ["T+168h", "Tide 0 expires. First burn, callable by anyone"],
];

const WP: [number, number][] = [
  [110, 210],
  [355, 105],
  [600, 195],
  [845, 92],
  [1090, 178],
];
const ROUTE = `M${WP[0][0]} ${WP[0][1]} C 195 210, 270 105, ${WP[1][0]} ${WP[1][1]} S 515 195, ${WP[2][0]} ${WP[2][1]} S 760 92, ${WP[3][0]} ${WP[3][1]} S 1005 178, ${WP[4][0]} ${WP[4][1]}`;

export function Course() {
  const ref = useRef<HTMLDivElement>(null);

  useGsap(ref, ({ motion, desktop }) => {
    const root = ref.current!;
    if (!motion) return;
    // reveals below the pinned route are created after the pin, so their positions include its spacer
    const after = () => {
      revealIn(root);
      const closing = root.querySelector<HTMLElement>("[data-closing]");
      if (closing) splitRise(closing, { trigger: closing, start: "top 80%", once: true }, { stagger: 0.012 });
    };
    if (!desktop) return after();

    const pin = root.querySelector<HTMLElement>("[data-pin]")!;
    const route = root.querySelector<SVGPathElement>("[data-route]")!;
    const solid = root.querySelector<SVGPathElement>("[data-sailed]")!;
    const ship = root.querySelector<SVGGElement>("[data-ship]")!;
    const marks = Array.from(root.querySelectorAll<SVGGElement>("[data-wp]"));
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-card]"));
    const bodies = cards.map((c) => c.querySelector<HTMLElement>("[data-body]")!);

    // where along the route each waypoint sits (0..1)
    const total = route.getTotalLength();
    const at = WP.map(([x, y]) => {
      let best = 0;
      let bd = Infinity;
      for (let l = 0; l <= total; l += total / 400) {
        const p = route.getPointAtLength(l);
        const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (dd < bd) {
          bd = dd;
          best = l / total;
        }
      }
      return best;
    });

    gsap.set(bodies.slice(1), { height: 0, opacity: 0 });
    gsap.set(cards.slice(1), { "--on": 0 });
    gsap.set(marks.slice(1), { "--on": 0 });
    const tl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: { trigger: pin, start: "top top", end: "+=220%", pin: true, scrub: true } });
    tl.to(ship, { motionPath: { path: route, align: route, alignOrigin: [0.5, 0.5], autoRotate: true }, duration: 1 }, 0).fromTo(solid, { drawSVG: "0%" }, { drawSVG: "100%", duration: 1 }, 0);
    at.forEach((f, i) => {
      if (i === 0) return;
      tl.to(marks[i], { "--on": 1, duration: 0.03 }, f - 0.015)
        .to(cards[i], { "--on": 1, duration: 0.04 }, f - 0.03)
        .to(bodies[i], { height: "auto", opacity: 1, duration: 0.06, ease: "power2.out" }, f - 0.03);
    });
    tl.to({}, { duration: 0.06 });
    after();
  });

  return (
    <LSection id="course" numeral="XI" label="Charted course" className="py-28 md:py-36" inner={false}>
      <div ref={ref}>
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">
          <LHead
            id="course"
            numeral="XI"
            kicker="Charted course"
            coord="five waypoints"
            title="From the first sketch to the first burn."
            lede="The product ships before the token. Each waypoint is reached when its work is public and checkable, not when a date arrives."
          />
        </div>

        <div data-pin className="mx-auto max-w-[1240px] px-4 sm:px-6 md:flex md:h-screen md:flex-col md:justify-center lg:px-10">
          <div className="neatline relative hidden overflow-hidden md:block">
            <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center opacity-[0.16] mix-blend-luminosity" style={{ backgroundImage: "url(/media/chart.jpg)" }} />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-abyss/70 via-transparent to-abyss/70" />
            <svg viewBox="0 0 1200 300" className="relative block h-auto w-full" aria-hidden="true">
              <path data-route d={ROUTE} fill="none" stroke="var(--mist)" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="2 9" strokeLinecap="round" />
              <path data-sailed d={ROUTE} fill="none" stroke="var(--brass)" strokeWidth="2" strokeLinecap="round" />
              {PHASES.map((p, i) => (
                <g key={p.n} data-wp style={{ ["--on" as string]: 1 }}>
                  <circle cx={WP[i][0]} cy={WP[i][1]} r="18" fill="none" stroke="var(--brass)" strokeOpacity="0.45" style={{ opacity: "var(--on)" }} />
                  <circle cx={WP[i][0]} cy={WP[i][1]} r="8" fill="var(--abyss)" stroke="var(--brass)" strokeWidth="1.5" />
                  <circle cx={WP[i][0]} cy={WP[i][1]} r="4" fill="var(--brass)" style={{ opacity: "var(--on)" }} />
                  <text x={WP[i][0]} y={WP[i][1] + (i % 2 ? -32 : 40)} textAnchor="middle" fontSize="12" letterSpacing="2" fontFamily="var(--font-mono)" fill="var(--mist)">
                    WP {p.n} · {p.name.toUpperCase()}
                  </text>
                </g>
              ))}
              {/* the ship: a small brass hull with a pennant */}
              <g data-ship transform={`translate(${WP[0][0]} ${WP[0][1]})`}>
                <g transform="translate(-16 -11)">
                  <path d="M2 14 L30 14 L24 21 L7 21 Z" fill="var(--brass)" />
                  <path d="M15 1 L15 14 M15 2 L26 11 L15 11" fill="none" stroke="var(--foam)" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="M15 2 L23 11 L15 11 Z" fill="var(--foam)" fillOpacity="0.85" />
                </g>
              </g>
            </svg>
          </div>

          <ol className="mt-6 grid gap-3 md:grid-cols-5">
            {PHASES.map((p) => (
              <li
                key={p.n}
                data-card
                className="relative rounded-[2px] border bg-abyss/70 p-4 backdrop-blur-sm"
                style={{ ["--on" as string]: 1, borderColor: "color-mix(in oklab, var(--brass) calc(var(--on) * 70%), var(--line))" }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-mist">Waypoint {p.n}</span>
                  <span
                    className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${p.state === "done" ? "bg-brass text-on-brass" : p.state === "now" ? "border border-brass text-brass-ink" : "border border-line text-mist"}`}
                  >
                    {p.state === "now" ? "under way" : p.state}
                  </span>
                </div>
                <h3 className="mt-2 font-display text-xl text-foam">{p.name}</h3>
                <div data-body className="overflow-hidden">
                  <ul className="space-y-1.5 pt-3 text-[13px] leading-snug text-mist">
                    {p.items.map((it) => (
                      <li key={it} className="flex gap-2">
                        <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 bg-brass/70" />
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 font-mono text-[11px] text-mist">
            <span className="text-brass-ink">Fig. 12</span> The charted course. Solid line is sailed; dashes are still ahead.
          </p>
        </div>

        <div className="mx-auto mt-24 max-w-[1240px] px-4 sm:px-6 lg:px-10">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div data-reveal>
              <h3 className="font-display text-3xl text-foam">Launch week, hour by hour</h3>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-mist">Launch and the first burn are the same mark on the dial, seven days apart. Everything in between prints to the Logbook.</p>
            </div>
            <ol data-stagger className="border-y border-line">
              {WEEK.map(([t, d]) => (
                <li key={t} className="grid grid-cols-[5rem_1fr] gap-4 border-b border-line/60 py-3 last:border-b-0">
                  <span className={`font-mono text-[13px] tnum ${t === "T+168h" ? "text-coral" : "text-brass-ink"}`}>{t}</span>
                  <span className="text-[14px] text-foam">{d}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="relative mt-32 text-center">
            <p className="eyebrow">The whole idea, in one line</p>
            <p data-closing className="mx-auto mt-6 max-w-4xl font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-foam sm:text-6xl lg:text-7xl" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }}>
              Everything you spend becomes AI. <em className="italic text-brass-ink">Everything you leave becomes a burn.</em>
            </p>
            <div data-reveal="0.3" className="mt-10 flex flex-wrap justify-center gap-3">
              <a href={BUY_URL} target="_blank" rel="noreferrer noopener" data-magnetic className="btn btn-brass h-12 px-6">
                Buy $EBB on Pons <IconExternal size={14} />
              </a>
              <Link href="/app" data-magnetic className="btn btn-ghost h-12 px-6">
                Open console <IconArrowRight size={15} />
              </Link>
              <Link href="/docs" className="btn btn-ghost h-12 px-6">
                <IconBook size={15} /> Read the docs
              </Link>
            </div>
            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
              Fair launch · 5 Oct 2026 · 15:00 UTC ·{" "}
              <a href={X_URL} target="_blank" rel="noreferrer noopener" className="text-brass-ink hover:text-foam">@ebbtidexyz</a> ·{" "}
              <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" className="text-brass-ink hover:text-foam">Telegram</a>
            </p>
          </div>
        </div>
      </div>
    </LSection>
  );
}
