"use client";

import Link from "next/link";
import { BUY_URL, LAUNCH_AT, TELEGRAM_URL, X_URL } from "@/lib/env";
import { pad2 } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { Wordmark } from "../site/compass";
import { IconArrowRight, IconBook, IconExternal } from "../site/icons";

/** Shown instead of the console until the token and the Basin exist on mainnet. */
export function ConsolePrelaunch() {
  const now = useNow();
  const left = now === null ? null : Math.max(0, LAUNCH_AT - now);
  const d = left === null ? "--" : String(Math.floor(left / 86_400_000));
  const h = left === null ? "--" : pad2(Math.floor(left / 3_600_000) % 24);
  const m = left === null ? "--" : pad2(Math.floor(left / 60_000) % 60);
  const s = left === null ? "--" : pad2(Math.floor(left / 1000) % 60);
  const live = left === 0;
  const when = new Date(LAUNCH_AT);

  return (
    <main id="main" className="relative grid min-h-dvh place-items-center px-4 py-16">
      <div className="w-full max-w-xl text-center">
        <Link href="/" className="inline-flex" aria-label="Ebb, home">
          <Wordmark />
        </Link>
        <p className="eyebrow mt-10 text-brass-ink">The console</p>
        <h1 className="mt-4 font-display text-4xl leading-tight text-foam sm:text-5xl" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }}>
          {live ? "The tide is coming in." : "Opens with the first tide."}
        </h1>
        <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-mist">
          {live
            ? "$EBB is launching on Pons. The console opens as soon as the Basin is live and the first tide is booked."
            : "Sign-in, API keys, the Logbook and Soundings open on Robinhood Chain right after $EBB launches on Pons."}
        </p>
        <div className="mx-auto mt-8 inline-flex items-center gap-4 rounded-[2px] border border-brass/40 bg-abyss/55 px-5 py-3">
          <span className="eyebrow text-[10px] text-brass-ink">Launch</span>
          <span className="font-mono text-[12px] text-mist">
            {when.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} · {pad2(when.getUTCHours())}:{pad2(when.getUTCMinutes())} UTC
          </span>
          <span className="font-mono text-[15px] text-foam tnum" aria-label="Time until launch">
            {d}d {h}:{m}:{s}
          </span>
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a href={BUY_URL} target="_blank" rel="noreferrer noopener" className="btn btn-brass h-11 px-5">
            Buy $EBB on Pons <IconExternal size={14} />
          </a>
          <Link href="/docs" className="btn btn-ghost h-11 px-5">
            <IconBook size={15} /> Read the docs
          </Link>
          <Link href="/" className="btn btn-ghost h-11 px-5">
            Back to the tide <IconArrowRight size={14} />
          </Link>
        </div>
        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
          <a href={X_URL} target="_blank" rel="noreferrer noopener" className="text-brass-ink hover:text-foam">@ebbtidexyz</a> ·{" "}
          <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" className="text-brass-ink hover:text-foam">Telegram</a>
        </p>
      </div>
    </main>
  );
}
