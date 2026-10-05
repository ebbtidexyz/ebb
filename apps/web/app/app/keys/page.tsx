"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyInfo } from "@ebb/shared";
import { api, errorText } from "@/lib/api";
import { useInvalidate, useMe } from "@/lib/queries";
import { useSessionKey } from "@/lib/session-key";
import { usd, toUnix, utcStamp } from "@/lib/format";
import { SessionGate } from "@/components/console/session";
import { Empty, Notice, PageHead, Panel } from "@/components/console/ui";
import { CopyButton } from "@/components/site/copy-button";
import { IconKey, IconPlus, IconWarning } from "@/components/site/icons";

export default function KeysPage() {
  return (
    <>
      <PageHead kicker="Console · keys" title="API keys" lede="Random keys, shown once, stored by us only as a SHA-256 hash. Use sub-keys with spend caps for agents and teammates." />
      <SessionGate what="your keys">
        <Keys />
      </SessionGate>
    </>
  );
}

function Keys() {
  const me = useMe();
  const keys = me.data?.keys ?? [];
  const active = keys.filter((k) => !k.revoked_at);
  const [created, setCreated] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
      <CreateKey parents={active} onCreated={setCreated} />
      <Panel title={`Keys · ${active.length} active`} pad={false}>
        {keys.length ? <KeyTable keys={keys} /> : <Empty title="No keys yet">Create your first key on the left. It works with any OpenAI-compatible client.</Empty>}
      </Panel>
      {created ? <ShownOnce secret={created} onClose={() => setCreated(null)} /> : null}
    </div>
  );
}

function CreateKey({ parents, onCreated }: { parents: KeyInfo[]; onCreated: (k: string) => void }) {
  const invalidate = useInvalidate();
  const [label, setLabel] = useState("");
  const [cap, setCap] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const capNum = cap.trim() ? Number(cap) : null;
    if (capNum !== null && (!Number.isFinite(capNum) || capNum <= 0)) {
      setErr("Spend cap must be a positive dollar amount.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ key?: string; secret?: string }>("/api/keys", {
        method: "POST",
        session: true,
        json: { label: label.trim() || "untitled", ...(capNum !== null ? { spend_cap: capNum.toFixed(6) } : {}), ...(parent ? { parent_id: parent } : {}) },
      });
      const k = res.key ?? res.secret;
      if (!k) throw new Error("The API did not return a key.");
      onCreated(k);
      setLabel("");
      setCap("");
      setParent("");
      await invalidate("me");
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="New key">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-[13px] text-foam">Label</span>
          <input className="field mt-1.5" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="cursor on laptop" maxLength={64} />
        </label>
        <label className="block">
          <span className="text-[13px] text-foam">
            Spend cap <span className="text-mist">(optional, USD)</span>
          </span>
          <input className="field mt-1.5 font-mono" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="no cap" />
        </label>
        <label className="block">
          <span className="text-[13px] text-foam">
            Parent <span className="text-mist">(optional, makes a sub-key)</span>
          </span>
          <select className="field mt-1.5" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">None: a top-level key</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.prefix}
              </option>
            ))}
          </select>
        </label>
        {err ? <Notice tone="error">{err}</Notice> : null}
        <button type="submit" className="btn btn-brass w-full" disabled={busy}>
          <IconPlus size={15} /> {busy ? "Creating…" : "Create key"}
        </button>
        <p className="text-[12.5px] leading-relaxed text-mist">Every key spends the same tidepools. Caps and sub-keys limit how much one key can draw; revoking a parent revokes its sub-keys.</p>
      </form>
    </Panel>
  );
}

function KeyTable({ keys }: { keys: KeyInfo[] }) {
  const invalidate = useInvalidate();
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const byId = new Map(keys.map((k) => [k.id, k]));

  async function revoke(k: KeyInfo) {
    if (!window.confirm(`Revoke “${k.label}” (${k.prefix}…)? Anything using it stops working immediately.`)) return;
    setPending(k.id);
    setErr(null);
    try {
      await api(`/api/keys/${encodeURIComponent(k.id)}/revoke`, { method: "POST", session: true });
      await invalidate("me");
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      {err ? (
        <div className="p-4">
          <Notice tone="error">{err}</Notice>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="data-table min-w-[640px]">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Parent</th>
              <th scope="col" className="num">
                Spent / cap
              </th>
              <th scope="col">Created</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const revoked = !!k.revoked_at;
              return (
                <tr key={k.id} className={revoked ? "opacity-55" : ""}>
                  <td>
                    <div className="flex items-center gap-2 text-foam">
                      <IconKey size={14} className="text-brass-ink" />
                      {k.label}
                    </div>
                    <div className="mt-0.5 font-mono text-[12px] text-mist">{k.prefix}…</div>
                  </td>
                  <td className="text-[13px] text-mist">{k.parent_id ? (byId.get(k.parent_id)?.label ?? "sub-key") : "—"}</td>
                  <td className="num font-mono text-[12.5px] text-foam">
                    {usd(k.spent)} <span className="text-mist">/ {k.spend_cap ? usd(k.spend_cap) : "no cap"}</span>
                  </td>
                  <td className="font-mono text-[12px] text-mist">{utcStamp(toUnix(k.created_at))}</td>
                  <td className="text-right">
                    {revoked ? (
                      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-coral">revoked</span>
                    ) : (
                      <button type="button" className="btn btn-danger btn-sm" disabled={pending === k.id} onClick={() => revoke(k)}>
                        {pending === k.id ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShownOnce({ secret, onClose }: { secret: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [, setSessionKey] = useSessionKey();
  const [useHere, setUseHere] = useState(true);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  function close() {
    if (useHere) setSessionKey(secret);
    ref.current?.close();
    onClose();
  }
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="key-once-title"
      className="m-auto w-[min(560px,calc(100vw-2rem))] border border-brass bg-deep p-0 text-foam backdrop:bg-abyss/80 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <div className="flex items-center gap-2 text-brass-ink">
          <IconWarning size={16} />
          <span className="eyebrow !text-brass-ink">Shown once</span>
        </div>
        <h2 id="key-once-title" className="mt-3 font-display text-2xl">
          Copy your key now
        </h2>
        <p className="mt-2 text-[14px] text-mist">We store only its SHA-256 hash, so this is the only time it can be shown. If you lose it, revoke it and create another.</p>
        <div className="mt-5 flex items-center gap-2 border border-line bg-abyss px-3 py-3">
          <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-foam">{secret}</code>
          <CopyButton value={secret} />
        </div>
        <label className="mt-4 flex items-start gap-2.5 text-[13.5px] text-mist">
          <input type="checkbox" className="mt-0.5 accent-[var(--brass)]" checked={useHere} onChange={(e) => setUseHere(e.target.checked)} />
          Also use it for Usage and Playground in this tab (kept in session storage, cleared when the tab closes).
        </label>
        <div className="mt-6 flex justify-end">
          <button type="button" className="btn btn-brass" onClick={close} autoFocus>
            I have copied it
          </button>
        </div>
      </div>
    </dialog>
  );
}
