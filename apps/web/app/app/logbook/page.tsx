"use client";

import { useState } from "react";
import { parseUnits, type Address } from "viem";
import { useConnection } from "wagmi";
import { ebbVaultAbi, type TideEntry } from "@ebb/shared";
import { api, apiUrl, ApiError, errorText } from "@/lib/api";
import { VAULT_ADDRESS } from "@/lib/env";
import { explorerTx, activeChain } from "@/lib/chains";
import { publicClient } from "@/lib/public-client";
import { useLogbook, useMe, useSandbox, type GrantProof } from "@/lib/queries";
import { compact, int, shortHash, toNum, toUnix, usd, utcStamp } from "@/lib/format";
import { Empty, Kv, Notice, PageHead, Panel, SkeletonRows } from "@/components/console/ui";
import { CopyButton } from "@/components/site/copy-button";
import { IconCheck, IconClose, IconDownload, IconExternal, IconShield, IconWarning } from "@/components/site/icons";

const STATUS: Record<string, string> = {
  open: "text-mist border-line",
  committed: "text-kelp border-kelp/60",
  expired: "text-coral border-coral/60",
  burned: "text-coral border-coral bg-coral/10",
};

export default function LogbookPage() {
  const [from, setFrom] = useState<number | undefined>(undefined);
  const q = useLogbook(48, from);
  const [sel, setSel] = useState<TideEntry | null>(null);
  const rows = q.data ?? [];
  const oldest = rows.length ? rows[rows.length - 1].tide : undefined;

  return (
    <>
      <PageHead
        kicker="Console · logbook"
        title="The Logbook"
        lede="One entry per tide: what was booked, granted, spent and burned, with the Merkle root committed on-chain."
        actions={
          <a href={apiUrl("/api/logbook?format=csv&limit=1000")} className="btn btn-ghost btn-sm" download>
            <IconDownload size={14} /> CSV
          </a>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <Panel title="Tides · newest first" pad={false} aside={from !== undefined ? <button className="font-mono text-[11px] text-mist hover:text-foam" onClick={() => setFrom(undefined)}>Back to latest</button> : null}>
          {q.isLoading ? (
            <SkeletonRows rows={8} cols={6} />
          ) : q.isError ? (
            <div className="p-5">
              <Notice tone="error">{errorText(q.error)}</Notice>
            </div>
          ) : rows.length === 0 ? (
            <Empty title="Nothing logged yet">The first entry prints when the first tide closes, 30 minutes after genesis.</Empty>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="data-table min-w-[720px]">
                  <thead>
                    <tr>
                      <th scope="col">Tide</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="num">Booked</th>
                      <th scope="col" className="num">Granted</th>
                      <th scope="col" className="num">Wallets</th>
                      <th scope="col" className="num">Used</th>
                      <th scope="col" className="num">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.tide} className={`cursor-pointer transition-colors hover:bg-shelf/40 ${sel?.tide === r.tide ? "bg-brass/10" : ""}`} onClick={() => setSel(r)}>
                        <td>
                          <button type="button" className="font-mono text-[12.5px] text-foam underline-offset-4 hover:underline" onClick={() => setSel(r)} aria-label={`Open tide ${r.tide}`}>
                            #{int(r.tide)}
                          </button>
                          <div className="font-mono text-[11px] text-mist">{utcStamp(toUnix(r.starts_at))}</div>
                        </td>
                        <td>
                          <span className={`inline-block rounded-[2px] border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] ${STATUS[r.status] ?? STATUS.open}`}>{r.status}</span>
                        </td>
                        <td className="num font-mono text-[12.5px]">{usd(r.booked)}</td>
                        <td className="num font-mono text-[12.5px] text-foam">{usd(r.granted)}</td>
                        <td className="num font-mono text-[12.5px]">{int(r.wallets)}</td>
                        <td className="num font-mono text-[12.5px] text-kelp">{usd(r.used)}</td>
                        <td className="num font-mono text-[12.5px]">{usd(r.open)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end border-t border-line px-4 py-3">
                <button type="button" className="btn btn-ghost btn-sm" disabled={oldest === undefined || oldest <= 0 || rows.length < 48} onClick={() => setFrom((oldest ?? 1) - 1)}>
                  Older tides →
                </button>
              </div>
            </>
          )}
        </Panel>
        <div>{sel ? <TideDetail t={sel} onClose={() => setSel(null)} /> : <Panel title="Tide detail"><p className="text-[13.5px] text-mist">Choose a tide to see its root, transactions and burn, and to verify your own grant against the chain.</p></Panel>}</div>
      </div>
    </>
  );
}

function TideDetail({ t, onClose }: { t: TideEntry; onClose: () => void }) {
  return (
    <div className="space-y-4 xl:sticky xl:top-20">
      <Panel
        title={`Tide #${int(t.tide)}`}
        aside={
          <button type="button" onClick={onClose} className="text-mist hover:text-foam" aria-label="Close detail">
            <IconClose size={15} />
          </button>
        }
      >
        <dl>
          <Kv k="Started" v={utcStamp(toUnix(t.starts_at))} />
          <Kv k="Status" v={t.status} />
          <Kv k="Booked" v={usd(t.booked)} />
          <Kv k="Granted" v={usd(t.granted)} />
          <Kv k="Wallets" v={int(t.wallets)} />
          <Kv k="Used" v={usd(t.used)} />
          <Kv k="Paid to providers" v={usd(t.withdrawn)} />
          <Kv k="Still open" v={usd(t.open)} />
        </dl>
        <div className="mt-4 border-t border-line pt-4">
          <div className="eyebrow">Grant root</div>
          {t.grant_root ? (
            <div className="mt-2 flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-foam">{t.grant_root}</code>
              <CopyButton value={t.grant_root} compact />
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-mist">Not committed yet. Roots are committed shortly after the tide ends.</p>
          )}
          {t.commit_tx ? <TxLink label="commit tx" hash={t.commit_tx} /> : null}
        </div>
        {t.burn ? (
          <div className="mt-4 border-t border-line pt-4">
            <div className="eyebrow !text-coral">Drawn into the Trench</div>
            <dl className="mt-2">
              <Kv k="USDG in" v={usd(t.burn.usdg_in)} />
              <Kv k="$EBB burned" v={compact(toNum(t.burn.ebb_burned), 2)} />
              <Kv k="Caller" v={shortHash(t.burn.caller, 8, 6)} />
              <Kv k="Tip" v={usd(t.burn.tip)} />
            </dl>
            <TxLink label="burn tx" hash={t.burn.tx} />
          </div>
        ) : null}
      </Panel>
      <VerifyGrant tide={t.tide} committed={!!t.grant_root} />
    </div>
  );
}

function TxLink({ label, hash }: { label: string; hash: string }) {
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer noopener" className="mt-2 inline-flex items-center gap-1.5 font-mono text-[12px] text-mist hover:text-brass-ink">
      {label} {shortHash(hash, 10, 6)} <IconExternal size={11} />
    </a>
  );
}

type VState = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; amount: string } | { kind: "bad"; amount: string } | { kind: "none" } | { kind: "error"; msg: string };

function VerifyGrant({ tide, committed }: { tide: number; committed: boolean }) {
  const sandbox = useSandbox();
  const conn = useConnection();
  const me = useMe();
  const addr = (conn.address ?? me.data?.addr) as Address | undefined;
  const [state, setState] = useState<VState>({ kind: "idle" });

  const reason = sandbox
    ? "The sandbox simulates the chain, so there is no on-chain root to check against. On testnet or mainnet this button calls verifyGrant on the Basin."
    : !VAULT_ADDRESS
      ? "The Basin address is not configured in this build (NEXT_PUBLIC_VAULT_ADDRESS). It is published at launch."
      : !addr
        ? "Connect a wallet to check your own grant."
        : !committed
          ? "This tide has no committed root yet."
          : null;

  async function verify() {
    if (!addr || !VAULT_ADDRESS) return;
    setState({ kind: "busy" });
    try {
      const g = await api<GrantProof>(`/api/grants/${addr}/${tide}`);
      const amount = typeof g.amount === "string" && g.amount.includes(".") ? parseUnits(g.amount, 6) : BigInt(g.amount);
      const ok = await publicClient().readContract({
        address: VAULT_ADDRESS,
        abi: ebbVaultAbi,
        functionName: "verifyGrant",
        args: [BigInt(tide), addr, amount, g.proof],
      });
      const shown = typeof g.amount === "string" && g.amount.includes(".") ? g.amount : (Number(amount) / 1e6).toFixed(6);
      setState(ok ? { kind: "ok", amount: shown } : { kind: "bad", amount: shown });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState({ kind: "none" });
      else setState({ kind: "error", msg: e instanceof ApiError ? errorText(e) : e instanceof Error ? e.message.split("\n")[0] : "Verification failed." });
    }
  }

  return (
    <Panel title="Verify my grant on-chain">
      <p className="text-[13.5px] leading-relaxed text-mist">
        Fetches your Merkle proof from the API, then asks the Basin itself, through {activeChain.name}&apos;s public RPC, whether your leaf is in this
        tide&apos;s root. The API is not trusted for the answer.
      </p>
      <button type="button" className="btn btn-brass mt-4 w-full" disabled={!!reason || state.kind === "busy"} onClick={verify} aria-describedby={reason ? "verify-why" : undefined}>
        <IconShield size={15} /> {state.kind === "busy" ? "Reading the chain…" : "Verify my grant"}
      </button>
      {reason ? (
        <p id="verify-why" className="mt-3 text-[12.5px] leading-relaxed text-mist">
          {reason}
        </p>
      ) : null}
      <div className="mt-3" aria-live="polite">
        {state.kind === "ok" ? (
          <p className="flex gap-2 text-[13.5px] text-kelp">
            <IconCheck size={16} className="mt-0.5 shrink-0" /> verifyGrant returned true: {usd(state.amount, { precise: true })} for {shortHash(addr, 6, 4)} in tide #{int(tide)}.
          </p>
        ) : state.kind === "bad" ? (
          <p className="flex gap-2 text-[13.5px] text-coral">
            <IconWarning size={16} className="mt-0.5 shrink-0" /> verifyGrant returned false for the proof the API gave. Please report this.
          </p>
        ) : state.kind === "none" ? (
          <p className="text-[13.5px] text-mist">No grant for this wallet in tide #{int(tide)}.</p>
        ) : state.kind === "error" ? (
          <Notice tone="error">{state.msg}</Notice>
        ) : null}
      </div>
    </Panel>
  );
}
