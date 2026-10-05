"use client";

import { useRef } from "react";
import { gsap, ScrollTrigger, useGsap } from "@/lib/gsap";
import { useChainHead, useSoundings, useStats } from "@/lib/queries";
import { compact, int, tokenNum, usd } from "@/lib/format";

/** A thin band of live figures; its speed and skew follow scroll velocity. */
export function Marquee() {
  const ref = useRef<HTMLDivElement>(null);
  const stats = useStats();
  const head = useChainHead();
  const snd = useSoundings();
  const s = stats.data;

  const items: [string, string, string?][] = [
    ["Granted, all time", s ? usd(s.all_time.granted, { whole: true }) : "—"],
    ["$EBB burned", s ? compact(tokenNum(s.all_time.burned_ebb), 2) : "—", "coral"],
    ["Current tide", s ? `#${int(s.tide.current)}` : "—"],
    ["Chain head", head.data ? int(head.data) : "—", "live"],
    ["USDG in the Basin", snd.data?.vault_usdg != null ? usd(snd.data.vault_usdg) : "—", "brass"],
    ["Tides per day", "48"],
    ["Life of a pool", "336 tides"],
  ];

  useGsap(ref, ({ motion }) => {
    const root = ref.current!;
    const track = root.querySelector<HTMLElement>("[data-track]")!;
    if (!motion) return;
    const loop = gsap.to(track, { xPercent: -25, duration: 38, ease: "none", repeat: -1 });
    loop.totalTime(38 * 500); // headroom so a reversed (scroll-up) loop never hits time 0
    const skewTo = gsap.quickTo(track, "skewX", { duration: 0.5, ease: "power3" });
    let dir = 1;
    let idle: gsap.core.Tween | null = null;
    ScrollTrigger.create({
      trigger: root,
      start: "top bottom",
      end: "bottom top",
      onUpdate(self) {
        const v = gsap.utils.clamp(-3000, 3000, self.getVelocity());
        dir = self.direction;
        gsap.to(loop, { timeScale: dir * (1 + Math.abs(v) / 260), duration: 0.25, overwrite: true });
        skewTo(gsap.utils.clamp(-9, 9, v / -260));
        idle?.kill();
        idle = gsap.delayedCall(0.18, () => {
          skewTo(0);
          gsap.to(loop, { timeScale: dir, duration: 1.2, ease: "power2.out", overwrite: true });
        });
      },
    });
    return () => idle?.kill();
  });

  const group = (k: number) => (
    <div key={k} className="flex shrink-0 items-center" aria-hidden={k > 0 ? "true" : undefined}>
      {items.map(([label, value, tone]) => (
        <div key={label} className="flex items-center gap-3 px-7">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist">{label}</span>
          {tone === "live" ? <span className="live-dot" aria-hidden="true" /> : null}
          <span className={`font-display text-[1.375rem] leading-none tnum ${tone === "coral" ? "text-coral" : tone === "brass" ? "text-brass-ink" : "text-foam"}`} style={{ fontVariationSettings: '"opsz" 48' }}>
            {value}
          </span>
          <svg width="12" height="12" viewBox="0 0 14 14" className="ml-7 shrink-0 text-brass" aria-hidden="true">
            <path d="M7 0 8.2 5.8 14 7 8.2 8.2 7 14 5.8 8.2 0 7 5.8 5.8Z" fill="currentColor" opacity="0.8" />
          </svg>
        </div>
      ))}
    </div>
  );

  return (
    <div ref={ref} className="relative overflow-hidden border-y border-line bg-abyss/70 py-4 backdrop-blur-sm" role="region" aria-label="Live figures">
      <div data-track className="flex w-max will-change-transform">{[0, 1, 2, 3].map(group)}</div>
    </div>
  );
}
