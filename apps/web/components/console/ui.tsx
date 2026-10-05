import type { ReactNode } from "react";
import { IconInfo, IconWarning } from "../site/icons";

export function PageHead({ kicker, title, lede, actions }: { kicker: string; title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
      <div className="min-w-0">
        <p className="eyebrow">{kicker}</p>
        <h1 className="mt-2 font-display text-[2.125rem] leading-tight text-foam" style={{ fontVariationSettings: '"opsz" 96' }}>
          {title}
        </h1>
        {lede ? <p className="mt-2 max-w-2xl text-[15px] text-mist">{lede}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({ title, aside, children, className = "", pad = true }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`neatline ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="eyebrow">{title}</h2>
          {aside}
        </div>
      ) : null}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" className="text-mist">
        <circle cx="22" cy="22" r="20" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeDasharray="2 4" />
        <path d="M8 26c3 0 3-3 7-3s4 3 7 3 4-3 7-3 4 3 7 3" fill="none" stroke="var(--brass)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <h3 className="mt-4 font-display text-xl text-foam">{title}</h3>
      {children ? <div className="mt-2 max-w-md text-sm text-mist">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  const cls = tone === "info" ? "border-line text-mist" : tone === "warn" ? "border-brass/60 text-foam" : "border-coral/60 text-foam";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 border px-4 py-3 text-[13.5px] leading-relaxed ${cls}`}>
      {tone === "info" ? <IconInfo size={16} className="mt-0.5 shrink-0 text-mist" /> : <IconWarning size={16} className={`mt-0.5 shrink-0 ${tone === "warn" ? "text-brass-ink" : "text-coral"}`} />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, j) => (
            <div key={j} className="skeleton h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function TierBadge({ tier }: { tier: string | undefined | null }) {
  const t = (tier ?? "").toLowerCase();
  const label = t ? t[0].toUpperCase() + t.slice(1) : "—";
  const cls = t === "abyss" ? "border-brass bg-brass/15 text-brass-ink" : t === "shelf" ? "border-brass/60 text-brass-ink" : t === "reef" ? "border-kelp/60 text-kelp" : "border-line text-mist";
  return <span className={`inline-flex items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] ${cls}`}>{label}</span>;
}

export function Kv({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2 last:border-b-0">
      <dt className="text-[13px] text-mist">{k}</dt>
      <dd className={`min-w-0 truncate text-right text-foam ${mono ? "font-mono text-[12.5px] tnum" : "text-[14px]"}`}>{v}</dd>
    </div>
  );
}
