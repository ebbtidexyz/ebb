"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { activeChain } from "@/lib/chains";
import { useHealth, useSandbox } from "@/lib/queries";
import { Wordmark } from "../site/compass";
import { ThemeToggle } from "../site/theme";
import { IconBars, IconChat, IconClose, IconGauge, IconKey, IconLayers, IconLogbook, IconMenu, IconSounding } from "../site/icons";
import { WalletChip } from "./session";

const NAV = [
  { href: "/app", label: "Overview", icon: IconGauge },
  { href: "/app/keys", label: "Keys", icon: IconKey },
  { href: "/app/usage", label: "Usage", icon: IconBars },
  { href: "/app/playground", label: "Playground", icon: IconChat },
  { href: "/app/logbook", label: "Logbook", icon: IconLogbook },
  { href: "/app/soundings", label: "Soundings", icon: IconSounding },
  { href: "/app/depth", label: "Depth wall", icon: IconLayers },
];

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const sandbox = useSandbox();
  const health = useHealth();
  useEffect(() => setOpen(false), [path]);

  const nav = (
    <nav aria-label="Console">
      <ul className="space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const on = href === "/app" ? path === "/app" : path?.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-3 border-l-2 px-3 py-2 text-[14px] transition-colors ${on ? "border-brass bg-brass/10 text-foam" : "border-transparent text-mist hover:bg-shelf/40 hover:text-foam"}`}
              >
                <Icon size={16} className={on ? "text-brass-ink" : ""} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <div className="min-h-dvh">
      {sandbox ? (
        <div className="hachure border-b border-brass/40 bg-abyss">
          <p className="mx-auto flex max-w-[1400px] items-center justify-center gap-2 bg-abyss/85 px-4 py-1.5 text-center font-mono text-[11.5px] text-foam">
            <span className="rounded-[2px] bg-brass px-1.5 text-on-brass">SANDBOX</span>
            Simulated chain and holders. Balances, grants and burns here are not real.
          </p>
        </div>
      ) : null}
      <header className="sticky top-0 z-30 border-b border-line bg-abyss/85 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-[2px] border border-line text-foam lg:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="console-nav" aria-label={open ? "Close navigation" : "Open navigation"}>
              {open ? <IconClose size={16} /> : <IconMenu size={16} />}
            </button>
            <Link href="/" aria-label="Ebb, home" className="rounded-[2px]">
              <Wordmark />
            </Link>
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.14em] text-mist sm:inline">Console</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 font-mono text-[11px] text-mist md:flex" title="API status">
              <span className={`h-1.5 w-1.5 rounded-full ${health.isError ? "bg-coral" : health.data ? "bg-kelp" : "bg-line"}`} aria-hidden="true" />
              {health.isError ? "API offline" : health.data ? "API online" : "API …"}
              <span className="mx-1 text-line">·</span>
              {activeChain.name}
            </span>
            <ThemeToggle />
            <WalletChip />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 lg:grid-cols-[220px_1fr]">
        <aside className="hidden border-r border-line lg:block">
          <div className="sticky top-14 p-4 pt-6">{nav}</div>
        </aside>
        {open ? (
          <div id="console-nav" className="border-b border-line bg-abyss p-4 lg:hidden">
            {nav}
          </div>
        ) : null}
        <main id="main" className="min-w-0 px-4 py-8 sm:px-6 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
