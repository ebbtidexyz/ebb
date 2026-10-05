"use client";

import { useRef } from "react";
import { gsap, useGsap } from "@/lib/gsap";
import { ChartBg, LHead, LSection, revealIn } from "./kit";

const rows: { k: string; them: string; us: string; trust?: boolean }[] = [
  { k: "Unused credit", them: "Sits in wallets, or is listed for sale below face value", us: "After seven days it buys $EBB on the market and burns it" },
  { k: "Getting started", them: "Stake, mint a second token, list it, settle, activate", us: "Hold $EBB. Sign one message for a key. Done" },
  { k: "Where the fees sit", them: "A “vault” that is really an ordinary wallet: whoever holds its key can move it", us: "The Basin: an immutable contract, not a wallet. No owner, no proxy, verified source", trust: true },
  { k: "Who got what", them: "A row in their database", us: "Every tide’s grants committed on-chain as a Merkle root. Verify your own" },
  { k: "Reserves", them: "An endpoint that answers null", us: "The vault balance read from the chain on every request, shown as an equation" },
  { k: "API keys", them: "Derived from a fixed signed message, so a phished signature is a key forever", us: "Random, issued after a nonce-bound sign-in with expiry, stored only as SHA-256" },
  { k: "Documentation", them: "Pages that disagree on the epoch length and the split", us: "One constants file feeds the contracts, the API and this page" },
  { k: "Models", them: "One unnamed house model", us: "Upstream model names and list prices shown, no markup" },
  { k: "Trying it", them: "Buy first, find out later", us: "A full sandbox: simulated chain and holders, no wallet funds needed" },
];

const POINTS = [
  ["AI is a standing bill", "Seats, keys, top-ups, overages. For anyone who builds with models the meter only runs one way."],
  ["Utility is usually a sticker", "Holding a token rarely changes what you do on an ordinary Tuesday. A key that answers your editor does."],
  ["Idle credit turns into sell pressure", "Pay unused credit out as a tradable token and holders sell it at a discount. You get paid in something you dump."],
  ["Every extra step loses people", "Stake, mint, list, settle, activate. Most holders stop at the second step and their share sits idle."],
];

export function Undertow() {
  const ref = useRef<HTMLDivElement>(null);

  useGsap(ref, ({ motion }) => {
    const root = ref.current!;
    const lo = root.querySelector<HTMLElement>("[data-lo]")!;
    const hi = root.querySelector<HTMLElement>("[data-hi]")!;
    if (!motion) return;
    revealIn(root);

    // the leak: 0 → 82 and 0 → 87, snapped to whole numbers
    const n = { lo: 0, hi: 0 };
    gsap.to(n, {
      lo: 82,
      hi: 87,
      duration: 2.4,
      ease: "ebb",
      snap: { lo: 1, hi: 1 },
      onUpdate: () => {
        lo.textContent = String(n.lo);
        hi.textContent = String(n.hi);
      },
      scrollTrigger: { trigger: lo, start: "top 80%", once: true },
    });
    gsap.from(root.querySelector("[data-leak-bar]"), { scaleX: 0, transformOrigin: "left", duration: 2.4, ease: "ebb", scrollTrigger: { trigger: lo, start: "top 80%", once: true } });

    // two roads: the stem, then the left road (coral), then the right road (kelp), on scrub
    const fig = root.querySelector<SVGSVGElement>("[data-roads]")!;
    const sel = (s: string) => Array.from(fig.querySelectorAll<SVGElement>(s));
    gsap.set(sel("[data-draw]"), { drawSVG: "0%" });
    gsap.set(sel("[data-show]"), { opacity: 0 });
    const tl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: { trigger: fig, start: "top 78%", end: "bottom 45%", scrub: 0.6 } });
    tl.to(sel("[data-draw='stem']"), { drawSVG: "100%", duration: 0.6 })
      .to(sel("[data-show='src']"), { opacity: 1, duration: 0.3 }, 0)
      .to(sel("[data-draw='left']"), { drawSVG: "100%", duration: 1 })
      .to(sel("[data-show='left']"), { opacity: 1, duration: 0.4, stagger: 0.15 }, "<0.4")
      .to(sel("[data-draw='left-arrow']"), { drawSVG: "100%", duration: 0.3 })
      .to(sel("[data-draw='right']"), { drawSVG: "100%", duration: 1 })
      .to(sel("[data-show='right']"), { opacity: 1, duration: 0.4, stagger: 0.15 }, "<0.4")
      .to(sel("[data-draw='right-arrow']"), { drawSVG: "100%", duration: 0.3 })
      .to(sel("[data-show='tag']"), { opacity: 1, duration: 0.3 });

    // them vs Ebb: rows stagger in; the trust row gets a brass sweep
    const table = root.querySelector<HTMLElement>("[data-table]")!;
    const trs = table.querySelectorAll<HTMLElement>("[data-row]");
    gsap.from(trs, { y: 26, opacity: 0, duration: 0.8, stagger: 0.07, ease: "tide", scrollTrigger: { trigger: table, start: "top 80%", once: true } });
    const sweep = table.querySelector<HTMLElement>("[data-sweep]")!;
    const bar = table.querySelector<HTMLElement>("[data-sweep-bar]")!;
    gsap
      .timeline({ scrollTrigger: { trigger: sweep.parentElement, start: "top 70%", once: true } })
      .fromTo(sweep, { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 1.1, ease: "ebb", transformOrigin: "left center" })
      .fromTo(bar, { scaleY: 0 }, { scaleY: 1, duration: 0.6, transformOrigin: "top" }, 0.2)
      .to(sweep, { opacity: 0.55, duration: 0.8 }, 1.1);
  });

  return (
    <LSection id="undertow" numeral="I" label="Undertow" className="isolate py-28 md:py-40">
      <ChartBg opacity={0.07} />
      <div ref={ref}>
        <LHead
          id="undertow"
          numeral="I"
          kicker="Undertow"
          coord="tide-to-credit · why"
          title={
            <>
              Credit nobody spends still has to go <em className="italic">somewhere.</em>
            </>
          }
          lede="Fee-to-credit tokens proved that people want their AI paid for by trading fees. Then the undertow showed up: most credit is never spent, and where that unused value flows decides whether holders are being paid or quietly drained."
        />

        {/* the leak */}
        <div className="grid items-end gap-10 border-y border-line py-12 md:grid-cols-[auto_1fr] md:gap-16 md:py-16">
          <div className="font-display leading-[0.82] tracking-[-0.04em] text-coral" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0' }} aria-label="82 to 87 percent">
            <span className="text-[clamp(5.5rem,17vw,15rem)] tnum" aria-hidden="true">
              <span data-lo>82</span>
              <span className="text-mist/60">–</span>
              <span data-hi>87</span>
              <span className="text-[0.45em] align-top">%</span>
            </span>
          </div>
          <div className="max-w-md pb-3">
            <p className="font-display text-2xl leading-snug text-foam sm:text-[1.75rem]">of credit issued by an incumbent fee-to-credit token was never spent on inference. It was listed for sale below face value.</p>
            <div className="mt-6 h-1.5 w-full overflow-hidden bg-line/60" aria-hidden="true">
              <div data-leak-bar className="h-full w-full bg-[linear-gradient(90deg,var(--kelp)_0_15%,var(--coral)_15%_100%)]" />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10.5px] uppercase tracking-[0.12em] text-mist">
              <span className="text-kelp">13–18% spent</span>
              <span className="text-coral">the rest leaks</span>
            </div>
            <p className="mt-5 font-mono text-[11px] text-mist">As reported on orbz.app (October 2026), citing an incumbent&apos;s public analytics. Not independently verified by us.</p>
          </div>
        </div>

        <div className="mt-20 grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <ol data-stagger className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-1">
            {POINTS.map(([t, b], i) => (
              <li key={t} className="grid grid-cols-[2.25rem_1fr] gap-4">
                <span className="font-mono text-[12px] text-brass-ink tnum">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="font-display text-xl text-foam">{t}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-mist">{b}</p>
                </div>
              </li>
            ))}
          </ol>

          <figure>
            <div className="neatline p-3 sm:p-6">
              <TwoRoads />
            </div>
            <figcaption className="mt-3 flex gap-3 font-mono text-[11px] leading-relaxed text-mist">
              <span className="shrink-0 text-brass-ink">Fig. 1</span>
              <span>Unused value has two roads. Paid out, it becomes sell pressure. Burned, it becomes buy pressure. Ebb takes the second, automatically, every tide.</span>
            </figcaption>
          </figure>
        </div>

        <div className="mt-24">
          <div className="flex items-baseline justify-between gap-4">
            <h3 data-reveal className="font-display text-3xl text-foam sm:text-4xl">
              Them and us
            </h3>
            <span className="eyebrow">{rows.length} soundings</span>
          </div>
          <div data-table className="mt-6 border-y border-line">
            <div className="hidden grid-cols-[0.6fr_1fr_1fr] gap-6 border-b border-line py-3 md:grid">
              <span className="eyebrow">&nbsp;</span>
              <span className="eyebrow">Typical fee-to-credit token</span>
              <span className="eyebrow text-brass-ink">Ebb</span>
            </div>
            <dl>
              {rows.map((r) => (
                <div key={r.k} data-row className="relative grid gap-2 border-b border-line/60 py-4 last:border-b-0 md:grid-cols-[0.6fr_1fr_1fr] md:gap-6 md:px-3">
                  {r.trust ? (
                    <>
                      <span data-sweep aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(90deg,color-mix(in_oklab,var(--brass)_22%,transparent),color-mix(in_oklab,var(--brass)_6%,transparent))] opacity-0" />
                      <span data-sweep-bar aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-brass" />
                    </>
                  ) : null}
                  <dt className={`font-mono text-[12px] uppercase tracking-[0.08em] ${r.trust ? "text-brass-ink" : "text-foam"}`}>{r.k}</dt>
                  <dd className="flex gap-2 text-[14.5px] text-mist">
                    <span aria-hidden="true" className="mt-[3px] text-coral">
                      ✕
                    </span>
                    <span>
                      <span className="sr-only">Typical: </span>
                      {r.them}
                    </span>
                  </dd>
                  <dd className="flex gap-2 text-[14.5px] text-foam">
                    <span aria-hidden="true" className="mt-[3px] text-kelp">
                      ✓
                    </span>
                    <span>
                      <span className="sr-only">Ebb: </span>
                      {r.us}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </LSection>
  );
}

function TwoRoads() {
  const mono = "var(--font-mono)";
  return (
    <svg data-roads viewBox="0 0 640 420" className="h-auto w-full overflow-visible" role="img" aria-labelledby="roads-t roads-d">
      <title id="roads-t">Two roads for unused credit</title>
      <desc id="roads-d">
        Unused credit flows down to a fork. The left road pays it out as a token, holders sell it below face value, and the price feels sell pressure. The right road, which Ebb takes, buys $EBB back and burns it in the Trench, creating buy pressure.
      </desc>
      <defs>
        <pattern id="roads-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--coral)" strokeOpacity="0.55" strokeWidth="1" />
        </pattern>
        <linearGradient id="roads-water" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--water)" stopOpacity="0.25" />
          <stop offset="1" stopColor="var(--water)" stopOpacity="0.7" />
        </linearGradient>
      </defs>

      {/* source */}
      <g data-show="src">
        <text x="320" y="22" textAnchor="middle" fontSize="11" fontFamily={mono} fill="var(--mist)" letterSpacing="2.5">
          UNUSED CREDIT
        </text>
        <text x="320" y="40" textAnchor="middle" fontSize="10" fontFamily={mono} fill="var(--mist)" opacity="0.7">
          7 days on the shore
        </text>
      </g>
      <path data-draw="stem" d="M320 54 V140" stroke="url(#roads-water)" strokeWidth="16" strokeLinecap="round" fill="none" />

      {/* left: pay it out */}
      <path data-draw="left" d="M320 140 C 320 196, 150 180, 150 250 L 150 300" stroke="var(--coral)" strokeOpacity="0.85" strokeWidth="3" fill="none" />
      <g data-show="left">
        <text x="40" y="196" fontSize="14" fontFamily="var(--font-sans)" fill="var(--foam)">
          Pay it out as a token
        </text>
      </g>
      <g data-show="left">
        <text x="40" y="216" fontSize="11" fontFamily={mono} fill="var(--mist)">
          holders list it below face value
        </text>
      </g>
      <path data-draw="left-arrow" d="M150 314 V380 M141 368 L150 382 L159 368" stroke="var(--coral)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <g data-show="left">
        <text x="172" y="356" fontSize="12" fontFamily={mono} fill="var(--coral)" letterSpacing="1.5">
          SELL PRESSURE
        </text>
        <text x="172" y="374" fontSize="10.5" fontFamily={mono} fill="var(--mist)">
          price pushed down
        </text>
      </g>

      {/* right: burn it */}
      <path data-draw="right" d="M320 140 C 320 196, 490 180, 490 250 L 490 296" stroke="var(--kelp)" strokeWidth="5" fill="none" />
      <g data-show="right">
        <text x="600" y="196" textAnchor="end" fontSize="14" fontWeight="600" fontFamily="var(--font-sans)" fill="var(--foam)">
          Burn $EBB with it
        </text>
      </g>
      <g data-show="right">
        <text x="600" y="216" textAnchor="end" fontSize="11" fontFamily={mono} fill="var(--mist)">
          bought on the market, then burn()
        </text>
      </g>
      <g data-show="right">
        <rect x="470" y="300" width="40" height="70" fill="url(#roads-hatch)" />
        <path d="M470 300 v70 h40 v-70" fill="none" stroke="var(--coral)" strokeOpacity="0.7" />
        <text x="490" y="392" textAnchor="middle" fontSize="9.5" fontFamily={mono} fill="var(--coral)" letterSpacing="1.5">
          TRENCH
        </text>
      </g>
      <path data-draw="right-arrow" d="M560 384 V300 M551 312 L560 298 L569 312" stroke="var(--kelp)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <g data-show="right">
        <text x="548" y="336" textAnchor="end" fontSize="12" fontFamily={mono} fill="var(--kelp)" letterSpacing="1.5">
          BUY
        </text>
        <text x="548" y="352" textAnchor="end" fontSize="12" fontFamily={mono} fill="var(--kelp)" letterSpacing="1.5">
          PRESSURE
        </text>
      </g>

      <g data-show="tag" transform="translate(366 262)">
        <rect width="108" height="24" fill="var(--abyss)" stroke="var(--brass)" />
        <text x="54" y="16" textAnchor="middle" fontSize="10" fill="var(--brass-ink)" fontFamily={mono} letterSpacing="1.5">
          EBB&apos;S ROAD
        </text>
      </g>
    </svg>
  );
}
