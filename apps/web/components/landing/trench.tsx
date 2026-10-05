"use client";

import Image from "next/image";
import { useRef } from "react";
import { useStats } from "@/lib/queries";
import { compact, int, tokenNum, usd } from "@/lib/format";
import { gsap, useGsap } from "@/lib/gsap";
import { CopyButton } from "../site/copy-button";
import { LHead, LSection, Scramble } from "./kit";

const BURN_CODE = `// anyone, once the tide is 336 tides (7 days) old
EbbVault.burnExpired(tide, maxAmount)
  require(now >= epochStart(tide) + 336 * 1800)
  usdg = min(remaining(tide), maxAmount) // slices
  tip  = min(usdg * 0.25%, $2)           // to caller
  eth  = swap(usdg - tip, USDG -> ETH)   // 3% TWAP bound
  ebb  = swap(eth, ETH -> $EBB)          // 3% TWAP bound
  EBB.burn(ebb)                          // supply falls
  emit Burned(tide, usdg, ebb, msg.sender, tip)`;

const LINES = BURN_CODE.split("\n").map((l) => {
  const i = l.indexOf("//");
  return i < 0 ? { code: l, comment: "" } : { code: l.slice(0, i), comment: l.slice(i) };
});

/** which step lights when a line finishes typing */
const STEP_AT_LINE: Record<number, number[]> = { 5: [0], 6: [1], 7: [2, 3], 8: [4] };
const STEPS = ["swap USDG → ETH", "swap ETH → $EBB", "burn()", "totalSupply ↓", "tip → caller"];

const PIPES = [
  { n: "1", title: "Expired holder credit", when: "from the first flood + 168 h", body: "Whatever is left in a tide after seven days. The main pipe; it runs every tide." },
  { n: "2", title: "Top-up margin", when: "later", body: "Credit bought at list price plus 5%. The 5% goes down the same pipe." },
  { n: "3", title: "Unused demo budget", when: "later", body: "The treasury’s free-demo allowance nobody used, routed into the Trench." },
];

export function Trench() {
  const ref = useRef<HTMLDivElement>(null);
  const stats = useStats();
  const burned = stats.data ? tokenNum(stats.data.all_time.burned_ebb) : null;
  const preLaunch = stats.data && (stats.data.all_time.burns ?? 0) === 0;

  useGsap(ref, ({ motion, desktop }) => {
    const root = ref.current!;
    if (!motion) return;
    const pin = root.querySelector<HTMLElement>("[data-pin]")!;
    const bg = root.querySelector<HTMLElement>("[data-bg]")!;
    const vig = root.querySelector<HTMLElement>("[data-vignette]")!;
    const codes = Array.from(root.querySelectorAll<HTMLElement>("[data-code]"));
    const comments = Array.from(root.querySelectorAll<HTMLElement>("[data-comment]"));
    const carets = Array.from(root.querySelectorAll<HTMLElement>("[data-caret]"));
    const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-step]"));
    const casings = Array.from(root.querySelectorAll<SVGPathElement>("[data-casing]"));
    const flows = Array.from(root.querySelectorAll<SVGPathElement>("[data-flow]"));
    const panel = root.querySelector<HTMLElement>("[data-burned]")!;

    gsap.set([...codes, ...comments], { text: "" });
    gsap.set(casings, { drawSVG: "0%" });
    gsap.set(flows, { opacity: 0 });
    gsap.set(steps, { "--lit": 0 });

    const tl = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: desktop
        ? { trigger: pin, start: "top top", end: "+=200%", pin: true, scrub: true }
        : { trigger: pin, start: "top 65%", toggleActions: "play none none none" },
    });
    // the camera descends: the trench grows, the dark closes in
    tl.fromTo(bg, { scale: 1 }, { scale: 1.6, duration: 1, transformOrigin: "52% 68%" }, 0).fromTo(vig, { scale: 2.4 }, { scale: 1, duration: 1 }, 0);
    // three pipes
    tl.to(casings, { drawSVG: "100%", duration: 0.22, stagger: 0.06 }, 0.03).to(flows, { opacity: 1, duration: 0.05 }, 0.3);
    // the burn path types itself, line by line; each step lights as its line lands
    let t = 0.08;
    const PER_CHAR = 0.0115;
    LINES.forEach((l, i) => {
      const dc = Math.max(0.02, l.code.length * PER_CHAR * 0.55);
      const t0 = t;
      tl.to(codes[i], { text: { value: l.code }, duration: dc }, t);
      t += dc;
      if (l.comment) {
        const dm = l.comment.length * PER_CHAR * 0.4;
        tl.to(comments[i], { text: { value: l.comment }, duration: dm }, t);
        t += dm;
      }
      // a caret rides the line being typed
      tl.set(carets[i], { opacity: 1 }, t0).set(carets[i], { opacity: 0 }, t + 0.008);
      (STEP_AT_LINE[i] ?? []).forEach((s, k) => tl.to(steps[s], { "--lit": 1, duration: 0.04 }, t + k * 0.03));
      t += 0.012;
    });
    tl.from(panel, { opacity: 0.15, y: 30, duration: 0.08 }, Math.min(0.86, t));
    tl.to({}, { duration: 0.05 }, 0.95); // a beat of stillness before the pin releases
    if (!desktop) tl.timeScale(0.16);
  });

  return (
    <LSection id="trench" numeral="V" label="The Trench" inner={false} night className="bg-abyss pt-28 md:pt-36">
      <div ref={ref}>
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">
          <LHead
            id="trench"
            numeral="V"
            kicker="The Trench"
            coord="USDG → ETH → $EBB → burn()"
            title="Three pipes run into the Trench. Nobody can close them, including us."
            lede="Every burn takes the same public path: USDG to ETH to $EBB, then burn(). Total supply falls by exactly the amount burned, and each burn prints a Logbook entry."
          />
        </div>
        <div data-pin className="relative overflow-hidden md:h-screen">
          <div data-bg className="absolute inset-0 will-change-transform">
            <Image src="/media/trench.jpg" alt="" fill sizes="100vw" className="object-cover object-[52%_60%]" />
          </div>
          <div data-vignette aria-hidden="true" className="absolute inset-[-10%] will-change-transform bg-[radial-gradient(ellipse_at_52%_62%,transparent_0%,transparent_28%,rgba(2,7,13,0.78)_58%,#02070d_80%)]" />
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-abyss to-transparent" />
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-abyss to-transparent" />

          <div className="relative mx-auto grid h-full max-w-[1240px] items-center gap-8 px-4 py-20 sm:px-6 md:grid-cols-[1.15fr_0.85fr] md:py-0 lg:gap-14 lg:px-10">
            <div className="min-w-0">
              <div className="overflow-hidden rounded-[2px] border border-line/80 bg-abyss/72 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-md">
                <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
                  <span className="eyebrow truncate">EbbVault.sol · the burn path</span>
                  <CopyButton value={BURN_CODE} />
                </div>
                <pre className="overflow-x-auto px-4 py-4 text-[11.5px] leading-[1.75] text-foam sm:text-[12.5px]" aria-label="The burnExpired function, in pseudo-code">
                  <code>
                    {LINES.map((l, i) => (
                      <span key={i} className="block min-h-[1.75em] whitespace-pre">
                        <span data-code className={i === 1 ? "text-brass-ink" : ""}>
                          {l.code}
                        </span>
                        <span data-comment className="italic text-mist/80">
                          {l.comment}
                        </span>
                        <span data-caret className="ml-0.5 inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] bg-brass opacity-0" aria-hidden="true" />
                      </span>
                    ))}
                  </code>
                </pre>
              </div>
              <ol className="mt-4 flex flex-wrap gap-2" aria-label="Steps of a burn">
                {STEPS.map((s, i) => (
                  <li
                    key={s}
                    data-step
                    className="relative overflow-hidden rounded-[2px] border border-line/80 bg-abyss/60 px-2.5 py-1.5 font-mono text-[11px] text-mist backdrop-blur-sm"
                    style={{ ["--lit" as string]: 1 }}
                  >
                    <span aria-hidden="true" className="absolute inset-0 border border-coral bg-coral/15" style={{ opacity: "var(--lit)" }} />
                    <span className="relative">
                      <span className="text-coral">{String(i + 1).padStart(2, "0")}</span> <span style={{ color: "color-mix(in oklab, var(--foam) calc(var(--lit) * 100%), var(--mist))" }}>{s}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="min-w-0 space-y-4">
              <div className="rounded-[2px] border border-line/80 bg-abyss/65 p-4 backdrop-blur-md">
                <PipesFigure />
                <ol className="mt-3 space-y-2.5">
                  {PIPES.map((p) => (
                    <li key={p.n} className="grid grid-cols-[1.5rem_1fr] gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-coral/70 font-mono text-[10.5px] text-coral">{p.n}</span>
                      <div>
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <h3 className="text-[13.5px] font-semibold text-foam">{p.title}</h3>
                          <span className={`font-mono text-[10px] uppercase tracking-[0.1em] ${p.when === "later" ? "text-mist" : "text-kelp"}`}>{p.when}</span>
                        </div>
                        <p className="text-[12.5px] leading-snug text-mist">{p.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div data-burned className="rounded-[2px] border border-coral/40 bg-abyss/70 p-5 backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">$EBB burned so far</span>
                  {stats.fixture ? <span className="font-mono text-[10px] text-coral">dev fixture</span> : null}
                </div>
                <div className="mt-2 font-display text-5xl leading-none text-coral tnum" style={{ fontVariationSettings: '"opsz" 96' }}>
                  <Scramble text={burned !== null ? compact(burned, 2) : "—"} />
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3 font-mono text-[11.5px]">
                  <div>
                    <dt className="text-mist">burns</dt>
                    <dd className="mt-1 text-foam tnum">
                      <Scramble text={stats.data ? int(stats.data.all_time.burns) : "—"} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-mist">USDG in</dt>
                    <dd className="mt-1 text-foam tnum">
                      <Scramble text={stats.data ? usd(stats.data.all_time.burned_usdg, { whole: true }) : "—"} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-mist">expired 24 h</dt>
                    <dd className="mt-1 text-foam tnum">
                      <Scramble text={stats.data ? usd(stats.data.last_24h.expired, { whole: true }) : "—"} />
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-[12.5px] leading-relaxed text-mist">
                  {preLaunch
                    ? "Nothing has expired yet. The first burn arrives 336 tides after the first flood."
                    : stats.isError && !stats.fixture
                      ? "The API is not answering; the counter fills in when it is back."
                      : "Each burn is a Logbook entry with its transaction, the caller and their tip."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </LSection>
  );
}

function PipesFigure() {
  const W = 420;
  const H = 150;
  const pipes = [
    { d: "M50 6 V60 Q50 78 68 78 H170 Q192 78 196 98 L204 140", open: true },
    { d: "M210 6 V140", open: false },
    { d: "M370 6 V60 Q370 78 352 78 H250 Q228 78 224 98 L216 140", open: false },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Three pipes descend into one trench. Pipe one, expired credit, is open; pipes two and three open later.">
      <defs>
        <pattern id="tr-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--coral)" strokeOpacity="0.55" strokeWidth="1.2" />
        </pattern>
      </defs>
      <path d="M150 112 C 180 112, 186 148, 196 150 L224 150 C 234 148, 240 112, 270 112" fill="url(#tr-hatch)" stroke="var(--coral)" strokeOpacity="0.8" />
      <path d="M0 112 H150 M270 112 H420" stroke="var(--line)" strokeWidth="1.5" />
      {pipes.map((p, i) => (
        <g key={i}>
          <path data-casing d={p.d} fill="none" stroke={p.open ? "color-mix(in oklab, var(--coral) 45%, var(--line))" : "var(--line)"} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          <path
            data-flow
            d={p.d}
            fill="none"
            stroke={p.open ? "var(--coral)" : "var(--mist)"}
            strokeOpacity={p.open ? 1 : 0.55}
            strokeWidth="2"
            strokeDasharray={p.open ? "6 6" : "2 6"}
            strokeLinecap="round"
            className={p.open ? "motion-safe:[animation:flow_1.2s_linear_infinite]" : undefined}
          />
        </g>
      ))}
    </svg>
  );
}
