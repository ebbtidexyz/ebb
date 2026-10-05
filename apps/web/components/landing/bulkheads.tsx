"use client";

import Image from "next/image";
import { useRef } from "react";
import { gsap, ScrollTrigger, useGsap } from "@/lib/gsap";
import { IconCheck, IconShield, IconWarning } from "../site/icons";
import { LHead, LSection, revealIn } from "./kit";

const INVARIANTS = [
  ["I1", "USDG in the Basin equals the sum of every open tide’s remainder", "usdg.balanceOf(vault) == Σ remaining(e)"],
  ["I2", "A tide never pays out more than it granted, nor grants more than it booked", "withdrawn(e) ≤ granted(e) ≤ booked(e)"],
  ["I3", "Nothing can be burned before the tide is seven days old", "burnExpired reverts before epochStart + 7d"],
  ["I4", "A burned tide can never be withdrawn again", "withdrawForUsage(burned) reverts"],
  ["I5", "Every harvest splits exactly 70 / 30", "toPool × 3000 == toTreasury × 7000"],
  ["I6", "Swaps revert beyond 3% of the 30-minute TWAP", "|out − quote| ≤ 3%"],
  ["I7", "Total supply drops by exactly the amount burned", "ΔtotalSupply == ebbBurned"],
  ["I8", "USDG leaves only to settlement, treasury, the burn path or the caller tip", "no other transfer target exists"],
] as const;

const ATTACKS = [
  ["Buy just before the tide turns, sell just after", "Grants use time-weighted balances. Five minutes of holding earns a sixth of a tide’s share."],
  ["Wash trading to farm grants", "A round trip costs 6% in fees and only a slice returns, pro-rata to every holder. Always a loss."],
  ["Splitting a bag across wallets", "Pro-rata maths gains nothing from splitting, and the 100,000 floor keeps dust wallets out."],
  ["Phishing a signature to steal a key", "Keys are random, issued per sign-in with a single-use nonce and expiry. An old signature mints nothing."],
  ["Junk requests to dodge the burn", "Provider cost is real money. Junk only moves value from the burn to a provider."],
  ["A compromised operator key", "It can only pay one fixed settlement address, capped per tide by what was granted, and a guardian can freeze it."],
  ["The team quietly moving the pool", "There is no function for it. The Basin has no owner, no proxy and no delegatecall."],
  ["The indexer falling behind", "Tides wait. The allocator never guesses a balance; it commits only what it has indexed."],
] as const;

const SECURITY = [
  "Holders never deposit anything to receive credit",
  "API keys are stored as SHA-256 hashes; a leaked database leaks no keys",
  "The keeper key holds only gas money, and every call it makes is open to anyone",
  "Fail closed: if settlement fails three times, spending pauses until it is fixed",
  "Contracts, API and this site are built from one constants file, so every number matches",
  "The creator fee recipient is the Basin, which has no function to change it: nobody we control can redirect the fees",
];

const RISKS = [
  "Grants follow volume. If trading fades, every tide shrinks with it",
  "Metering runs on our gateway. Withdrawals are bounded per tide, rooted and freezable, but usage is still reported by us",
  "Pons’ owner, a 2-of-3 Safe, can propose moving the creator fees away from the Basin. It is public and waits three days; we watch for it and will announce it",
  "Pons v2 is not yet audited, and after graduation fees reach the Basin only when Pons sweeps them",
  "Providers can change prices or access; we keep more than one",
  "At launch the Basin is fork-tested and invariant-tested, not yet externally audited; that review is on the charted course",
];

// lighthouse.jpg: 2400 × 1339, lamp at (26%, 22.4%); shown with object-position 28% 50%
const IMG = { w: 2400, h: 1339, lx: 0.26, ly: 0.224, ox: 0.28, oy: 0.5 };

export function Bulkheads() {
  const ref = useRef<HTMLDivElement>(null);

  useGsap(ref, ({ motion, desktop }) => {
    const root = ref.current!;
    const stageEl = root.querySelector<HTMLElement>("[data-light]")!;
    const beam = root.querySelector<HTMLElement>("[data-beam]")!;
    const rot = root.querySelector<HTMLElement>("[data-beam-rot]")!;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-inv]"));
    let lamp = { x: 0, y: 0 };
    let angles: number[] = [];
    let range = { from: -20, to: 60 };

    const measure = () => {
      const photo = root.querySelector<HTMLElement>("[data-photo]")!;
      const W = photo.clientWidth;
      const H = photo.clientHeight;
      const s = Math.max(W / IMG.w, H / IMG.h);
      const dw = IMG.w * s;
      const dh = IMG.h * s;
      lamp = { x: (W - dw) * IMG.ox + IMG.lx * dw, y: (H - dh) * IMG.oy + IMG.ly * dh };
      gsap.set(beam, { left: lamp.x, top: lamp.y });
      const box = stageEl.getBoundingClientRect();
      angles = cards.map((c) => {
        const r = c.getBoundingClientRect();
        // positions inside the (possibly transformed) stage, in its own pixels
        const cx = r.left - box.left + r.width / 2;
        const cy = r.top - box.top + r.height / 2;
        return (Math.atan2(cy - lamp.y, cx - lamp.x) * 180) / Math.PI;
      });
      if (desktop) range = { from: Math.min(...angles) - 18, to: Math.max(...angles) + 16 };
    };

    /** beam at screen angle β (deg, clockwise from +x); every card's light follows */
    const light = (beta: number, dawn = 0) => {
      gsap.set(rot, { rotation: beta + 90 });
      if (!desktop) return;
      cards.forEach((c, i) => {
        const d = Math.abs(angles[i] - beta);
        const hit = Math.max(0, 1 - d / 11);
        const base = beta > angles[i] + 11 ? 0.62 : 0.24;
        const v = Math.max(base, hit, dawn);
        c.style.opacity = v.toFixed(3);
        c.style.setProperty("--lit", Math.max(hit, dawn * 0.35).toFixed(3));
      });
    };

    measure();

    if (!motion) {
      cards.forEach((c) => (c.style.opacity = "1"));
      gsap.set(rot, { rotation: 20 + 90 });
      return;
    }
    const proxy = { b: range.from, dawn: 0 };
    const tl = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: desktop
        ? { trigger: stageEl, start: "top top", end: "+=160%", pin: true, scrub: true, onRefresh: () => (measure(), light(proxy.b, proxy.dawn)) }
        : { trigger: stageEl, start: "top 80%", end: "bottom 30%", scrub: true, onRefresh: () => (measure(), light(proxy.b, proxy.dawn)) },
      onUpdate: () => light(proxy.b, proxy.dawn),
    });
    tl.fromTo(proxy, { b: () => range.from }, { b: () => range.to, duration: 0.82 }, 0).to(proxy, { dawn: 1, duration: 0.18 }, 0.82);
    if (!desktop) {
      // phones: cards are stacked under the picture; each lights as it reaches the middle
      cards.forEach((c) => {
        c.style.opacity = "0.35";
        ScrollTrigger.create({
          trigger: c,
          start: "top 70%",
          end: "bottom 30%",
          onToggle: (self) => gsap.to(c, { opacity: self.isActive ? 1 : 0.6, "--lit": self.isActive ? 1 : 0, duration: 0.5 }),
        });
      });
    }
    light(proxy.b, 0);
    revealIn(root); // after the pin, so the table reveals know about its spacer
  });

  return (
    <LSection id="bulkheads" numeral="IX" label="Bulkheads" className="py-28 md:py-36" inner={false}>
      <div ref={ref}>
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">
          <LHead
            id="bulkheads"
            numeral="IX"
            kicker="Bulkheads"
            coord="I1 – I8 · invariant tests"
            title="Eight bulkheads. Each one holds on every test run."
            lede="The Basin is tested against eight invariants under randomised call sequences. Watch the beam sweep the compartments: if one floods, the others keep the hull afloat."
          />
        </div>

        <div data-light className="night relative overflow-hidden md:h-screen">
          <div data-photo className="relative h-[62vh] min-h-[380px] md:absolute md:inset-0 md:h-auto">
            <Image src="/media/lighthouse.jpg" alt="A lighthouse on a rocky point throws its beam over a storm sea at night" fill sizes="100vw" className="object-cover object-[28%_50%]" />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,19,31,0.15)_0%,rgba(7,19,31,0.35)_40%,rgba(7,19,31,0.82)_75%)]" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-abyss to-transparent" />
            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-abyss to-transparent" />
          </div>
          {/* the sweeping beam: a conic wedge rotating about the lamp */}
          <div data-beam aria-hidden="true" className="pointer-events-none absolute left-[23%] top-[22%] h-0 w-0">
            <div
              data-beam-rot
              className="absolute -left-[150vmax] -top-[150vmax] h-[300vmax] w-[300vmax] mix-blend-screen will-change-transform"
              style={{
                background: "conic-gradient(from -10deg at 50% 50%, rgba(255,214,150,0) 0deg, rgba(255,214,150,0.34) 10deg, rgba(255,214,150,0) 20deg, rgba(255,214,150,0) 360deg)",
                WebkitMaskImage: "radial-gradient(circle at 50% 50%, #000 0%, #000 12%, transparent 34%)",
                maskImage: "radial-gradient(circle at 50% 50%, #000 0%, #000 12%, transparent 34%)",
              }}
            />
            <span className="absolute -left-6 -top-6 h-12 w-12 rounded-full bg-[radial-gradient(circle,rgba(255,232,180,0.95),rgba(255,214,150,0.35)_40%,transparent_70%)] motion-safe:[animation:beacon_3.2s_ease-in-out_infinite]" />
          </div>

          <ol className="relative grid gap-3 px-4 py-8 sm:grid-cols-2 sm:px-6 md:absolute md:right-[max(2.5rem,calc((100vw-1240px)/2+2.5rem))] md:top-1/2 md:w-[min(56vw,720px)] md:-translate-y-1/2 md:gap-3.5 md:p-0">
            {INVARIANTS.map(([id, text, code]) => (
              <li
                key={id}
                data-inv
                className="relative overflow-hidden rounded-[2px] border border-line/80 bg-abyss/70 p-4 backdrop-blur-md transition-[border-color] duration-300"
                style={{ ["--lit" as string]: 0, borderColor: "color-mix(in oklab, var(--brass) calc(var(--lit) * 100%), var(--line))" }}
              >
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,214,150,0.16),transparent_60%)]" style={{ opacity: "var(--lit)" }} />
                <div className="relative flex items-start gap-3">
                  <span className="font-mono text-[13px] text-brass-ink">{id}</span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] leading-snug text-foam">{text}</p>
                    <code className="mt-1.5 block truncate font-mono text-[11px] text-mist">{code}</code>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="mx-auto mt-20 max-w-[1240px] px-4 sm:px-6 lg:px-10">
          <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
            <div>
              <div className="flex items-baseline justify-between">
                <h3 data-reveal className="font-display text-3xl text-foam">
                  Attack and defence
                </h3>
                <span className="eyebrow">{ATTACKS.length} closed before launch</span>
              </div>
              <div className="mt-5 border-y border-line">
                <div className="hidden grid-cols-[0.8fr_1.2fr] gap-6 border-b border-line py-3 md:grid">
                  <span className="eyebrow">The play</span>
                  <span className="eyebrow">Why it fails</span>
                </div>
                <dl data-stagger>
                  {ATTACKS.map(([a, d]) => (
                    <div key={a} className="grid gap-1.5 border-b border-line/60 py-4 last:border-b-0 md:grid-cols-[0.8fr_1.2fr] md:gap-6">
                      <dt className="text-[14.5px] text-foam">{a}</dt>
                      <dd className="text-[14.5px] text-mist">{d}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            <div className="space-y-10">
              <div data-reveal>
                <h3 className="eyebrow flex items-center gap-2">
                  <IconShield size={14} className="text-kelp" /> Security model
                </h3>
                <ul className="mt-4 space-y-3">
                  {SECURITY.map((s) => (
                    <li key={s} className="flex gap-3 text-[14px] text-foam">
                      <IconCheck size={15} className="mt-0.5 shrink-0 text-kelp" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div data-reveal="0.1">
                <h3 className="eyebrow">What could still hurt</h3>
                <ul className="mt-4 space-y-3">
                  {RISKS.map((s) => (
                    <li key={s} className="flex gap-3 text-[14px] text-mist">
                      <IconWarning size={15} className="mt-0.5 shrink-0 text-coral" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </LSection>
  );
}
