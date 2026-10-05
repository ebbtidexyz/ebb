"use client";

import { useState } from "react";
import Link from "next/link";
import { useSessionKey } from "@/lib/session-key";
import { useKeyStatus } from "@/lib/queries";
import { errorText } from "@/lib/api";
import { usd } from "@/lib/format";
import { IconKey } from "../site/icons";
import { Notice, TierBadge } from "./ui";

/** Paste an sk-ebb-… key for this tab. Key-auth endpoints (usage, chat) need the key itself, not the wallet session. */
export function KeyPicker() {
  const [key, setKey] = useSessionKey();
  const [draft, setDraft] = useState("");
  const status = useKeyStatus(key);

  if (key)
    return (
      <div className="neatline flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <span className="flex items-center gap-2 font-mono text-[12.5px] text-foam">
          <IconKey size={14} className="text-brass-ink" />
          {key.slice(0, 12)}…{key.slice(-4)}
        </span>
        {status.data ? (
          <>
            <span className="font-mono text-[12.5px] text-mist">
              credit <span className="text-foam tnum">{usd(status.data.balance)}</span>
            </span>
            <TierBadge tier={status.data.tier} />
          </>
        ) : status.isError ? (
          <span className="text-[12.5px] text-coral">{errorText(status.error)}</span>
        ) : (
          <span className="skeleton h-4 w-24" />
        )}
        <button type="button" className="ml-auto font-mono text-[11px] uppercase tracking-[0.1em] text-mist hover:text-foam" onClick={() => setKey(null)}>
          Forget key
        </button>
      </div>
    );

  return (
    <form
      className="neatline p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) setKey(draft.trim());
        setDraft("");
      }}
    >
      <label htmlFor="key-input" className="text-[13.5px] text-foam">
        Paste an API key to use on this page
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input id="key-input" type="password" autoComplete="off" spellCheck={false} className="field font-mono" placeholder="sk-ebb-…" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn btn-brass shrink-0" disabled={!draft.trim()}>
          Use key
        </button>
      </div>
      <div className="mt-3">
        <Notice>
          Kept in this tab&apos;s session storage only and sent straight to the Ebb API. No key yet? <Link href="/app/keys" className="link">Create one</Link>.
        </Notice>
      </div>
    </form>
  );
}
