"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { useLogbook, useSoundings } from "@/lib/queries";
import { explorerAddress } from "@/lib/chains";
import { int, shortHash, toUnix, usd, utcStamp } from "@/lib/format";
import { gsap, SCRAMBLE_CHARS, useGsap } from "@/lib/gsap";
import { IconCheck, IconExternal, IconWarning } from "../site/icons";
import { LHead, LSection, revealIn, Scramble } from "./kit";
import { soundingDifference, soundingTerms, type SoundingsFull } from "./soundings-equation";

export function Soundings() {
  const ref = useRef<HTMLDivElement>(null);
  const q = useSoundings();
  const d = q.data as SoundingsFull | undefined;
  const terms = d ? soundingTerms(d) : [];
  const { diff, balanced } = soundingDifference(d);
  const log = useLogbook(5);
  const rows = log.data?.slice(0, 5) ?? [];

  useGsap(ref, ({ motion }) => {
    const root = ref.current!;
    if (!motion) return;
    revealIn(root);
    const eq = root.querySelector<HTMLElement>("[data-eq]")!;
    const st = { trigger: eq, start: "top 75%", once: true };
    const tl = gsap.timeline({ scrollTrigger: st, defaults: { ease: "tide" } });
    tl.from(eq, { y: 40, opacity: 0, duration: 1.1 }).fromTo(eq.querySelectorAll("[data-equals] line"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.7, stagger: 0.15, ease: "ebb" }, 0.5);
    const plus = eq.querySelectorAll("[data-plus]");
    if (plus.length) tl.fromTo(plus, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.5, stagger: 0.1 }, 0.8);
    eq.querySelectorAll<HTMLElement>("[data-eq-num] span[aria-hidden]").forEach((el, i) => {
      tl.add(() => {
        const text = el.dataset.final ?? el.textContent ?? "";
        gsap.to(el, { scrambleText: { text, chars: SCRAMBLE_CHARS, speed: 0.8 }, duration: 1.2, ease: "none", overwrite: true });
      }, 0.45 + i * 0.12);
    });
    const logRows = root.querySelectorAll("[data-log-row]");
    if (logRows.length) gsap.from(logRows, { x: 60, opacity: 0, duration: 0.9, stagger: 0.09, ease: "tide", scrollTrigger: { trigger: root.querySelector("[data-log]"), start: "top 80%", once: true } });
  }, [rows.length]);

  return (
    <LSection id="soundings" numeral="X" label="Soundings" className="pb-28 md:pb-40" inner={false}>
      <div ref={ref}>
        {/* the chart table: logbook still with parallax */}
        <div className="night relative h-[70vh] min-h-[460px] overflow-hidden">
          <div data-parallax="10" className="absolute -inset-y-[14%] inset-x-0">
            <Image src="/media/logbook.jpg" alt="A logbook open on a chart table beside a barometer, dividers and a brass watch, lit by an oil lamp" fill sizes="100vw" className="object-cover object-[45%_55%]" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-abyss via-abyss/55 to-abyss/30" />
          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">
            <LHead
              id="soundings"
              numeral="X"
              kicker="Logbook · Soundings"
              coord="vault depth = what the books hold"
              title="Take a sounding. The depth should match the chart."
              lede="Every request to /api/soundings reads the Basin's USDG balance from the chain and sets it against everything the books say is in it. The equation is the whole proof of reserves; nothing is taken on trust."
              className="mb-10 md:mb-14"
            />
          </div>
        </div>

        <div className="mx-auto max-w-[1240px] px-4 sm:px-6 lg:px-10">
          <div data-eq className="neatline relative -mt-4 bg-abyss/85 p-5 backdrop-blur-md sm:p-8 md:p-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 rounded-[2px] border border-kelp/50 bg-kelp/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-kelp">
                <span className="live-dot" aria-hidden="true" /> read on-chain
                <span className="text-foam tnum">{d?.block ? `· block ${int(d.block)}` : ""}</span>
              </span>
              {d?.addresses.vault ? (
                <a href={explorerAddress(d.addresses.vault)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 font-mono text-[11px] text-mist hover:text-foam">
                  EbbVault {shortHash(d.addresses.vault, 6, 4)} <IconExternal size={11} />
                </a>
              ) : null}
            </div>

            <div className="mt-8 grid items-center gap-8 lg:grid-cols-[auto_auto_1fr] lg:gap-10">
              <div data-eq-num className="min-w-0">
                <div className="eyebrow">USDG in the Basin</div>
                <div className="mt-3 font-display text-[3rem] leading-none text-brass-ink tnum sm:text-[4.25rem]" style={{ fontVariationSettings: '"opsz" 144' }}>
                  <Scramble text={d ? (d.vault_usdg !== null ? usd(d.vault_usdg) : "unread") : "—"} />
                </div>
                <div className="mt-2 font-mono text-[11px] text-mist">usdg.balanceOf(vault)</div>
              </div>
              <svg data-equals viewBox="0 0 60 40" className="h-8 w-12 lg:h-10 lg:w-16" aria-hidden="true">
                <line x1="4" y1="13" x2="56" y2="13" stroke="var(--foam)" strokeWidth="3" strokeLinecap="round" />
                <line x1="4" y1="27" x2="56" y2="27" stroke="var(--foam)" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <div className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
                {(terms.length ? terms : [{ key: "open", label: "Open credits", note: "every unexpired tidepool", value: "—" }]).map((t, i) => (
                  <div key={t.key} data-eq-num className="relative min-w-0 border-l border-line pl-4">
                    <div className="eyebrow truncate">
                      {i > 0 ? (
                        <span data-plus aria-hidden="true" className="mr-1.5 inline-block font-display text-[15px] leading-none text-brass-ink">
                          +
                        </span>
                      ) : null}
                      {t.label}
                    </div>
                    <div className="mt-2 font-display text-[1.75rem] leading-none text-foam tnum" style={{ fontVariationSettings: '"opsz" 72' }}>
                      <Scramble text={t.value} />
                    </div>
                    <div className="mt-1.5 truncate font-mono text-[10.5px] text-mist">{t.note}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-5 ${balanced ? "text-kelp" : diff !== null ? "text-coral" : "text-mist"}`}>
              {balanced ? <IconCheck size={18} /> : diff !== null ? <IconWarning size={18} /> : null}
              <span className="font-mono text-[13px] tnum">difference {diff !== null ? usd(diff, { precise: true }) : "—"}</span>
              <span className="text-[13px] text-mist">
                {q.isError
                  ? "The API is not answering; the sounding fills in when it is back."
                  : !d
                    ? "Reading the chain…"
                    : d.vault_usdg === null
                      ? "The Basin address is not configured yet, so the left side cannot be read."
                      : balanced
                        ? "Balanced to the micro-dollar, as reported by the API from every term."
                        : "Not balanced. The gap is reported by the API and shown here, never hidden."}
              </span>
            </div>
          </div>

          <div data-log className="mt-16 grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div data-reveal>
              <h3 className="font-display text-3xl text-foam">The Logbook</h3>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-mist">
                Every tide prints a row: what was booked, granted, spent and burned, with the grant root and its transaction. The same figures live in the console under{" "}
                <Link href="/app/logbook" className="link">
                  Logbook
                </Link>{" "}
                and{" "}
                <Link href="/app/soundings" className="link">
                  Soundings
                </Link>
                .
              </p>
            </div>
            <div className="min-w-0">
              <div className="hidden grid-cols-[4.5rem_1fr_6rem_6rem_6rem] gap-3 border-b border-line pb-2 sm:grid">
                {["tide", "opened", "booked", "granted", "used"].map((h) => (
                  <span key={h} className={`eyebrow ${h === "tide" || h === "opened" ? "" : "text-right"}`}>
                    {h}
                  </span>
                ))}
              </div>
              {rows.length ? (
                <ol>
                  {rows.map((e) => (
                    <li key={e.tide} data-log-row className="grid grid-cols-[4.5rem_1fr_auto] gap-3 border-b border-line/60 py-3 font-mono text-[12.5px] sm:grid-cols-[4.5rem_1fr_6rem_6rem_6rem]">
                      <span className="text-brass-ink tnum">#{int(e.tide)}</span>
                      <span className="truncate text-mist">
                        {utcStamp(toUnix(e.starts_at))} · <span className={e.status === "open" ? "text-kelp" : "text-foam"}>{e.status}</span>
                      </span>
                      <span className="text-right text-foam tnum">{usd(e.booked)}</span>
                      <span className="hidden text-right text-foam tnum sm:block">{usd(e.granted)}</span>
                      <span className="hidden text-right text-kelp tnum sm:block">{usd(e.used)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p data-log-row className="border-b border-line/60 py-5 font-mono text-[12.5px] text-mist">
                  {log.isLoading ? "Reading the Logbook…" : log.isError ? "The Logbook is offline right now." : "No tide has closed yet. The first entry prints 30 minutes after genesis."}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </LSection>
  );
}
