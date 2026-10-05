"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { gsap, prefersReduced, SCRAMBLE_CHARS, SplitText, useGsap } from "@/lib/gsap";

/* ------------------------------------------------------------------ section shell */

export function LSection({
  id,
  numeral,
  label,
  children,
  className = "",
  inner = true,
  night = false,
}: {
  id: string;
  numeral: string;
  label: string;
  children: ReactNode;
  className?: string;
  /** wrap children in the 1240px column */
  inner?: boolean;
  /** force the night palette (sections that sit on dark photography) */
  night?: boolean;
}) {
  return (
    <section id={id} data-rail={numeral} data-rail-label={label} aria-labelledby={`${id}-title`} className={`relative ${night ? "night" : ""} ${className}`}>
      {inner ? <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">{children}</div> : children}
    </section>
  );
}

/* ------------------------------------------------------------------ heading */

/** Numeral + kicker (scrambled in), SplitText headline rising from line masks, lede. */
export function LHead({
  id,
  numeral,
  kicker,
  coord,
  title,
  lede,
  className = "",
  size = "lg",
}: {
  id: string;
  numeral: string;
  kicker: string;
  coord?: string;
  title: ReactNode;
  lede?: ReactNode;
  className?: string;
  size?: "lg" | "xl";
}) {
  const ref = useRef<HTMLElement>(null);
  useGsap(ref, ({ motion }) => {
    const root = ref.current!;
    if (!motion) return;
    const h = root.querySelector<HTMLElement>("[data-split]");
    const trigger = { trigger: root, start: "top 82%", once: true };
    if (h) splitRise(h, trigger);
    root.querySelectorAll<HTMLElement>("[data-scramble]").forEach((el, i) => {
      const text = el.textContent ?? "";
      gsap.fromTo(
        el,
        { opacity: 0 },
        { opacity: 1, duration: 0.2, delay: i * 0.12, scrollTrigger: trigger, onStart: () => void gsap.to(el, { scrambleText: { text, chars: SCRAMBLE_CHARS, speed: 0.7 }, duration: 1.1, ease: "none" }) },
      );
    });
    root.querySelectorAll<HTMLElement>("[data-rule]").forEach((el) => gsap.from(el, { scaleX: 0, transformOrigin: "left center", duration: 1.4, ease: "ebb", scrollTrigger: trigger }));
    const l = root.querySelector<HTMLElement>("[data-lede]");
    if (l) gsap.from(l, { y: 28, opacity: 0, duration: 1.2, delay: 0.35, ease: "tide", scrollTrigger: trigger });
  });

  return (
    <header ref={ref} className={`mb-12 md:mb-16 ${className}`}>
      <div className="flex items-center gap-3">
        <span data-scramble className="font-mono text-[11px] tracking-[0.14em] text-brass-ink">
          {numeral}
        </span>
        <span data-rule className="h-px w-8 bg-brass/70" aria-hidden="true" />
        <span data-scramble className="eyebrow">
          {kicker}
        </span>
        <span data-rule className="ml-auto hidden h-px flex-1 bg-line sm:block" aria-hidden="true" />
        {coord ? (
          <span data-scramble className="hidden min-w-0 max-w-[45%] truncate font-mono text-[10.5px] tracking-[0.08em] text-mist/80 tnum sm:block">
            {coord}
          </span>
        ) : null}
      </div>
      <h2
        id={`${id}-title`}
        data-split
        className={`mt-6 max-w-4xl font-display leading-[1.04] tracking-[-0.02em] text-foam ${size === "xl" ? "text-[2.5rem] sm:text-6xl lg:text-[4.5rem]" : "text-[2.25rem] sm:text-5xl lg:text-[3.6rem]"}`}
        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }}
      >
        {title}
      </h2>
      {lede ? (
        <p data-lede className="mt-6 max-w-2xl text-[1.0625rem] leading-relaxed text-mist">
          {lede}
        </p>
      ) : null}
    </header>
  );
}

/** SplitText (lines/words/chars, masked lines) rising in on a trigger. Re-splits on resize/font load. */
export function splitRise(el: HTMLElement, scrollTrigger?: ScrollTrigger.Vars | false, opts: { stagger?: number; delay?: number; duration?: number } = {}) {
  return SplitText.create(el, {
    type: "lines,words,chars",
    mask: "lines",
    autoSplit: true,
    aria: "auto",
    onSplit(self) {
      return gsap.from(self.chars, {
        yPercent: 115,
        rotate: 4,
        duration: opts.duration ?? 1.15,
        delay: opts.delay ?? 0,
        stagger: opts.stagger ?? 0.02,
        ease: "tide",
        scrollTrigger: scrollTrigger || undefined,
      });
    },
  });
}

/* ------------------------------------------------------------------ reveals */

/** Fade/rise every [data-reveal] in a scope when it enters. Call inside useGsap. */
export function revealIn(scope: Element) {
  scope.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
    const d = Number(el.dataset.reveal || 0) || 0;
    gsap.from(el, { y: 36, opacity: 0, duration: 1.1, delay: d, ease: "tide", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
  });
  scope.querySelectorAll<HTMLElement>("[data-stagger]").forEach((el) => {
    gsap.from(el.children, { y: 28, opacity: 0, duration: 0.9, stagger: 0.07, ease: "tide", scrollTrigger: { trigger: el, start: "top 86%", once: true } });
  });
  scope.querySelectorAll<HTMLElement>("[data-parallax]").forEach((el) => {
    const amt = Number(el.dataset.parallax || 12);
    gsap.fromTo(el, { yPercent: -amt }, { yPercent: amt, ease: "none", scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: true } });
  });
}

/* ------------------------------------------------------------------ live figures */

/** A figure that ScrambleTexts to each new value. React never touches the visible node after mount. */
export function Scramble({
  text,
  className = "",
  chars = SCRAMBLE_CHARS,
  duration = 0.7,
  style,
}: {
  text: string;
  className?: string;
  chars?: string;
  duration?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [initial] = useState(text);
  const prev = useRef(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.dataset.final = text; // the value this figure is heading to, for anyone re-scrambling it
    if (prev.current === text) return;
    prev.current = text;
    if (prefersReduced()) {
      el.textContent = text;
      return;
    }
    gsap.to(el, { scrambleText: { text, chars, speed: 0.9 }, duration, ease: "none", overwrite: true });
  }, [text, chars, duration]);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span ref={ref} aria-hidden="true" className={className} style={style}>
        {initial}
      </span>
    </>
  );
}

/** Chart-paper texture behind a section, drifting slower than the page. */
export function ChartBg({ opacity = 0.08, className = "" }: { opacity?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`}>
      <div
        data-parallax="8"
        className="absolute -inset-y-[12%] inset-x-0 bg-cover bg-center mix-blend-luminosity"
        style={{ backgroundImage: "url(/media/chart.jpg)", opacity }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--abyss),transparent_18%,transparent_82%,var(--abyss))]" />
    </div>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`eyebrow ${className}`}>{children}</span>;
}
