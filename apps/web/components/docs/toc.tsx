"use client";

import { useEffect, useState } from "react";

export interface TocItem {
  id: string;
  label: string;
}

export function Toc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-80px 0px -65% 0px", threshold: 0 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [items]);

  return (
    <>
      {/* mobile: collapsible */}
      <details className="neatline lg:hidden">
        <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[12px] uppercase tracking-[0.12em] text-mist marker:hidden">
          On this page <span aria-hidden="true">▾</span>
        </summary>
        <ol className="grid grid-cols-2 gap-x-4 border-t border-line px-4 py-3">
          {items.map((i, n) => (
            <li key={i.id}>
              <a href={`#${i.id}`} className="block py-1.5 text-[14px] text-foam">
                <span className="mr-2 font-mono text-[11px] text-mist tnum">{String(n + 1).padStart(2, "0")}</span>
                {i.label}
              </a>
            </li>
          ))}
        </ol>
      </details>

      {/* desktop: sticky */}
      <nav aria-label="On this page" className="sticky top-24 hidden max-h-[calc(100dvh-8rem)] overflow-y-auto pr-2 lg:block">
        <div className="eyebrow mb-4">On this page</div>
        <ol className="space-y-0.5 border-l border-line">
          {items.map((i, n) => {
            const on = i.id === active;
            return (
              <li key={i.id}>
                <a
                  href={`#${i.id}`}
                  aria-current={on ? "location" : undefined}
                  className={`-ml-px flex gap-3 border-l py-1.5 pl-4 text-[13.5px] transition-colors ${on ? "border-brass text-foam" : "border-transparent text-mist hover:text-foam"}`}
                >
                  <span className="font-mono text-[11px] leading-5 text-mist/80 tnum">{String(n + 1).padStart(2, "0")}</span>
                  {i.label}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
