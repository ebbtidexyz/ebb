"use client";

import { useRef } from "react";
import { API_URL } from "@/lib/env";
import { gsap, SCRAMBLE_CHARS, useGsap } from "@/lib/gsap";
import { CodeBlock } from "../site/code-block";
import { LHead, LSection } from "./kit";

type Box = { x: number; y: number; w: number; h: number; title: string; sub?: string; strong?: boolean; ghost?: boolean };
type Arrow = { d: string; label: string[]; lx: number; ly: number; anchor?: "start" | "middle" | "end"; money?: boolean };

interface Panel {
  band: string;
  note: string;
  boxes: Box[];
  arrows: Arrow[];
  parts: [number, string, string][];
}

const PANELS: Panel[] = [
  {
    band: "Robinhood Chain",
    note: "money and rules",
    boxes: [
      { x: 10, y: 120, w: 170, h: 74, title: "Pons fee escrow", sub: "creator fees, as ETH" },
      { x: 240, y: 104, w: 200, h: 106, title: "EbbVault · the Basin", sub: "no owner · no proxy", strong: true },
      { x: 500, y: 120, w: 150, h: 74, title: "$EBB pool", sub: "trades + burns" },
      { x: 240, y: 300, w: 200, h: 44, title: "servers and strangers", ghost: true },
    ],
    arrows: [
      { d: "M180 157 H236", label: ["claim() · ETH"], lx: 208, ly: 146, anchor: "middle", money: true },
      { d: "M440 157 H496", label: ["buy · burn()"], lx: 468, ly: 146, anchor: "middle", money: true },
      { d: "M340 298 V214", label: ["harvest · commitGrants", "withdrawForUsage · burnExpired"], lx: 350, ly: 248 },
    ],
    parts: [
      [1, "Pons fee escrow", "2.7% of every trade, as ETH. Fees collect on the curve or Pons’ hook, are swept here, and wait until harvest() claims them."],
      [2, "EbbVault, the Basin", "Books USDG per tide, commits grant roots, pays settlement, burns expired credit. No owner, no upgrade path."],
      [3, "$EBB and its pool", "Where trades happen, and where every burn buys before calling burn()."],
    ],
  },
  {
    band: "Ebb servers",
    note: "meter, allocate, publish",
    boxes: [
      { x: 10, y: 20, w: 640, h: 40, title: "EbbVault", ghost: true },
      { x: 10, y: 150, w: 120, h: 62, title: "Indexer", sub: "Transfer logs" },
      { x: 170, y: 150, w: 120, h: 62, title: "Allocator", sub: "TWAB at :00/:30" },
      { x: 330, y: 150, w: 120, h: 62, title: "Keeper", sub: "only holds gas" },
      { x: 490, y: 150, w: 160, h: 62, title: "Settlement", sub: "hourly, with a root" },
      { x: 330, y: 290, w: 140, h: 62, title: "Gateway", sub: "oldest pool first" },
      { x: 10, y: 290, w: 140, h: 62, title: "Publisher", sub: "Logbook rows" },
    ],
    arrows: [
      { d: "M130 181 H166", label: ["TWAB"], lx: 148, ly: 172, anchor: "middle" },
      { d: "M230 148 V64", label: ["commitGrants(root)"], lx: 238, ly: 110 },
      { d: "M390 148 V64", label: ["harvest()", "burnExpired()"], lx: 398, ly: 100 },
      { d: "M570 148 V64", label: ["withdrawForUsage", "(tide, amt, root)"], lx: 578, ly: 96, money: true },
      { d: "M470 321 H570 V216", label: ["debits"], lx: 520, ly: 312, anchor: "middle" },
      { d: "M80 288 V216", label: ["reads"], lx: 88, ly: 258 },
    ],
    parts: [
      [4, "Publisher", "Turns each tide into a Logbook row and a receipt card, and serves Soundings."],
      [5, "Gateway", "Hashes keys, rate-limits by depth, reserves cost from the oldest pool, settles the real cost."],
      [6, "Settlement", "Hourly, pays providers for used credit via withdrawForUsage, with a Merkle root of the requests."],
      [7, "Keeper", "Calls harvest() and burnExpired(). Its key holds only gas, and both calls are open to anyone."],
      [8, "Allocator", "At :00 and :30, computes time-weighted balances and commits the grant root."],
      [9, "Indexer", "Reads every $EBB transfer, three blocks behind the head, into balance timelines."],
    ],
  },
  {
    band: "Outside",
    note: "people and providers",
    boxes: [
      { x: 10, y: 60, w: 190, h: 70, title: "Holders + tools", sub: "one key, any client" },
      { x: 240, y: 60, w: 170, h: 70, title: "Gateway", ghost: true },
      { x: 460, y: 60, w: 190, h: 70, title: "Model providers", sub: "named, at list price" },
      { x: 10, y: 260, w: 190, h: 70, title: "Anyone", sub: "strangers and bots" },
      { x: 460, y: 260, w: 190, h: 70, title: "EbbVault", ghost: true },
    ],
    arrows: [
      { d: "M200 95 H236", label: ["POST /v1/chat/completions"], lx: 218, ly: 160, anchor: "middle" },
      { d: "M410 95 H456", label: ["forward"], lx: 433, ly: 86, anchor: "middle" },
      { d: "M555 256 V134", label: ["pays used credit"], lx: 563, ly: 200, money: true },
      { d: "M200 295 H456", label: ["harvest() · burnExpired() + tip"], lx: 328, ly: 284, anchor: "middle" },
    ],
    parts: [
      [10, "Holders and their tools", "Sign one message, paste a key into any OpenAI-compatible client."],
      [11, "Model providers", "Named upstream models at list price. More than one, so no single provider is a dependency."],
      [12, "Anyone", "Can call harvest() or burnExpired() and earn the tip. Nobody can stall a burn."],
    ],
  },
];

export function Hull() {
  const ref = useRef<HTMLDivElement>(null);

  useGsap(ref, ({ motion, desktop }) => {
    const root = ref.current!;
    if (!motion) return;
    const pin = root.querySelector<HTMLElement>("[data-pin]")!;
    const track = root.querySelector<HTMLElement>("[data-track]")!;
    const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-panel]"));
    const progress = root.querySelector<HTMLElement>("[data-progress]");

    panels.forEach((p) => {
      gsap.set(p.querySelectorAll("[data-arrow]"), { drawSVG: "0%" });
      gsap.set(p.querySelectorAll("[data-arrow-head]"), { opacity: 0 });
    });

    const enter = (p: HTMLElement, st: ScrollTrigger.Vars) => {
      const tl = gsap.timeline({ scrollTrigger: st, defaults: { ease: "tide" } });
      tl.from(p.querySelectorAll("[data-box]"), { opacity: 0, y: 18, duration: 0.6, stagger: 0.06 })
        .to(p.querySelectorAll("[data-arrow]"), { drawSVG: "100%", duration: 0.7, stagger: 0.12, ease: "ebb" }, 0.25)
        .to(p.querySelectorAll("[data-arrow-head]"), { opacity: 1, duration: 0.2, stagger: 0.12 }, 0.75);
      p.querySelectorAll<SVGTextElement>("[data-call]").forEach((el, i) => {
        const text = el.textContent ?? "";
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.1 }, 0.5 + i * 0.1).to(el, { scrambleText: { text, chars: SCRAMBLE_CHARS, speed: 0.6 }, duration: 0.9, ease: "none" }, 0.5 + i * 0.1);
      });
    };

    if (desktop) {
      const dist = () => track.scrollWidth - pin.clientWidth;
      const move = gsap.to(track, {
        x: () => -dist(),
        ease: "none",
        scrollTrigger: { trigger: pin, start: "top top", end: () => `+=${dist()}`, pin: true, scrub: true, invalidateOnRefresh: true },
      });
      if (progress) gsap.fromTo(progress, { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { trigger: pin, start: "top top", end: () => `+=${dist()}`, scrub: true } });
      panels.forEach((p, i) => enter(p, i === 0 ? { trigger: pin, start: "top 60%", once: true } : { trigger: p, containerAnimation: move, start: "left 70%", once: true }));
    } else {
      panels.forEach((p) => enter(p, { trigger: p, start: "top 75%", once: true }));
    }
  });

  return (
    <LSection id="hull" numeral="VIII" label="Hull" className="py-28 md:py-36" inner={false}>
      <div ref={ref}>
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">
          <LHead
            id="hull"
            numeral="VIII"
            kicker="Hull"
            coord="cross-section · 12 parts"
            title="One ownerless vault, six small services around it."
            lede="The chain holds the money and the rules. Our servers meter, allocate and publish, and every step they take leaves a trace you can check against the chain."
          />
        </div>
        <div data-pin className="relative md:flex md:h-screen md:flex-col md:justify-center md:overflow-hidden md:motion-reduce:h-auto md:motion-reduce:overflow-visible">
          <div className="mx-auto mb-6 hidden w-full max-w-[1240px] items-center gap-4 px-10 md:flex md:motion-reduce:hidden">
            <span className="eyebrow">Chain</span>
            <span className="relative h-px flex-1 bg-line">
              <span data-progress className="absolute inset-0 origin-left bg-brass" />
            </span>
            <span className="eyebrow">Outside</span>
          </div>
          <div data-track className="flex flex-col gap-6 px-4 sm:px-6 md:w-max md:flex-row md:gap-8 md:pl-[max(2.5rem,calc((100vw-1240px)/2+2.5rem))] md:pr-[12vw] md:motion-reduce:mx-auto md:motion-reduce:w-full md:motion-reduce:max-w-[1240px] md:motion-reduce:flex-col md:motion-reduce:px-10">
            {PANELS.map((p, i) => (
              <article key={p.band} data-panel className="neatline flex shrink-0 flex-col p-5 md:w-[min(76vw,1000px)] md:p-8 md:motion-reduce:w-full">
                <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
                  <h3 className="font-display text-3xl text-foam md:text-4xl">
                    <span className="mr-3 font-mono text-[12px] text-brass-ink">0{i + 1}</span>
                    {p.band}
                  </h3>
                  <span className="eyebrow">{p.note}</span>
                </div>
                <div className="mt-6 grid gap-8 md:grid-cols-[1.35fr_1fr]">
                  <div className="-mx-1 overflow-x-auto px-1">
                    <div className="min-w-[540px] md:min-w-0">
                      <PanelFigure p={p} id={i} />
                    </div>
                  </div>
                  <ol className="space-y-4">
                    {p.parts.map(([n, t, b]) => (
                      <li key={n} className="grid grid-cols-[1.75rem_1fr] gap-2">
                        <span className="font-mono text-[11px] text-brass-ink tnum">{String(n).padStart(2, "0")}</span>
                        <div>
                          <div className="text-[14px] font-semibold text-foam">{t}</div>
                          <p className="mt-0.5 text-[13px] leading-relaxed text-mist">{b}</p>
                        </div>
                      </li>
                    ))}
                    {i === 2 ? (
                      <li>
                        <CodeBlock className="mt-2" lang="py" title="the API, in two lines" code={`base_url = "${API_URL}/v1"\napi_key  = "sk-ebb-…"   # one signature, no transaction`} />
                      </li>
                    ) : null}
                  </ol>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </LSection>
  );
}

function PanelFigure({ p, id }: { p: Panel; id: number }) {
  return (
    <svg viewBox="0 0 660 370" className="h-auto w-full" role="img" aria-label={`${p.band}: ${p.arrows.map((a) => a.label.join(" ")).join("; ")}.`}>
      <defs>
        <pattern id={`hull-hatch-${id}`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" stroke="var(--line)" strokeOpacity="0.5" />
        </pattern>
      </defs>
      {p.boxes.map((b) => (
        <g key={b.title + b.x} data-box>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={b.ghost ? `url(#hull-hatch-${id})` : "var(--abyss)"} stroke={b.strong ? "var(--brass)" : "var(--line)"} strokeWidth={b.strong ? 1.5 : 1} strokeDasharray={b.ghost ? "4 4" : undefined} />
          <text x={b.x + (b.ghost ? b.w / 2 : 14)} y={b.y + (b.ghost ? b.h / 2 + 4 : 26)} textAnchor={b.ghost ? "middle" : "start"} fontSize={b.ghost ? 11 : b.strong ? 16 : 14} fontWeight={b.ghost ? 400 : 600} fontFamily={b.ghost ? "var(--font-mono)" : "var(--font-sans)"} fill={b.ghost ? "var(--mist)" : "var(--foam)"} letterSpacing={b.ghost ? 1.5 : 0}>
            {b.ghost ? b.title.toUpperCase() : b.title}
          </text>
          {b.sub ? (
            <text x={b.x + 14} y={b.y + 48} fontSize="11.5" fontFamily="var(--font-mono)" fill="var(--mist)">
              {b.sub}
            </text>
          ) : null}
        </g>
      ))}
      {p.arrows.map((a) => {
        return (
          <g key={a.d}>
            <path data-arrow d={a.d} fill="none" stroke={a.money ? "var(--brass)" : "var(--mist)"} strokeOpacity={a.money ? 1 : 0.8} strokeWidth={a.money ? 1.8 : 1.3} />
            <ArrowHead d={a.d} money={a.money} />
            {a.label.map((l, i) => (
              <text
                key={l}
                data-call
                x={a.lx}
                y={a.ly + i * 15}
                textAnchor={a.anchor ?? "start"}
                fontSize="11.5"
                fontFamily="var(--font-mono)"
                fill={a.money ? "var(--brass-ink)" : "var(--foam)"}
                paintOrder="stroke"
                stroke="var(--abyss)"
                strokeWidth="4"
                strokeLinejoin="round"
              >
                {l}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** A small head at the end of an H/V path, pointing along its last segment. */
function ArrowHead({ d, money }: { d: string; money?: boolean }) {
  const tokens = d.match(/[MHV]\s*-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?)?/g) ?? [];
  let x = 0;
  let y = 0;
  let px = 0;
  let py = 0;
  for (const t of tokens) {
    const nums = t.slice(1).trim().split(/\s+/).map(Number);
    px = x;
    py = y;
    if (t[0] === "M") [x, y] = nums;
    else if (t[0] === "H") x = nums[0];
    else y = nums[0];
  }
  const ang = (Math.atan2(y - py, x - px) * 180) / Math.PI;
  return <path data-arrow-head d="M0 0 L-8 -4.5 L-8 4.5 Z" transform={`translate(${x} ${y}) rotate(${ang})`} fill={money ? "var(--brass)" : "var(--mist)"} />;
}
