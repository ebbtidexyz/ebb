"use client";

import type { SoundingsResponse } from "@ebb/shared";
import { useSoundings } from "@/lib/queries";
import { explorerAddress } from "@/lib/chains";
import { int, shortHash, toNum, usd } from "@/lib/format";
import { errorText } from "@/lib/api";
import { IconCheck, IconExternal, IconWarning } from "../site/icons";

/** /api/soundings as the API returns it today: the full reserve equation
 *  vault_usdg = open_credits + unsettled_used + ungranted + awaiting_burn + difference */
export interface SoundingsFull extends SoundingsResponse {
  expected?: string | null;
  ungranted?: string | null;
  awaiting_burn?: string | null;
  equation?: string;
}

export interface SoundingTerm {
  key: string;
  label: string;
  note: string;
  value: string;
}

/** The right-hand side of the equation, in the API's order. Terms the API does not send are left out. */
export function soundingTerms(d: SoundingsFull): SoundingTerm[] {
  const all: (SoundingTerm & { raw: string | null | undefined })[] = [
    { key: "open_credits", label: "Open credits", note: "every unexpired tidepool", raw: d.open_credits, value: "" },
    { key: "unsettled_used", label: "Used, not yet settled", note: "paid at the next settlement", raw: d.unsettled_used, value: "" },
    { key: "ungranted", label: "Booked, not yet granted", note: "in a tide that has not flooded", raw: d.ungranted, value: "" },
    { key: "awaiting_burn", label: "Awaiting the Trench", note: "expired, queued for burnExpired", raw: d.awaiting_burn, value: "" },
  ];
  return all.filter((t) => t.raw !== undefined && t.raw !== null).map(({ raw, ...t }) => ({ ...t, value: usd(raw) }));
}

/** The API's own difference (it sees every term); null when the vault could not be read. */
export function soundingDifference(d: SoundingsFull | undefined): { diff: number | null; balanced: boolean } {
  const diff = d && d.vault_usdg !== null && d.difference != null ? toNum(d.difference) : null;
  return { diff, balanced: diff !== null && Math.abs(diff) < 0.000001 };
}

/** The live reserve equation for the console: every term the API reports, and its difference. */
export function SoundingsEquation({ fixture = false }: { fixture?: boolean }) {
  const q = useSoundings({ fixture });
  const d = q.data as SoundingsFull | undefined;
  const { diff, balanced } = soundingDifference(d);
  const loading = q.isLoading;
  const terms = d ? soundingTerms(d) : [];

  return (
    <div>
      <div className="neatline p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="eyebrow flex items-center gap-2">
            {d && !q.fixture ? <span className="live-dot" aria-hidden="true" /> : null}
            Soundings · read {d?.block ? `at block ${int(d.block)}` : "live"}
          </span>
          <span className="flex items-center gap-2 font-mono text-[11px]">
            {q.fixture ? <span className="text-coral">dev fixture</span> : null}
            {d?.sandbox && !q.fixture ? <span className="rounded-[2px] border border-brass/60 px-1.5 py-0.5 text-brass-ink">SANDBOX · simulated chain</span> : null}
          </span>
        </div>

        <div className="mt-8 grid items-center gap-6 lg:grid-cols-[auto_auto_1fr] lg:gap-8">
          <Term label="USDG in the Basin" note="balanceOf(vault), on-chain" value={d ? (d.vault_usdg !== null ? usd(d.vault_usdg) : "not readable") : "—"} loading={loading} accent />
          <Op>=</Op>
          <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2">
            {(terms.length ? terms : [{ key: "open_credits", label: "Open credits", note: "every unexpired tidepool", value: "—" }]).map((t, i) => (
              <Term key={t.key} plus={i > 0} label={t.label} note={t.note} value={t.value} loading={loading} />
            ))}
            {d && diff !== null && !balanced ? <Term plus label="Difference" note="unexplained, shown not hidden" value={usd(diff, { precise: true })} warn /> : null}
          </div>
        </div>

        <div className={`mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-5 ${balanced ? "text-kelp" : diff !== null ? "text-coral" : "text-mist"}`}>
          {balanced ? <IconCheck size={18} /> : diff !== null ? <IconWarning size={18} /> : null}
          <span className="font-mono text-[13px] tnum">difference {diff !== null ? usd(diff, { precise: true }) : "—"}</span>
          <span className="text-[13px] text-mist">
            {q.isError
              ? errorText(q.error)
              : !d
                ? "Reading the chain…"
                : d.vault_usdg === null
                  ? "The Basin address is not configured yet, so the left side cannot be read. It is published at launch."
                  : balanced
                    ? "Balanced: every dollar in the contract is an open credit, a used credit awaiting settlement, booked credit not yet granted, or expired credit queued for the Trench."
                    : diff !== null && diff > 0
                      ? "More USDG in the Basin than the books account for. The API reports the gap as it is; it is shown rather than hidden."
                      : "The books exceed the Basin balance. This should never happen; the gap is shown rather than hidden."}
          </span>
        </div>
        {d?.equation ? <p className="mt-3 font-mono text-[11px] text-mist/80">{d.equation}</p> : null}
      </div>

      {d ? (
        <dl className="mt-6 grid gap-x-8 gap-y-2 font-mono text-[12px] sm:grid-cols-2 lg:grid-cols-3">
          {(Object.entries(d.addresses) as [string, string | null][]).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 border-b border-line/60 py-2">
              <dt className="text-mist">{k}</dt>
              <dd className="min-w-0 truncate text-foam">
                {v ? (
                  <a href={explorerAddress(v)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-brass-ink">
                    {shortHash(v, 8, 6)} <IconExternal size={11} />
                  </a>
                ) : (
                  <span className="text-mist">at launch</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function Term({ label, note, value, loading, accent, warn, plus }: { label: string; note: string; value: string; loading?: boolean; accent?: boolean; warn?: boolean; plus?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">
        {plus ? (
          <span aria-hidden="true" className="mr-1.5 font-display text-[15px] text-brass-ink">
            +
          </span>
        ) : null}
        {label}
      </div>
      <div
        className={`mt-2 truncate font-display text-[1.75rem] leading-none tnum sm:text-[2.125rem] ${accent ? "text-brass-ink" : warn ? "text-coral" : "text-foam"} ${loading ? "skeleton inline-block min-w-[6ch]" : ""}`}
        style={{ fontVariationSettings: '"opsz" 96' }}
      >
        {value}
      </div>
      <div className="mt-2 font-mono text-[11px] text-mist">{note}</div>
    </div>
  );
}

function Op({ children }: { children: string }) {
  return (
    <div aria-hidden="true" className="font-display text-3xl text-mist">
      {children}
    </div>
  );
}
