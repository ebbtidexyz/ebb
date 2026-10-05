import Link from "next/link";
import { BUY_URL, GITHUB_URL, TELEGRAM_URL, X_URL } from "@/lib/env";
import { Wordmark } from "./compass";

export function SiteFooter() {
  return (
    <footer className="relative mt-24 border-t border-line">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-14 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs font-display text-lg italic text-foam/90">Spend it, or the tide takes it.</p>
          <p className="mt-3 max-w-xs text-sm text-mist">AI credit from trading fees, every thirty minutes. What you leave for seven days burns $EBB.</p>
        </div>
        <FooterCol
          title="Chart"
          links={[
            { href: "/#current", label: "Current" },
            { href: "/#tide-tables", label: "Tide tables" },
            { href: "/#trench", label: "The Trench" },
            { href: "/#bulkheads", label: "Bulkheads" },
            { href: "/#course", label: "Charted course" },
          ]}
        />
        <FooterCol
          title="Product"
          links={[
            { href: "/app", label: "Console" },
            { href: "/app/logbook", label: "Logbook" },
            { href: "/app/soundings", label: "Soundings" },
            { href: "/app/depth", label: "Depth wall" },
            { href: "/docs", label: "Docs" },
          ]}
        />
        <FooterCol
          title="Signals"
          links={[
            { href: X_URL, label: "X · @ebbtidexyz", external: true },
            { href: TELEGRAM_URL, label: "Telegram", external: true },
            { href: BUY_URL, label: "Buy on Pons", external: true },
            ...(GITHUB_URL ? [{ href: GITHUB_URL, label: "GitHub · source", external: true }] : []),
            { href: "/docs#api", label: "API reference" },
            { href: "/docs#security", label: "Security model" },
          ]}
        />
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
          <p className="max-w-4xl text-xs leading-relaxed text-mist">
            <strong className="font-semibold text-foam">Not an investment. Credits are not cash.</strong> Ebb credits are a grant of access to AI model
            usage. They are not transferable, not redeemable for money or any digital asset, and never a fixed or promised amount: they follow real
            trading volume. $EBB is a utility token and confers no ownership, profit share or claim on anyone. Burns are a protocol mechanism, not a
            payment to holders. Smart contracts can fail, model providers can change price or access, and digital assets are volatile. Nothing here is
            financial, legal or tax advice.
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

function FooterCol({ title, links }: { title: string; links: { href: string; label: string; external?: boolean }[] }) {
  return (
    <div>
      <h2 className="eyebrow">{title}</h2>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            {l.external ? (
              <a href={l.href} target="_blank" rel="noreferrer noopener" className="text-sm text-foam/90 transition-colors hover:text-brass-ink">
                {l.label} <span aria-hidden="true">↗</span>
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
  );
}
