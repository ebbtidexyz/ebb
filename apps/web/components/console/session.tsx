"use client";

import { useState } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSignMessage } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { activeChain } from "@/lib/chains";
import { errorText } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { siweSignIn, siweSignOut } from "@/lib/siwe";
import { shortHash } from "@/lib/format";
import { IconLogout, IconWallet } from "../site/icons";
import { Notice, Panel } from "./ui";

/** Wallet connection + SIWE session state, in one hook. */
export function useSession() {
  const conn = useConnection();
  const me = useMe();
  const qc = useQueryClient();
  const { mutateAsync: signMessageAsync } = useSignMessage();
  const { mutate: disconnect } = useDisconnect();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionAddr = me.data?.addr?.toLowerCase();
  const walletAddr = conn.address?.toLowerCase();
  const mismatch = !!sessionAddr && !!walletAddr && sessionAddr !== walletAddr;

  async function signIn() {
    if (!conn.address) return;
    setBusy(true);
    setError(null);
    try {
      await siweSignIn({
        address: conn.address,
        chainId: conn.chainId ?? activeChain.id,
        sign: (message) => signMessageAsync({ message }),
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      const msg = e instanceof Error && /reject|denied/i.test(e.message) ? "Signature request was declined in your wallet." : errorText(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await siweSignOut();
    qc.setQueryData(["me"], null);
    disconnect();
  }

  return {
    conn,
    me,
    signedIn: !!me.data,
    mismatch,
    busy,
    error,
    signIn,
    signOut,
  };
}

export function ConnectButtons() {
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  const injected = connectors.filter((c) => c.type === "injected");
  const list = injected.length ? injected : connectors;
  const noWallet = typeof window !== "undefined" && !(window as unknown as { ethereum?: unknown }).ethereum && list.length <= 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {list.map((c) => (
          <button key={c.uid} type="button" className="btn btn-brass" disabled={isPending} onClick={() => connect({ connector: c })}>
            <IconWallet size={15} />
            {isPending ? "Opening wallet…" : c.name === "Injected" ? "Connect browser wallet" : `Connect ${c.name}`}
          </button>
        ))}
      </div>
      {noWallet ? <p className="text-[13px] text-mist">No browser wallet detected. Install one (MetaMask, Rabby, Coinbase Wallet) and reload.</p> : null}
      {error ? <Notice tone="error">{/reject|denied/i.test(error.message) ? "Connection request was declined." : error.message.split("\n")[0]}</Notice> : null}
    </div>
  );
}

/** Wraps pages that need a wallet session (SIWE). */
export function SessionGate({ children, what }: { children: React.ReactNode; what: string }) {
  const s = useSession();
  if (s.me.isLoading) return <div className="skeleton h-48" aria-busy="true" aria-label="Checking your session" />;
  if (s.me.isError)
    return (
      <Panel title="API unreachable">
        <Notice tone="error">{errorText(s.me.error)}</Notice>
        <p className="mt-3 text-[13.5px] text-mist">Signing in needs the Ebb API. Public pages (Logbook, Soundings, Depth) will work once it answers too.</p>
      </Panel>
    );
  if (s.signedIn && !s.mismatch) return <>{children}</>;
  return (
    <Panel title="Sign in">
      <div className="max-w-xl">
        <h2 className="font-display text-2xl text-foam">Sign in to see {what}.</h2>
        <p className="mt-2 text-[14.5px] leading-relaxed text-mist">
          Connect a wallet, then sign one message. It is a Sign-In with Ethereum message with a single-use nonce and a ten-minute expiry: no
          transaction, no gas, no approval.
        </p>
        <ol className="mt-6 space-y-5">
          <li className="grid grid-cols-[1.75rem_1fr] gap-3">
            <Step n={1} done={!!s.conn.address} />
            <div>
              <div className="text-[14px] font-semibold text-foam">Connect a wallet</div>
              <div className="mt-2">
                {s.conn.address ? (
                  <span className="font-mono text-[13px] text-mist">
                    {shortHash(s.conn.address, 6, 4)} · connected
                  </span>
                ) : (
                  <ConnectButtons />
                )}
              </div>
            </div>
          </li>
          <li className="grid grid-cols-[1.75rem_1fr] gap-3">
            <Step n={2} done={s.signedIn && !s.mismatch} />
            <div>
              <div className="text-[14px] font-semibold text-foam">Sign the message</div>
              {s.mismatch ? <p className="mt-1 text-[13px] text-mist">Your session belongs to a different address. Sign again with this wallet.</p> : null}
              <button type="button" className="btn btn-ghost mt-2" disabled={!s.conn.address || s.busy} onClick={s.signIn}>
                {s.busy ? "Waiting for signature…" : "Sign in with Ethereum"}
              </button>
              {s.error ? (
                <div className="mt-3">
                  <Notice tone="error">{s.error}</Notice>
                </div>
              ) : null}
            </div>
          </li>
        </ol>
      </div>
    </Panel>
  );
}

function Step({ n, done }: { n: number; done: boolean }) {
  return (
    <span className={`flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[12px] ${done ? "border-kelp bg-kelp/15 text-kelp" : "border-line text-mist"}`}>
      {done ? "✓" : n}
    </span>
  );
}

export function WalletChip() {
  const s = useSession();
  if (!s.conn.address)
    return (
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-mist">
        not connected
      </span>
    );
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-2 rounded-[2px] border border-line px-2.5 py-1.5 font-mono text-[12px] text-foam">
        <span className={`h-1.5 w-1.5 rounded-full ${s.signedIn && !s.mismatch ? "bg-kelp" : "bg-brass"}`} aria-hidden="true" />
        {shortHash(s.conn.address, 6, 4)}
        <span className="sr-only">{s.signedIn ? "signed in" : "connected, not signed in"}</span>
      </span>
      <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-[2px] border border-line text-mist hover:border-brass hover:text-foam" onClick={s.signOut} aria-label="Sign out and disconnect" title="Sign out">
        <IconLogout size={15} />
      </button>
    </div>
  );
}
