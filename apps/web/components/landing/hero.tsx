"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { BUY_URL, LAUNCH_AT, LAUNCH_CA } from "@/lib/env";
import { activeChain, explorerAddress } from "@/lib/chains";
import { useStats } from "@/lib/queries";
import { genesisFromStats, tideClock } from "@/lib/tide";
import { useNow } from "@/lib/use-now";
import { pad2, shortHash } from "@/lib/format";
import { gsap, MEDIA, ScrollTrigger, SplitText, useGsap } from "@/lib/gsap";
import { CopyButton } from "../site/copy-button";
import { IconArrowRight, IconBook, IconExternal } from "../site/icons";
import { onLandingReady } from "./bus";
import { Scramble } from "./kit";
import { stage } from "./three/store";

const LINES = [
  { text: "Spend it,", italic: false },
  { text: "or the tide", italic: true },
  { text: "takes it.", italic: true },
];

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const stats = useStats();
  const genesis = genesisFromStats(stats.data);

  useGsap(ref, ({ motion, mobile }) => {
    const root = ref.current!;
    // captured before the pin wraps the section in a spacer
    const next = (root.parentElement?.classList.contains("pin-spacer") ? root.parentElement.nextElementSibling : root.nextElementSibling) as HTMLElement | null;
    const naut = stage.models.nautilus;
    naut.anchor = root.querySelector<HTMLElement>("[data-anchor]");
    const q = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!;
    const lines = Array.from(root.querySelectorAll<HTMLElement>("[data-line]"));
    const rest = Array.from(root.querySelectorAll<HTMLElement>("[data-rest]"));
    const backdrop = document.querySelector<HTMLElement>("[data-hero-backdrop]")!;
    const media = backdrop.querySelector<HTMLElement>("[data-media]")!;
    const inner = backdrop.querySelector<HTMLElement>("[data-media-inner]")!;
    const dark = backdrop.querySelector<HTMLElement>("[data-dark]")!;
    const video = backdrop.querySelector<HTMLVideoElement>("video[data-hero-video]");
    const gauge = q("[data-gauge]"); // scroll layer
    const gaugeIn = q("[data-gauge] > div"); // intro layer
    const eyebrowWrap = q("[data-eyebrow-wrap]");
    const wl = q<SVGPathElement>("[data-waterline]");
    const copy = q("[data-copy]");
    const titleWrap = q("[data-title-wrap]");

    if (!motion) {
      naut.show = 1;
      naut.scale = 1;
      // the fixed sea goes away once the hero has scrolled past
      ScrollTrigger.create({
        trigger: root,
        start: "bottom top",
        onEnter: () => gsap.set(backdrop, { autoAlpha: 0 }),
        onLeaveBack: () => gsap.set(backdrop, { autoAlpha: 1 }),
      });
      return () => {
        naut.anchor = null;
        naut.show = 0;
      };
    }

    // ---- intro, played when the preloader's water line sweeps up
    const splits = lines.map((l) => SplitText.create(l.querySelector<HTMLElement>("[data-chars]")!, { type: "chars", charsClass: "inline-block will-change-transform" }));
    gsap.set(splits.flatMap((s) => s.chars), { yPercent: 118 });
    gsap.set(rest, { y: 34, opacity: 0 });
    gsap.set(gaugeIn, { y: -14, opacity: 0 });
    gsap.set(inner, { scale: 1.08 });
    gsap.set(wl, { drawSVG: "0% 0%" });
    Object.assign(naut, { show: 0, scale: 0.7, ry: -1.6, sink: 0.22 });

    const intro = gsap.timeline({ paused: true, defaults: { ease: "tide" } });
    intro
      .to(inner, { scale: 1, duration: 2.8, ease: "ebb" }, 0)
      .to(naut, { show: 1, duration: 1.4, ease: "power2.out" }, 0.25)
      .to(naut, { scale: 1, ry: 0, sink: 0, duration: 2.6, ease: "ebb" }, 0.25);
    splits.forEach((s, i) => intro.to(s.chars, { yPercent: 0, duration: 1.25, stagger: 0.035 }, 0.2 + i * 0.16));
    intro
      .to(wl, { drawSVG: "0% 100%", duration: 1.6, ease: "ebb" }, 1.05)
      .to(rest, { y: 0, opacity: 1, duration: 1.1, stagger: 0.09 }, 0.75)
      .to(gaugeIn, { y: 0, opacity: 1, duration: 1 }, 1.0);
    const offReady = onLandingReady(() => intro.play());

    // ---- scroll out: the shell turns and sinks, the sea darkens, lines drift at different speeds
    const out = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: { trigger: root, start: "top top", end: mobile ? "+=70%" : "+=115%", pin: true, scrub: true },
    });
    out
      .to(naut, { ry2: Math.PI, duration: 1 }, 0)
      .to(naut, { scale2: 0.42, sink2: mobile ? 0.5 : 0.85, duration: 1, ease: "power1.in" }, 0)
      .to(naut, { show2: 0, duration: 0.25 }, 0.75)
      .to(dark, { opacity: 0.8, duration: 1 }, 0)
      .to(media, { scale: 1.14, duration: 1 }, 0)
      // the lines fan apart, top line fastest
      .to(eyebrowWrap, { y: -120, opacity: 0, duration: 0.5 }, 0)
      .to(lines[0], { yPercent: -150, duration: 1 }, 0)
      .to(lines[1], { yPercent: -85, duration: 1 }, 0)
      .to(lines[2], { yPercent: -35, duration: 1 }, 0)
      .to(titleWrap, { opacity: 0.18, duration: 0.5 }, 0.5)
      .to(copy, { y: 60, opacity: 0, duration: 0.45 }, 0.05)
      .to(gauge, { y: -60, opacity: 0, duration: 0.5 }, 0.1);

    // after the pin, the fixed sea leaves with the hero
    gsap.to(backdrop, {
      yPercent: -100,
      ease: "none",
      scrollTrigger: {
        trigger: next ?? root,
        start: "top bottom",
        end: "top top",
        scrub: true,
        // no decoding a sea nobody can see
        onLeave: () => {
          if (!video) return;
          video.dataset.away = "1";
          video.pause();
        },
        onEnterBack: () => {
          if (!video) return;
          delete video.dataset.away;
          video.play().catch(() => {});
        },
      },
    });

    // ---- pointer parallax on the shell
    let offMove: (() => void) | undefined;
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const pxTo = gsap.quickTo(naut, "px", { duration: 1.4, ease: "power3" });
      const pyTo = gsap.quickTo(naut, "py", { duration: 1.4, ease: "power3" });
      const onMove = (e: PointerEvent) => {
        pxTo((e.clientX / window.innerWidth - 0.5) * 0.7);
        pyTo((e.clientY / window.innerHeight - 0.5) * 0.4);
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      offMove = () => window.removeEventListener("pointermove", onMove);
    }

    return () => {
      offReady();
      offMove?.();
      naut.anchor = null;
    };
  });

  return (
    <section ref={ref} id="top" aria-labelledby="hero-title" className="night relative h-[100svh] min-h-[640px] w-full overflow-hidden">
      {/* the nautilus is drawn by the fixed WebGL stage onto this box */}
      <div
        data-anchor
        aria-hidden="true"
        className="pointer-events-none absolute right-[-10vw] top-[9%] aspect-square w-[50vw] max-w-[240px] md:right-[3vw] md:top-[56%] md:w-[min(34vw,56vh)] lg:right-[3vw] lg:top-[44%] lg:w-[min(33vw,54vh)] md:max-w-none md:-translate-y-[50%] md:translate-x-0"
      />

      <HeroGauge genesis={genesis} />

      <div className="relative mx-auto flex h-full max-w-[1240px] flex-col justify-end px-4 pb-[8svh] pt-24 sm:px-6 lg:px-10">
        <div data-eyebrow-wrap>
        <p data-rest className="eyebrow flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{activeChain.name}</span>
          <span aria-hidden="true" className="text-line">
            /
          </span>
          <span className="text-brass-ink">$EBB</span>
          <span aria-hidden="true" className="hidden text-line sm:inline">
            /
          </span>
          <span className="hidden sm:inline">AI credit every 30 min</span>
        </p>
        </div>
        <div data-title-wrap>
          <h1
            id="hero-title"
            aria-label="Spend it, or the tide takes it."
            className="mt-5 font-display text-[clamp(3.3rem,9.4vw,9.4rem)] leading-[0.92] tracking-[-0.035em] text-foam [text-shadow:0_2px_40px_rgba(7,19,31,0.55)]"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }}
          >
            {LINES.map((l, i) => (
              <span key={l.text} data-line className={`relative block overflow-hidden pb-[0.1em] pr-[0.08em] ${i === 0 ? "" : "-mt-[0.1em]"}`} aria-hidden="true">
                <span data-chars className={`block whitespace-nowrap ${l.italic ? "italic font-light" : ""} ${i === 2 ? "relative w-max" : ""}`}>
                  {l.text}
                </span>
                {i === 2 ? (
                  <svg aria-hidden="true" viewBox="0 0 300 14" preserveAspectRatio="none" className="absolute bottom-[0.06em] left-0 h-[0.12em] w-[4.15em] overflow-visible">
                    <path data-waterline d="M2 9 C 40 2, 70 13, 110 7 S 190 2, 230 8 S 280 10, 298 5" fill="none" stroke="var(--brass)" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : null}
              </span>
            ))}
          </h1>
        </div>
        <div data-copy className="mt-6 grid gap-6 md:mt-8 lg:grid-cols-[minmax(0,32rem)_auto] lg:items-end lg:gap-10">
          <p data-rest className="max-w-[32rem] text-[1.0625rem] leading-relaxed text-mist md:text-lg">
            Hold $EBB and the fees from every trade pay for your AI, landing as a fresh tidepool of credit every thirty minutes. Credit you leave on the shore for seven days is drawn into{" "}
            <span className="text-foam">the Trench</span>: it buys $EBB back and burns it.
          </p>
          <div data-rest className="flex flex-col gap-4">
            <LaunchChip />
            <div className="flex flex-wrap gap-3">
              <a href={BUY_URL} target="_blank" rel="noreferrer noopener" data-magnetic className="btn btn-brass h-12 px-5">
                Buy $EBB on Pons <IconExternal size={14} />
              </a>
              <Link href="/app" data-magnetic className="btn btn-ghost h-12 bg-abyss/60 px-5 backdrop-blur-md">
                Open console <IconArrowRight size={15} />
              </Link>
              <Link href="/docs" className="btn btn-ghost hidden h-12 bg-abyss/60 px-4 backdrop-blur-md sm:inline-flex">
                <IconBook size={15} /> Docs
              </Link>
            </div>
            <ContractBox />
          </div>
        </div>
      </div>

      <div data-rest className="pointer-events-none absolute bottom-6 right-6 hidden flex-col items-center gap-2 xl:flex" aria-hidden="true">
        <span className="eyebrow text-[10px]">scroll</span>
        <span className="relative block h-10 w-px overflow-hidden bg-line">
          <span className="absolute inset-x-0 top-0 h-1/2 bg-brass motion-safe:[animation:scroll-cue_2.2s_ease-in-out_infinite]" />
        </span>
      </div>
    </section>
  );
}

/** The sea behind the hero. Fixed and outside the smooth wrapper so the WebGL
 *  stage (also fixed) can sit between it and the page text. */
export function HeroBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  // the video only loads when motion is welcome
  useEffect(() => {
    const v = ref.current?.querySelector<HTMLVideoElement>("video[data-hero-video]");
    if (!v || window.matchMedia(MEDIA.reduce).matches) return;
    v.src = v.canPlayType('video/webm; codecs="vp9"') ? "/media/sea-loop.webm" : "/media/sea-loop.mp4";
    v.play().catch(() => {});
    const onVis = () => (document.hidden || v.dataset.away ? v.pause() : v.play().catch(() => {}));
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div ref={ref} data-hero-backdrop aria-hidden="true" className="night pointer-events-none fixed inset-0 z-0 overflow-hidden bg-abyss">
      <div data-media className="absolute inset-0 will-change-transform">
        <div data-media-inner className="absolute inset-0">
          <Image src="/media/sea-poster.jpg" alt="" fill preload sizes="100vw" className="object-cover object-[50%_40%]" />
          <video
            data-hero-video
            muted
            loop
            playsInline
            preload="metadata"
            poster="/media/sea-poster.jpg"
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover object-[50%_40%] motion-reduce:hidden"
          />
          <Image src="/media/hero-moon.jpg" alt="" fill sizes="100vw" className="hidden object-cover motion-reduce:block" />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_15%_85%,rgba(7,19,31,0.88),rgba(7,19,31,0.35)_55%,transparent_80%)]" />
        <div className="absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-abyss via-abyss/60 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-abyss/70 to-transparent" />
        <div data-dark className="absolute inset-0 bg-[#02070d] opacity-0" />
      </div>

    </div>
  );
}

function ContractBox() {
  const ca = LAUNCH_CA;
  return (
    <div className="flex w-full max-w-[34rem] items-center gap-3 rounded-[2px] border border-line/80 bg-abyss/55 px-3 py-2 backdrop-blur-md">
      <span className="eyebrow shrink-0 text-[10px] text-brass-ink">CA</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-foam">
        {ca ? (
          <>
            <span className="hidden lg:inline">{ca}</span>
            <span className="lg:hidden">{shortHash(ca, 8, 6)}</span>
          </>
        ) : (
          <span className="tracking-[0.3em] text-brass-ink">SOON</span>
        )}
      </code>
      {ca ? (
        <>
          <CopyButton value={ca} compact />
          <a href={explorerAddress(ca)} target="_blank" rel="noreferrer noopener" className="inline-flex shrink-0 items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-mist hover:text-foam" aria-label="View the token on the explorer">
            <span className="hidden sm:inline">Explorer</span> <IconExternal size={12} />
          </a>
        </>
      ) : (
        <span title="The contract address is published here at launch" className="inline-flex shrink-0 cursor-not-allowed items-center rounded-[2px] border border-line/70 px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-mist/60">
          Copy
        </span>
      )}
    </div>
  );
}

/** Countdown to the fair launch on Pons; disappears once it has passed. */
function LaunchChip() {
  const now = useNow();
  if (!Number.isFinite(LAUNCH_AT) || (now !== null && now >= LAUNCH_AT)) return null;
  const left = now === null ? null : Math.max(0, LAUNCH_AT - now);
  const d = left === null ? "--" : String(Math.floor(left / 86_400_000));
  const h = left === null ? "--" : pad2(Math.floor(left / 3_600_000) % 24);
  const m = left === null ? "--" : pad2(Math.floor(left / 60_000) % 60);
  const sec = left === null ? "--" : pad2(Math.floor(left / 1000) % 60);
  const when = new Date(LAUNCH_AT);
  const label = `${when.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} · ${pad2(when.getUTCHours())}:${pad2(when.getUTCMinutes())} UTC`;
  return (
    <div className="flex w-full max-w-[34rem] items-center gap-3 rounded-[2px] border border-brass/40 bg-abyss/55 px-3 py-2 backdrop-blur-md sm:w-max">
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-brass motion-safe:animate-ping opacity-60" />
        <span className="relative h-2 w-2 rounded-full bg-brass" />
      </span>
      <span className="eyebrow whitespace-nowrap text-[10px] text-brass-ink">
        <span className="hidden sm:inline">Fair launch on Pons</span>
        <span className="sm:hidden">Launch</span>
      </span>
      <span className="hidden whitespace-nowrap font-mono text-[11px] text-mist sm:inline">{label}</span>
      <span className="ml-auto whitespace-nowrap font-mono text-[13px] text-foam tnum sm:ml-0" aria-label="Time until launch">
        {d}d {h}:{m}:{sec}
      </span>
    </div>
  );
}

/** Top-right live tide gauge: UTC clock, tide number and the next flood, digits scrambling as they tick. */
function HeroGauge({ genesis }: { genesis: number | null }) {
  const now = useNow();
  const c = now === null ? null : tideClock(now, genesis);
  const d = now === null ? null : new Date(now);
  const hh = d ? pad2(d.getUTCHours()) : "--";
  const mm = d ? pad2(d.getUTCMinutes()) : "--";
  const ss = d ? pad2(d.getUTCSeconds()) : "--";
  const left = c ? Math.floor(c.left) : null;
  const lm = left !== null ? pad2(Math.floor(left / 60)) : "--";
  const ls = left !== null ? pad2(left % 60) : "--";
  // before genesis the first tide is the one coming in
  const tide = c?.tide != null ? `#${c.tide.toLocaleString("en-US")}` : genesis !== null ? "#0" : "#—";
  const frac = c?.frac ?? 0;
  const R = 15;
  const C = 2 * Math.PI * R;
  const digits = "0123456789";

  return (
    <div data-gauge className="absolute right-4 top-[4.75rem] z-10 hidden sm:right-6 sm:block lg:right-10">
      <div className="flex items-center gap-4 rounded-[2px] border border-line/70 bg-abyss/45 px-3.5 py-2.5 backdrop-blur-md sm:gap-5 sm:px-4">
        <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true" className="hidden shrink-0 sm:block">
          <circle cx="19" cy="19" r={R} fill="none" stroke="var(--line)" strokeWidth="1.5" />
          <circle cx="19" cy="19" r={R} fill="none" stroke="var(--brass)" strokeWidth="1.5" strokeDasharray={`${(C * frac).toFixed(2)} ${C.toFixed(2)}`} transform="rotate(-90 19 19)" strokeLinecap="round" />
          <circle cx="19" cy="19" r="2" fill="var(--brass)" />
        </svg>
        <dl className="grid grid-cols-3 gap-4 font-mono sm:gap-5">
          <div>
            <dt className="text-[9.5px] uppercase tracking-[0.14em] text-mist">UTC</dt>
            <dd className="mt-1 text-[13px] text-foam tnum">
              <Scramble text={hh} chars={digits} duration={0.3} />:<Scramble text={mm} chars={digits} duration={0.3} />
              <span className="hidden sm:inline">
                :<Scramble text={ss} chars={digits} duration={0.25} />
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[9.5px] uppercase tracking-[0.14em] text-mist">Tide</dt>
            <dd className="mt-1 text-[13px] text-foam tnum">
              <Scramble text={tide} chars={digits} />
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.14em] text-mist">
              <span className="live-dot" aria-hidden="true" /> Flood
            </dt>
            <dd className="mt-1 text-[13px] text-brass-ink tnum">
              <Scramble text={lm} chars={digits} duration={0.3} />:<Scramble text={ls} chars={digits} duration={0.25} />
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
