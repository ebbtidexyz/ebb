import type { ReactNode } from "react";

export function Section({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`relative mx-auto max-w-[1200px] scroll-mt-20 px-4 py-20 sm:px-6 md:py-24 ${className}`}>
      {children}
    </section>
  );
}

/** Roman numeral + kicker, display headline, lede. A brass rule with a chart coordinate. */
export function SectionHead({ id, numeral, kicker, title, lede, coord }: { id: string; numeral: string; kicker: string; title: ReactNode; lede?: ReactNode; coord?: string }) {
  return (
    <header className="mb-12 md:mb-16">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] tracking-[0.14em] text-brass-ink">{numeral}</span>
        <span className="h-px w-8 bg-brass/70" aria-hidden="true" />
        <span className="eyebrow">{kicker}</span>
        <span className="ml-auto hidden h-px flex-1 bg-line sm:block" aria-hidden="true" />
        {coord ? <span className="hidden font-mono text-[10.5px] tracking-[0.08em] text-mist/80 sm:block tnum">{coord}</span> : null}
      </div>
      <h2 id={`${id}-title`} className="mt-6 max-w-3xl font-display text-[2.125rem] leading-[1.08] tracking-[-0.015em] text-foam sm:text-5xl" style={{ fontVariationSettings: '"opsz" 96, "SOFT" 20' }}>
        {title}
      </h2>
      {lede ? <p className="mt-5 max-w-2xl text-[1.0625rem] leading-relaxed text-mist">{lede}</p> : null}
    </header>
  );
}

export function FigCaption({ n, children }: { n: number | string; children: ReactNode }) {
  return (
    <figcaption className="mt-3 flex gap-3 font-mono text-[11px] leading-relaxed text-mist">
      <span className="shrink-0 text-brass-ink">Fig. {n}</span>
      <span>{children}</span>
    </figcaption>
  );
}

export function Stat({ label, value, sub, loading, tone = "foam" }: { label: string; value: ReactNode; sub?: ReactNode; loading?: boolean; tone?: "foam" | "kelp" | "coral" | "brass" }) {
  const toneCls = { foam: "text-foam", kelp: "text-kelp", coral: "text-coral", brass: "text-brass-ink" }[tone];
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className={`mt-2 font-display text-[1.75rem] leading-none tnum ${toneCls} ${loading ? "skeleton inline-block min-w-[6ch]" : ""}`} style={{ fontVariationSettings: '"opsz" 48' }}>
        {value}
      </div>
      {sub ? <div className="mt-2 text-xs text-mist">{sub}</div> : null}
    </div>
  );
}
