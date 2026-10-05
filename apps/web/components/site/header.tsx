"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "./compass";
import { IconArrowRight, IconClose, IconMenu } from "./icons";
import { ThemeToggle } from "./theme";

const sections = [
  { href: "/#current", label: "Current" },
  { href: "/#ebb", label: "Ebb" },
  { href: "/#tide-tables", label: "Tide tables" },
  { href: "/#trench", label: "Trench" },
  { href: "/#depth", label: "Depth" },
  { href: "/#hull", label: "Hull" },
  { href: "/#soundings", label: "Soundings" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-abyss/80 backdrop-blur-md supports-[backdrop-filter]:bg-abyss/70">
      <a href="#main" className="sr-only-focusable absolute left-4 top-3 z-50 bg-brass px-3 py-2 text-sm font-semibold text-on-brass">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="shrink-0 rounded-[2px]" aria-label="Ebb, home">
          <Wordmark />
        </Link>
        <nav aria-label="Sections" className="hidden items-center gap-1 lg:flex">
          {sections.map((s) => (
            <a key={s.href} href={s.href} className="rounded-[2px] px-2.5 py-1.5 text-[13px] text-mist transition-colors hover:text-foam">
              {s.label}
            </a>
          ))}
          <span className="mx-2 h-4 w-px bg-line" aria-hidden="true" />
          <Link href="/docs" className={`rounded-[2px] px-2.5 py-1.5 text-[13px] transition-colors hover:text-foam ${pathname === "/docs" ? "text-foam" : "text-mist"}`}>
            Docs
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/app" className="btn btn-brass btn-sm hidden sm:inline-flex">
            Open console <IconArrowRight size={14} />
          </Link>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[2px] border border-line text-foam lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <IconClose size={16} /> : <IconMenu size={16} />}
          </button>
        </div>
      </div>
      {open ? (
        <nav id="mobile-nav" aria-label="Sections" className="border-t border-line bg-abyss px-4 pb-6 pt-2 lg:hidden">
          <ul className="grid grid-cols-2 gap-x-4">
            {sections.map((s) => (
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
          <Link href="/app" className="btn btn-brass mt-5 w-full">
            Open console <IconArrowRight size={14} />
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
