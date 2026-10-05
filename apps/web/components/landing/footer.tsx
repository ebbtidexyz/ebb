"use client";

import Link from "next/link";
import { useRef } from "react";
import { BUY_URL, GITHUB_URL, TELEGRAM_URL, X_URL } from "@/lib/env";
import { gsap, useGsap } from "@/lib/gsap";
import { Wordmark } from "../site/compass";

const COLS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: "Chart",
    links: [
      { href: "#current", label: "Current" },
      { href: "#tide-tables", label: "Tide tables" },
      { href: "#trench", label: "The Trench" },
      { href: "#bulkheads", label: "Bulkheads" },
      { href: "#course", label: "Charted course" },
    ],
  },
  {
    title: "Product",
    links: [
      { href: "/app", label: "Console" },
      { href: "/app/logbook", label: "Logbook" },
      { href: "/app/soundings", label: "Soundings" },
      { href: "/app/depth", label: "Depth wall" },
      { href: "/docs", label: "Docs" },
    ],
  },
  {
    title: "Signals",
    links: [
      { href: X_URL, label: "X · @ebbtidexyz", external: true },
      { href: TELEGRAM_URL, label: "Telegram", external: true },
      { href: BUY_URL, label: "Buy on Pons", external: true },
      ...(GITHUB_URL ? [{ href: GITHUB_URL, label: "GitHub · source", external: true }] : []),
      { href: "/docs#api", label: "API reference" },
      { href: "/docs#security", label: "Security model" },
    ],
  },
];

/** Footer: links, the disclaimer, and a giant moonlit EBB riding a slow swell. */
export function LandingFooter() {
  const ref = useRef<HTMLElement>(null);

  useGsap(ref, ({ motion }) => {
    const root = ref.current!;
    if (!motion) return;
    const chars = root.querySelectorAll<HTMLElement>(".moon-char");
    // chars on a sine wave, from the centre out, very slow
    gsap.fromTo(chars, { yPercent: 6 }, { yPercent: -6, duration: 3.6, ease: "sine.inOut", repeat: -1, yoyo: true, stagger: { each: 0.6, from: "center" } });
    gsap.fromTo(root.querySelectorAll(".moon-char"), { backgroundPositionY: "20%" }, { backgroundPositionY: "80%", ease: "none", scrollTrigger: { trigger: root, start: "top bottom", end: "bottom bottom", scrub: true } });
    gsap.from(root.querySelector("[data-word]"), { yPercent: 40, opacity: 0, duration: 1.6, ease: "ebb", scrollTrigger: { trigger: root, start: "top 85%", once: true } });
    gsap.from(root.querySelectorAll("[data-col]"), { y: 24, opacity: 0, duration: 0.9, stagger: 0.08, ease: "tide", scrollTrigger: { trigger: root, start: "top 85%", once: true } });
  });

  return (
    <footer ref={ref} className="night relative overflow-hidden border-t border-line bg-abyss">
      <div className="mx-auto grid max-w-[1240px] grid-cols-2 gap-x-6 gap-y-12 px-4 pb-10 pt-20 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr_1fr] lg:px-10">
        <div data-col className="col-span-2 md:col-span-1">
          <Wordmark />
          <p className="mt-4 max-w-xs font-display text-lg italic text-foam/90">Spend it, or the tide takes it.</p>
          <p className="mt-3 max-w-xs text-sm text-mist">AI credit from trading fees, every thirty minutes. What you leave for seven days burns $EBB.</p>
        </div>
        {COLS.map((c) => (
          <div key={c.title} data-col>
            <h2 className="eyebrow">{c.title}</h2>
            <ul className="mt-4 space-y-2.5">
              {c.links.map((l) => (
                <li key={l.label}>
                  {l.external ? (
                    <a href={l.href} target="_blank" rel="noreferrer noopener" className="text-sm text-foam/90 transition-colors hover:text-brass-ink">
                      {l.label} <span aria-hidden="true">↗</span>
                    </a>
                  ) : l.href.startsWith("#") ? (
                    <a href={l.href} className="text-sm text-foam/90 transition-colors hover:text-brass-ink">
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className="text-sm text-foam/90 transition-colors hover:text-brass-ink">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div aria-hidden="true" className="relative select-none px-2">
        <div data-word className="flex justify-center font-display leading-[0.78] tracking-[-0.06em]" style={{ fontSize: "clamp(9rem, 38vw, 34rem)", fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
          {["E", "B", "B"].map((c, i) => (
            <span key={i} className="moon-char" style={{ backgroundPositionX: `${i * 50}%`, backgroundPositionY: "50%" }}>
              {c}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-abyss to-transparent" />
      </div>

      <div className="border-t border-line">
        <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-10">
          <p className="max-w-4xl text-xs leading-relaxed text-mist">
            <strong className="font-semibold text-foam">Not an investment. Credits are not cash.</strong> Ebb credits are a grant of access to AI model usage. They are not transferable, not redeemable for money or any digital asset, and never a fixed or promised amount: they follow real trading volume. $EBB is a utility token and confers no ownership, profit share or claim on anyone. Burns are a protocol mechanism, not a payment to holders. Smart contracts can fail, model providers can change price or access, and digital assets are volatile. Nothing here is financial, legal or tax advice.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-mist">
            <span>© 2026 Ebb · Robinhood Chain</span>
            <span className="tnum">Chart datum: UTC · tides on :00 and :30</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
