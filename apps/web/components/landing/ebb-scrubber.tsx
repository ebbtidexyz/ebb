"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { Draggable, gsap, scrollToY, triggerY, useGsap } from "@/lib/gsap";
import { LHead, LSection, revealIn } from "./kit";

const HOURS = 168;
const TAU = 44;
const K = 1 - Math.exp(-HOURS / TAU);
/** share of the timeline spent on hours 0 → 168; the rest is the drain into the Trench */
const SPAN = 0.8;

const PROFILES = [
  { id: "light", label: "Light", share: 0.15, note: "a few questions a day" },
  { id: "steady", label: "Steady", share: 0.45, note: "an assistant in your editor" },
  { id: "heavy", label: "Heavy", share: 0.85, note: "agents running all week" },
] as const;
type Profile = (typeof PROFILES)[number];

function spentAt(h: number, share: number) {
  return (share * (1 - Math.exp(-Math.min(h, HOURS) / TAU))) / K;
}

/** hours at which a request draws on the pool: evenly spaced in money, so dense early, sparse late */
const EVENTS = Array.from({ length: 20 }, (_, k) => Math.round(-TAU * Math.log(1 - ((k + 0.5) / 20) * K) * 100) / 100);

const FACTS = [
  ["Oldest first", "FIFO. Requests draw on the pool closest to the Trench, so you never lose fresh credit to an old countdown."],
  ["Not transferable", "Credit belongs to the wallet the grant was committed to. Keys spend it; they cannot move it."],
  ["Not cash", "It buys model usage at list price. It never turns into ETH, USDG or anything else."],
  ["Not revivable", "An expired pool is already buying $EBB. It does not come back."],
];

/** x of a timeline fraction on the track, matching the 22 px handle's centre */
const at = (p: number) => `calc(${(p * 100).toFixed(3)}% + ${(11 - 22 * p).toFixed(2)}px)`;

function stateAt(p: number, share: number) {
  const h = Math.min(1, p / SPAN) * HOURS;
  const drain = p <= SPAN ? 0 : Math.min(1, (p - SPAN) / (1 - SPAN));
  const spent = spentAt(h, share);
  const left = 1 - spent;
  const remaining = left * (1 - drain);
  const burned = left * drain;
  return { h, drain, spent, remaining, burned };
}

export function EbbScrubber() {
  const ref = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<Profile>(PROFILES[1]);
  const share = useRef<number>(profile.share);
  share.current = profile.share;
  const api = useRef<{ seek: (p: number) => void; render: () => void }>({ seek: () => {}, render: () => {} });
  const initial = useMemo(() => stateAt(0, PROFILES[1].share), []);

  useGsap(ref, ({ motion, desktop }) => {
    const root = ref.current!;
    const pin = root.querySelector<HTMLElement>("[data-pin]")!;
    const wet = root.querySelector<HTMLElement>("[data-wet]")!;
    const line = root.querySelector<SVGGElement>("[data-line]")!;
    const coral = root.querySelector<SVGRectElement>("[data-coral]")!;
    const slot = root.querySelector<HTMLElement>("[data-slot-fill]")!;
    const track = root.querySelector<HTMLElement>("[data-track]")!;
    const handle = root.querySelector<HTMLElement>("[data-handle]")!;
    const input = root.querySelector<HTMLInputElement>("[data-range]")!;
    const ticks = Array.from(root.querySelectorAll<HTMLElement>("[data-tick]"));
    const out = {
      hour: root.querySelector<HTMLElement>("[data-o='hour']")!,
      left: root.querySelector<HTMLElement>("[data-o='left']")!,
      spent: root.querySelector<HTMLElement>("[data-o='spent']")!,
      burned: root.querySelector<HTMLElement>("[data-o='burned']")!,
      note: root.querySelector<HTMLElement>("[data-o='note']")!,
    };
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-fact]"));
    const proxy = { p: 0 };
    let dragging = false;
    let lastHour = -1;
    let lastBurn = "";

    const render = () => {
      const s = stateAt(proxy.p, share.current);
      const y = 1 - (s.remaining * 0.86 + 0.02); // water top, 0..1 from the frame top
      wet.style.clipPath = `inset(${(y * 100).toFixed(2)}% 0 0 0)`;
      gsap.set(line, { y: y * 500 });
      gsap.set(coral, { attr: { y: y * 500, height: 500 - y * 500 }, opacity: Math.min(1, s.drain * 3) });
      gsap.set(slot, { scaleY: s.drain });
      const hour = Math.round(s.h);
      if (hour !== lastHour) {
        lastHour = hour;
        if (motion) gsap.to(out.hour, { scrambleText: { text: String(hour).padStart(3, "0"), chars: "0123456789", speed: 1 }, duration: 0.22, overwrite: true });
        else out.hour.textContent = String(hour).padStart(3, "0");
      }
      out.left.textContent = `$${s.remaining.toFixed(2)}`;
      out.spent.textContent = `$${s.spent.toFixed(2)}`;
      const b = `$${s.burned.toFixed(2)}`;
      if (b !== lastBurn) {
        if (motion && lastBurn === "$0.00" && b !== "$0.00") gsap.fromTo(out.burned, { scale: 1.25 }, { scale: 1, duration: 0.5, ease: "back.out(3)" });
        out.burned.textContent = b;
        lastBurn = b;
      }
      out.note.textContent =
        s.drain >= 1
          ? `Hour 168. $${(1 - s.burned).toFixed(2)} became AI; $${s.burned.toFixed(2)} was drawn into the Trench to buy and burn $EBB.`
          : s.drain > 0
            ? `Hour 168: the pool expires. What is left drains into the Trench.`
            : `Hour ${hour}, day ${Math.min(7, Math.floor(hour / 24) + 1)}. ${HOURS - hour} hours until the Trench.`;
      ticks.forEach((t) => (t.style.opacity = s.h >= Number(t.dataset.tick) ? "1" : "0.18"));
      if (!dragging) {
        const max = track.clientWidth - handle.offsetWidth;
        gsap.set(handle, { x: proxy.p * max });
      }
      input.value = String(Math.round(proxy.p * 1000));
      input.setAttribute("aria-valuetext", `Hour ${hour} of 168${s.drain > 0 ? `, draining into the Trench, ${Math.round(s.drain * 100)}%` : ""}`);
    };

    let seek = (p: number) => {
      proxy.p = gsap.utils.clamp(0, 1, p);
      render();
    };

    if (motion) {
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: desktop
          ? { trigger: pin, start: "top top", end: "+=250%", pin: true, scrub: true }
          : // phones: the hour follows the frame through the viewport, no pin
            { trigger: root.querySelector("[data-frame]"), start: "top 75%", end: "bottom 15%", scrub: true },
      });
      tl.to(proxy, { p: 1, duration: 1, onUpdate: render }, 0);
      if (desktop) cards.forEach((c, i) => tl.from(c, { opacity: 0.12, y: 30, duration: 0.07, ease: "power2.out" }, 0.08 + i * 0.17));
      else revealIn(root);
      const st = tl.scrollTrigger!;
      seek = (p) => scrollToY(triggerY(st, p), false);
    }

    const drag = Draggable.create(handle, {
      type: "x",
      bounds: track,
      inertia: motion,
      cursor: "grab",
      activeCursor: "grabbing",
      onPress() {
        dragging = true;
      },
      onDrag() {
        seek(this.x / Math.max(1, this.maxX));
      },
      onThrowUpdate() {
        seek(this.x / Math.max(1, this.maxX));
      },
      onRelease() {
        if (!this.tween || !this.tween.isActive()) dragging = false;
      },
      onThrowComplete() {
        dragging = false;
      },
    })[0];

    const onInput = () => seek(Number(input.value) / 1000);
    input.addEventListener("input", onInput);
    api.current = { seek, render };
    render();
    return () => {
      drag.kill();
      input.removeEventListener("input", onInput);
    };
  });

  const pick = (p: Profile) => {
    setProfile(p);
    share.current = p.share;
    api.current.render();
  };

  return (
    <LSection id="ebb" numeral="III" label="Ebb" className="py-28 md:py-36">
      <div ref={ref}>
        <LHead
          id="ebb"
          numeral="III"
          kicker="Ebb"
          coord="hour 0 → 168"
          title="Every pool carries its own countdown."
          lede="Spend a credit and it becomes AI. Leave it, and at hour 168 it becomes a buyback. Scroll, or drag the brass handle, to follow one dollar of credit through its week."
        />
        <div data-pin className="md:flex md:h-screen md:items-center">
          <div className="grid w-full items-center gap-10 md:grid-cols-[auto_1fr] lg:gap-16">
            {/* the tidepool */}
            <figure className="mx-auto w-full max-w-[420px] md:w-[min(56vh,38vw)] md:max-w-none">
              <div data-frame className="relative aspect-[4/5] overflow-hidden rounded-[28px] border border-line bg-deep shadow-[0_40px_80px_-40px_rgba(0,0,0,0.8)]">
                <Image src="/media/tidepool.jpg" alt="" fill sizes="(min-width: 768px) 40vw, 92vw" className="object-cover [filter:grayscale(0.55)_brightness(0.42)]" />
                <div data-wet className="absolute inset-0" style={{ clipPath: `inset(${((1 - (initial.remaining * 0.86 + 0.02)) * 100).toFixed(2)}% 0 0 0)` }}>
                  <Image src="/media/tidepool.jpg" alt="A tidepool among dark rocks, anemones under clear water" fill sizes="(min-width: 768px) 40vw, 92vw" className="object-cover [filter:saturate(1.15)]" />
                  <div className="absolute inset-0 bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--water)_38%,transparent),color-mix(in_oklab,var(--water)_12%,transparent))] mix-blend-screen" />
                </div>
                <svg viewBox="0 0 400 500" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                  <rect data-coral x="0" y="0" width="400" height="500" fill="var(--coral)" fillOpacity="0.38" opacity="0" />
                  <g data-line>
                    <g className="motion-safe:[animation:wave-x_5s_linear_infinite]">
                      <path d={`M-40 0 ${Array.from({ length: 12 }, () => "q10 -6 20 0 t20 0").join(" ")}`} fill="none" stroke="#e9e4d6" strokeOpacity="0.85" strokeWidth="1.5" />
                    </g>
                  </g>
                </svg>
                <div className="absolute left-4 top-4 rounded-[2px] bg-abyss/70 px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-foam backdrop-blur-sm">
                  one dollar of credit · {profile.label.toLowerCase()}
                </div>
              </div>
              {/* the narrow slot it drains into */}
              <div className="mx-auto mt-3 flex w-28 flex-col items-center" aria-hidden="true">
                <div className="hachure relative h-16 w-9 overflow-hidden border border-t-0 border-coral/70">
                  <div data-slot-fill className="absolute inset-0 origin-bottom bg-coral/80" style={{ transform: "scaleY(0)" }} />
                </div>
                <span className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-coral">Trench</span>
              </div>
            </figure>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="How much of the credit is spent">
                {PROFILES.map((p) => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={p.id === profile.id}
                    onClick={() => pick(p)}
                    className={`rounded-[2px] border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${p.id === profile.id ? "border-brass text-foam" : "border-line text-mist hover:text-foam"}`}
                  >
                    {p.label} · {Math.round(p.share * 100)}%
                  </button>
                ))}
                <span className="ml-1 text-[12px] text-mist">{profile.note}</span>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden border border-line bg-line sm:grid-cols-4">
                <Readout label="Hour" o="hour" value="000" suffix=" / 168" />
                <Readout label="Spendable" o="left" value="$1.00" />
                <Readout label="Spent on AI" o="spent" value="$0.00" tone="kelp" />
                <Readout label="Bought + burned" o="burned" value="$0.00" tone="coral" />
              </dl>

              {/* the week, with a draggable brass handle */}
              <div className="mt-8">
                <div className="flex justify-between font-mono text-[10.5px] uppercase tracking-[0.12em] text-mist">
                  <span>flood · hour 0</span>
                  <span>hour 168</span>
                  <span className="text-coral">trench</span>
                </div>
                <div className="relative mt-2 h-14">
                  <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
                  <div className="absolute top-1/2 h-px bg-coral/60" style={{ left: at(SPAN), right: 0 }} />
                  <div className="absolute top-[calc(50%-8px)] h-4 w-px bg-coral" style={{ left: at(SPAN) }} />
                  {EVENTS.map((h) => (
                    <span
                      key={h}
                      data-tick={h}
                      className="absolute bottom-[calc(50%+4px)] w-[2px] rounded-full bg-kelp transition-opacity duration-300"
                      style={{ left: at((h / HOURS) * SPAN), height: `${8 + profile.share * 14}px`, opacity: 0.18 }}
                    />
                  ))}
                  {Array.from({ length: 8 }, (_, d) => (
                    <span key={d} className="absolute top-[calc(50%+6px)] font-mono text-[9.5px] text-mist/70" style={{ left: at(((d * 24) / HOURS) * SPAN) }}>
                      {d === 0 ? "" : `d${d}`}
                    </span>
                  ))}
                  <div data-track className="absolute inset-0">
                    <input data-range type="range" min={0} max={1000} step={1} defaultValue={0} aria-label="Hour of the credit's life" className="mirror-range peer" />
                    <div data-handle className="mirror-handle pointer-events-auto absolute left-0 top-1/2 -mt-[11px] flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-brass bg-abyss shadow-[0_0_0_6px_color-mix(in_oklab,var(--brass)_18%,transparent)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-brass" />
                    </div>
                  </div>
                </div>
                <p data-o="note" className="mt-2 min-h-[2.75rem] text-[14px] text-mist" aria-live="polite">
                  Hour 0, day 1. 168 hours until the Trench.
                </p>
              </div>

              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {FACTS.map(([t, b]) => (
                  <li key={t} data-fact data-reveal className="neatline p-4">
                    <h3 className="text-[15px] font-semibold text-foam">{t}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-mist">{b}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </LSection>
  );
}

function Readout({ label, o, value, suffix, tone }: { label: string; o: string; value: string; suffix?: string; tone?: "kelp" | "coral" }) {
  return (
    <div className="bg-deep px-3 py-3 sm:px-4">
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-1.5 font-mono text-xl tnum ${tone === "kelp" ? "text-kelp" : tone === "coral" ? "text-coral" : "text-foam"}`}>
        <span data-o={o} className="inline-block">
          {value}
        </span>
        {suffix ? <span className="text-[13px] text-mist">{suffix}</span> : null}
      </dd>
    </div>
  );
}
