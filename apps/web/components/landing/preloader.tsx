"use client";

import { useEffect, useRef } from "react";
import { gsap, MEDIA, smoother } from "@/lib/gsap";
import { markLandingReady, PRELOADER_SEEN as SEEN } from "./bus";
import { stage } from "./three/store";


/** Ring as a path (so it can be drawn and morphed), starting at north, clockwise. */
const RING = "M100 20 A80 80 0 1 1 100 180 A80 80 0 1 1 100 20 Z";

/** The compass-rose mark as one closed star: 4 long points, 4 short, sharp valleys. */
const ROSE = (() => {
  const pts: string[] = [];
  for (let k = 0; k < 16; k++) {
    const a = ((k * 22.5 - 90) * Math.PI) / 180;
    const r = k % 4 === 0 ? 82 : k % 2 === 0 ? 44 : 13;
    pts.push(`${(100 + r * Math.cos(a)).toFixed(2)} ${(100 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(" L")} Z`;
})();


/**
 * First visit per session: a brass gauge ring draws while a counter scrambles
 * 000 → 100 against real loading (fonts, hero video, nautilus GLB). The ring
 * morphs into the compass rose, then a water line sweeps up to reveal the hero.
 */
export function Preloader() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let seen = false;
    try {
      seen = !!sessionStorage.getItem(SEEN);
    } catch {}
    const reduced = window.matchMedia(MEDIA.reduce).matches;
    if (seen || reduced) {
      root.style.display = "none";
      markLandingReady();
      return;
    }

    const html = document.documentElement;
    html.style.overflow = "hidden";
    smoother()?.paused(true);

    const ring = root.querySelector<SVGPathElement>("[data-ring]")!;
    const ticks = root.querySelector<SVGGElement>("[data-ticks]")!;
    const counter = root.querySelector<HTMLElement>("[data-counter]")!;
    const label = root.querySelector<HTMLElement>("[data-label]")!;
    const mark = root.querySelector<HTMLElement>("[data-mark]")!;
    const water = root.querySelector<HTMLElement>("[data-water]")!;

    // what we wait for, weighted
    let fonts = 0;
    let video = 0;
    document.fonts?.ready.then(() => (fonts = 1)).catch(() => (fonts = 1));
    const v = document.querySelector<HTMLVideoElement>("video[data-hero-video]");
    const onVideo = () => (video = 1);
    if (!v || v.readyState >= 3) video = 1;
    else {
      v.addEventListener("canplay", onVideo, { once: true });
      v.addEventListener("error", onVideo, { once: true });
    }
    const started = performance.now();
    const target = () => {
      const n = stage.failed ? 1 : stage.progress.nautilus;
      const t = 0.15 * fonts + 0.3 * video + 0.55 * n;
      // never hold anyone longer than 9 s
      return performance.now() - started > 9000 ? 1 : t;
    };

    // a context, so React's dev double-mount reverts the from() tweens cleanly
    const ctx = gsap.context(() => {
      gsap.set(ring, { drawSVG: "0% 0%" });
      gsap.set(mark.children, { yPercent: 120, opacity: 0 });
      gsap.from(ticks.children, { opacity: 0, duration: 0.4, stagger: { each: 0.01, from: "start" } });
      gsap.from([counter, label], { y: 12, opacity: 0, duration: 0.8, stagger: 0.1 });
    }, root);

    const shown = { p: 0 };
    let last = -1;
    let finished = false;
    const pad = (n: number) => String(Math.round(n)).padStart(3, "0");

    const tick = () => {
      if (finished) return;
      const goal = target();
      // ease towards the real progress, but never stall visually
      shown.p += (goal - shown.p) * 0.08 + 0.0015;
      shown.p = Math.min(shown.p, goal + 0.02, 1);
      const pct = Math.min(100, Math.floor(shown.p * 100));
      gsap.set(ring, { drawSVG: `0% ${Math.max(0.5, shown.p * 100)}%` });
      if (pct !== last && (pct - last >= 3 || pct === 100)) {
        last = pct;
        gsap.to(counter, { scrambleText: { text: pad(pct), chars: "0123456789", speed: 1 }, duration: 0.18, ease: "none", overwrite: true });
      }
      if (goal >= 1 && shown.p >= 0.995) finish();
    };
    gsap.ticker.add(tick);

    let outro: gsap.core.Timeline | null = null;
    function finish() {
      finished = true;
      gsap.ticker.remove(tick);
      ctx.add(() => {
        gsap.set(ring, { drawSVG: "0% 100%" });
        gsap.to(counter, { scrambleText: { text: "100", chars: "0123456789" }, duration: 0.25, overwrite: true });
      });
      ctx.add(() => {
      outro = gsap.timeline({ defaults: { ease: "tide" } });
      outro
        .to(ticks, { opacity: 0, scale: 0.92, transformOrigin: "50% 50%", duration: 0.6 }, 0.15)
        .to([counter, label], { y: -14, opacity: 0, duration: 0.5, stagger: 0.05 }, 0.2)
        .to(ring, { morphSVG: { shape: ROSE, shapeIndex: "auto" }, duration: 1.1, ease: "ebb" }, 0.3)
        .to(ring, { fill: "var(--brass)", fillOpacity: 1, strokeWidth: 0.6, duration: 0.6 }, 0.9)
        .to(mark.children, { yPercent: 0, opacity: 1, duration: 0.9, stagger: 0.06 }, 1.05)
        .add(() => {
          try {
            sessionStorage.setItem(SEEN, "1");
          } catch {}
          html.style.overflow = "";
          smoother()?.paused(false);
          markLandingReady();
        }, 1.75)
        .fromTo(root, { clipPath: "inset(0% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 100% 0%)", duration: 1.35, ease: "ebb" }, 1.75)
        .fromTo(water, { yPercent: 0 }, { y: () => -window.innerHeight, duration: 1.35, ease: "ebb" }, 1.75)
        .set(root, { display: "none" });
      });
    }

    return () => {
      gsap.ticker.remove(tick);
      outro?.kill();
      ctx.revert();
      v?.removeEventListener("canplay", onVideo);
      v?.removeEventListener("error", onVideo);
      html.style.overflow = "";
      smoother()?.paused(false);
    };
  }, []);

  return (
    <div ref={ref} data-preloader className="night fixed inset-0 z-[100] flex flex-col items-center justify-center bg-abyss" role="status" aria-label="Loading Ebb">
      <div className="relative h-[200px] w-[200px] sm:h-[240px] sm:w-[240px]">
        <svg viewBox="0 0 200 200" className="h-full w-full overflow-visible" aria-hidden="true">
          <circle cx="100" cy="100" r="80" fill="none" stroke="var(--line)" strokeWidth="1" />
          <g data-ticks>
            {Array.from({ length: 48 }, (_, i) => {
              const a = ((i / 48) * 360 - 90) * (Math.PI / 180);
              const r1 = i % 4 === 0 ? 88 : 91;
              return (
                <line
                  key={i}
                  x1={(100 + r1 * Math.cos(a)).toFixed(2)}
                  y1={(100 + r1 * Math.sin(a)).toFixed(2)}
                  x2={(100 + 96 * Math.cos(a)).toFixed(2)}
                  y2={(100 + 96 * Math.sin(a)).toFixed(2)}
                  stroke="var(--mist)"
                  strokeOpacity={i % 4 === 0 ? 0.7 : 0.35}
                  strokeWidth="0.8"
                />
              );
            })}
          </g>
          <path data-ring d={RING} fill="var(--brass)" fillOpacity="0" stroke="var(--brass)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span data-counter className="font-mono text-[34px] leading-none text-foam tnum sm:text-[40px]">
            000
          </span>
          <span data-label className="eyebrow mt-3 text-[10px]">
            sounding
          </span>
        </div>
      </div>
      <div data-mark className="mt-8 flex gap-[0.02em] overflow-hidden font-display text-[2.5rem] leading-none text-foam" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }} aria-hidden="true">
        <span className="inline-block" style={{ opacity: 0 }}>E</span>
        <span className="inline-block" style={{ opacity: 0 }}>b</span>
        <span className="inline-block" style={{ opacity: 0 }}>b</span>
      </div>
      <div data-water className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-brass shadow-[0_0_24px_4px_rgba(201,162,74,0.45)]" aria-hidden="true" />
    </div>
  );
}
