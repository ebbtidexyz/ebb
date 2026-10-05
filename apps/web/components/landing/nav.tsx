"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { gsap, ScrollTrigger, useGsap } from "@/lib/gsap";
import { BUY_URL, TELEGRAM_URL, X_URL } from "@/lib/env";
import { Wordmark } from "../site/compass";
import { IconArrowRight, IconClose, IconExternal, IconMenu } from "../site/icons";
import { ThemeToggle } from "../site/theme";
import { onLandingReady } from "./bus";

const LINKS = [
  { href: "#current", label: "Current" },
  { href: "#ebb", label: "Ebb" },
  { href: "#tide-tables", label: "Tide tables" },
  { href: "#trench", label: "Trench" },
  { href: "#depth", label: "Depth" },
  { href: "#hull", label: "Hull" },
  { href: "#soundings", label: "Soundings" },
];

/** Landing header: transparent over the hero, a frosted bar below it; hides on the way down, returns on the way up. */
export function LandingNav() {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useGsap(ref, ({ motion }) => {
    const el = ref.current!;
    const bar = el.querySelector<HTMLElement>("[data-bar]")!;
    if (motion) {
      gsap.set(bar, { yPercent: -100, opacity: 0 });
      const off = onLandingReady(() => gsap.to(bar, { yPercent: 0, opacity: 1, duration: 1.1, delay: 0.6, ease: "tide" }));
      let hidden = false;
      ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate(self) {
          const y = self.scroll();
          const hide = self.direction === 1 && y > window.innerHeight * 0.9;
          if (hide !== hidden) {
            hidden = hide;
            gsap.to(bar, { yPercent: hide ? -100 : 0, duration: 0.5, ease: hide ? "power2.in" : "tide", overwrite: "auto" });
          }
        },
      });
      ScrollTrigger.create({
        start: () => window.innerHeight * 0.6,
        end: "max",
        toggleClass: { targets: el, className: "is-solid" },
      });
      return off;
    }
    ScrollTrigger.create({ start: () => window.innerHeight * 0.6, end: "max", toggleClass: { targets: el, className: "is-solid" } });
  });

  return (
    <header ref={ref} className="landing-nav group/nav fixed inset-x-0 top-0 z-40">
      <a href="#main" className="sr-only-focusable absolute left-4 top-3 z-50 bg-brass px-3 py-2 text-sm font-semibold text-on-brass">
        Skip to content
      </a>
      <div data-bar className="border-b border-transparent transition-[background-color,border-color] duration-500 group-[.is-solid]/nav:border-line group-[.is-solid]/nav:bg-abyss/75 group-[.is-solid]/nav:backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
          <Link href="/" className="shrink-0 rounded-[2px]" aria-label="Ebb, home">
            <Wordmark />
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-0.5 lg:flex">
            {LINKS.map((s) => (
              <a key={s.href} href={s.href} className="rounded-[2px] px-2.5 py-1.5 text-[13px] text-mist transition-colors hover:text-foam">
                {s.label}
              </a>
            ))}
            <span className="mx-2 h-4 w-px bg-line" aria-hidden="true" />
            <Link href="/docs" className="rounded-[2px] px-2.5 py-1.5 text-[13px] text-mist transition-colors hover:text-foam">
              Docs
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <a href={X_URL} target="_blank" rel="noreferrer noopener" aria-label="Ebb on X" className="hidden h-9 w-9 items-center justify-center rounded-[2px] border border-line text-mist transition-colors hover:text-foam md:inline-flex">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.2h1.7L7.4 4.74H5.58l11.09 14.46Z"/></svg>
            </a>
            <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" aria-label="Ebb on Telegram" className="hidden h-9 w-9 items-center justify-center rounded-[2px] border border-line text-mist transition-colors hover:text-foam md:inline-flex">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M21.94 4.6 18.9 19.02c-.23 1.02-.83 1.27-1.69.79l-4.66-3.44-2.25 2.17c-.25.25-.46.46-.94.46l.34-4.74 8.62-7.79c.37-.33-.08-.52-.58-.18L7.1 12.98l-4.59-1.44c-1-.31-1.02-1 .21-1.48L20.66 3.1c.83-.31 1.56.19 1.28 1.5Z"/></svg>
            </a>
            <ThemeToggle />
            <Link href="/app" className="btn btn-ghost btn-sm hidden lg:inline-flex">
              Console
            </Link>
            <a href={BUY_URL} target="_blank" rel="noreferrer noopener" data-magnetic className="btn btn-brass btn-sm hidden sm:inline-flex">
              Buy $EBB <IconExternal size={13} />
            </a>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[2px] border border-line text-foam lg:hidden"
              aria-expanded={open}
              aria-controls="landing-mobile-nav"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <IconClose size={16} /> : <IconMenu size={16} />}
            </button>
          </div>
        </div>
        {open ? (
          <nav id="landing-mobile-nav" aria-label="Sections" className="border-t border-line bg-abyss px-4 pb-6 pt-2 lg:hidden">
            <ul className="grid grid-cols-2 gap-x-4">
              {LINKS.map((s) => (
                <li key={s.href}>
                  <a href={s.href} onClick={() => setOpen(false)} className="block border-b border-line/60 py-3 text-[15px] text-foam">
                    {s.label}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/docs" className="block border-b border-line/60 py-3 text-[15px] text-foam">
                  Docs
                </Link>
              </li>
            </ul>
            <a href={BUY_URL} target="_blank" rel="noreferrer noopener" className="btn btn-brass mt-5 w-full">
              Buy $EBB on Pons <IconExternal size={13} />
            </a>
            <Link href="/app" className="btn btn-ghost mt-3 w-full">
              Open console <IconArrowRight size={14} />
            </Link>
            <div className="mt-4 flex gap-3">
              <a href={X_URL} target="_blank" rel="noreferrer noopener" className="btn btn-ghost flex-1">X</a>
              <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" className="btn btn-ghost flex-1">Telegram</a>
            </div>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
