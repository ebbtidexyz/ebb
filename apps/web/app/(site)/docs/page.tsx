import type { Metadata } from "next";
import Link from "next/link";
import { TIERS, TREASURY_SPLIT, TRADER_FEE_BPS, VAULT_FEE_BPS, LAUNCHPAD_KEEP_BPS } from "@ebb/shared";
import { feeSplit } from "@/lib/model";
import { API_URL, VAULT_ADDRESS, TOKEN_ADDRESS, CHAIN_ID, LAUNCH_CA, BUY_URL } from "@/lib/env";
import { CodeBlock } from "@/components/site/code-block";
import { Toc, type TocItem } from "@/components/docs/toc";

export const metadata: Metadata = {
  title: "Docs",
  description: "How Ebb works: tides, tidepools, the Basin, burns, the Logbook, the API and the security model.",
};

const TOC: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "credits", label: "How credits work" },
  { id: "fees", label: "Fees" },
  { id: "vault", label: "EbbVault" },
  { id: "burns", label: "Burns" },
  { id: "logbook", label: "Logbook and Soundings" },
  { id: "tiers", label: "Depth tiers" },
  { id: "token", label: "Token facts" },
  { id: "api", label: "API reference" },
  { id: "security", label: "Security and anti-gaming" },
  { id: "treasury", label: "Treasury" },
  { id: "risks", label: "Risks" },
  { id: "faq", label: "FAQ" },
  { id: "disclaimer", label: "Disclaimer" },
];

function H2({ id, n, children }: { id: string; n: number; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 border-t border-line pt-10 font-display text-[2rem] leading-tight text-foam">
      <span className="mr-3 align-middle font-mono text-[12px] text-brass-ink tnum">{String(n).padStart(2, "0")}</span>
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-8 text-[17px] font-semibold text-foam">{children}</h3>;
}

function Table({ head, rows, mono = [0] }: { head: string[]; rows: (string | React.ReactNode)[][]; mono?: number[] }) {
  return (
    <div className="mt-5 overflow-x-auto border-y border-line">
      <table className="data-table min-w-[560px]">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={mono.includes(j) ? "font-mono text-[12.5px] text-foam" : "text-mist"}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const pct = (bps: number) => `${bps / 100}%`;
const FEES = feeSplit(100_000);
const usd0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const usd2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const P = ({ children }: { children: React.ReactNode }) => <p className="mt-4 text-[15.5px] leading-[1.75] text-mist">{children}</p>;
const C = ({ children }: { children: React.ReactNode }) => <code className="break-words rounded-[2px] bg-line/40 px-1.5 py-0.5 font-mono text-[0.85em] text-foam [overflow-wrap:anywhere]">{children}</code>;

export default function DocsPage() {
  const base = `${API_URL}/v1`;
  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-10 pt-12 sm:px-6 md:pt-16">
      <header className="max-w-3xl">
        <p className="eyebrow">
          <span className="text-brass-ink">Docs</span> · one page, one source of truth
        </p>
        <h1 className="mt-5 font-display text-5xl leading-[1.04] tracking-[-0.02em] text-foam sm:text-6xl" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 30' }}>
          The pilot book
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-mist">
          Everything Ebb does, how to use it, and how to check it. Every number on this page comes from the same constants file the contracts and API are
          built from.
        </p>
      </header>

      <div className="mt-14 grid gap-12 lg:grid-cols-[230px_1fr] lg:gap-16">
        <aside>
          <Toc items={TOC} />
        </aside>

        <article className="min-w-0 max-w-[760px] space-y-16">
          {/* 1 */}
          <section aria-labelledby="overview">
            <H2 id="overview" n={1}>
              Overview
            </H2>
            <P>
              Ebb is a fee-to-AI-credit token on Robinhood Chain. Hold <strong className="text-foam">$EBB</strong> and the fees from every trade pay for
              your AI. Every 30 minutes (a <strong className="text-foam">tide</strong>) the fees collected in the vault, called <strong className="text-foam">the Basin</strong>, are split pro-rata among eligible
              holders as credit. Each grant lands in its own <strong className="text-foam">tidepool</strong> and lives for seven days. Credit you spend pays for
              model usage through an OpenAI-compatible API. Credit you leave is drawn into <strong className="text-foam">the Trench</strong>: it buys $EBB on the
              market and burns it.
            </P>
            <P>What makes it checkable rather than trusted:</P>
            <ul className="mt-3 space-y-2 text-[15px] text-mist">
              {[
                "The Basin (EbbVault) is an immutable contract: no owner, no proxy, no delegatecall, no selfdestruct.",
                "Each tide’s grants are committed on-chain as a Merkle root. Anyone can verify their own grant.",
                "Reserves are read from the chain on every request and shown as an equation.",
                "API keys are random, issued after a nonce-bound Sign-In with Ethereum, and stored only as SHA-256.",
                "Contracts, API and this site are open source at github.com/ebbtidexyz/ebb, built from one constants file.",
                "A sandbox runs the whole stack against a simulated chain, so you can try it without funds.",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span aria-hidden="true" className="mt-[9px] h-[5px] w-[5px] shrink-0 rotate-45 bg-brass" />
                  {t}
                </li>
              ))}
            </ul>
          </section>

          {/* 2 */}
          <section aria-labelledby="quickstart">
            <H2 id="quickstart" n={2}>
              Quickstart
            </H2>
            <ol className="mt-6 space-y-8">
              <li>
                <H3>1 · Sign in with your wallet</H3>
                <P>
                  Open the <Link href="/app" className="link">console</Link>, connect an injected wallet and sign one message. It is an EIP-4361 (SIWE)
                  message with a single-use nonce and an expiry. No transaction, no gas, no approval.
                </P>
              </li>
              <li>
                <H3>2 · Create a key</H3>
                <P>
                  Under <Link href="/app/keys" className="link">Keys</Link>, create a key with a label. You can set a spend cap or make it a sub-key of
                  another key for an agent or a teammate. The full key is shown once; we only keep its hash.
                </P>
              </li>
              <li>
                <H3>3 · Point your tools at the gateway</H3>
                <P>Any OpenAI-compatible client works. Change the base URL and the key.</P>
                <CodeBlock className="mt-4" lang="sh" title="curl" code={`curl ${base}/chat/completions \\
  -H "Authorization: Bearer $EBB_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"<model id from /v1/models>","messages":[{"role":"user","content":"Hello"}]}'`} />
                <CodeBlock className="mt-4" lang="py" title="python · openai" code={`from openai import OpenAI

client = OpenAI(base_url="${base}", api_key=os.environ["EBB_KEY"])
reply = client.chat.completions.create(
    model="<model id>",
    messages=[{"role": "user", "content": "Hello"}],
)`} />
                <CodeBlock className="mt-4" lang="ts" title="typescript · openai" code={`import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${base}", apiKey: process.env.EBB_KEY });
const stream = await client.chat.completions.create({
  model: "<model id>",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});`} />
                <P>
                  Every response carries <C>x-ebb-balance</C> (credit before the call), <C>x-ebb-cost</C> and <C>x-ebb-request-id</C> headers.
                </P>
              </li>
            </ol>
          </section>

          {/* 3 */}
          <section aria-labelledby="credits">
            <H2 id="credits" n={3}>
              How credits work
            </H2>
            <P>
              A tide is 1,800 seconds and turns on :00 and :30 UTC. The tide number is <C>tide(t) = floor((t − GENESIS) / 1800)</C>, where GENESIS is an
              immutable of the vault.
            </P>
            <H3>Who gets a grant</H3>
            <P>
              When a tide ends, the allocator integrates every wallet&apos;s $EBB balance over the tide: its time-weighted average balance (TWAB). A
              wallet is eligible if its TWAB is at least 100,000 $EBB (0.01% of supply) and it is not excluded (the Pons bonding curve, the Uniswap v4 pool, the
              vault, the treasury, the burn address, known exchanges).
            </P>
            <CodeBlock className="mt-4" lang="txt" title="grant formula · micro-USD, floored" code={`grant(w) = floor( booked(tide) × twab(w) / Σ twab(eligible) )`} />
            <P>
              Amounts are integer micro-dollars (1 USD = 1,000,000). Rounding dust stays in the tide and burns at expiry. The allocator never guesses:
              if the indexer is behind the end of the tide, it waits.
            </P>
            <H3>Spending</H3>
            <P>
              A request first reserves its maximum possible cost (estimated prompt tokens × input price + <C>max_tokens</C> × output price) from your
              tidepools, <strong className="text-foam">oldest first</strong>. When it finishes, the real cost is computed from the provider&apos;s usage
              and the rest is refunded to the same pools. If the provider fails, everything is refunded. Prices are the upstream list prices with no
              markup.
            </P>
            <H3>Expiry</H3>
            <P>
              A tidepool lives 336 tides (7 days, 604,800 seconds) from the start of its tide. After that it can no longer be spent, and whatever is
              left in the tide on-chain can be burned by anyone.
            </P>
            <Table
              head={["property", "rule"]}
              mono={[0]}
              rows={[
                ["transferable", "No. Credit belongs to the wallet the grant was committed to."],
                ["redeemable", "No. It buys model usage, never ETH, USDG or anything else."],
                ["order", "Oldest pool first, always."],
                ["revivable", "No. An expired pool is already in the Trench."],
              ]}
            />
          </section>

          {/* 4 */}
          <section aria-labelledby="fees">
            <H2 id="fees" n={4}>
              Fees
            </H2>
            <P>
              $EBB trades on <strong className="text-foam">Pons v2</strong>. It starts on a bonding curve priced in ETH (1.68 ETH phantom reserve) and
              graduates when 4.2 ETH has been collected into a Uniswap v4 pool (Pons Meme hook, pool fee 0, liquidity locked forever).
            </P>
            <P>
              Traders pay {pct(TRADER_FEE_BPS)} on every buy and sell, on the curve and after graduation alike: Pons&apos; 1% base fee plus a 2% $EBB
              creator tax. The base fee splits 30% to Pons and 70% to the creator; the creator gets all of the tax. The creator is the Basin, so{" "}
              <strong className="text-foam">{pct(VAULT_FEE_BPS)} of volume reaches the Basin</strong>, paid in ETH, and Pons keeps {pct(LAUNCHPAD_KEEP_BPS)}.
            </P>
            <Table
              head={["per $100,000 volume", "amount"]}
              mono={[1]}
              rows={[
                [`Traders pay (${pct(TRADER_FEE_BPS)})`, usd0(FEES.tradersPay)],
                [`Pons keeps (${pct(LAUNCHPAD_KEEP_BPS)})`, usd0(FEES.pons)],
                [`Reaches the Basin (${pct(VAULT_FEE_BPS)})`, usd0(FEES.vault)],
                ["Credit pool (70%)", usd0(FEES.pool)],
                ["Treasury (30%)", usd0(FEES.treasury)],
                ["If holders spend 15%: becomes AI", usd2(FEES.pool * 0.15)],
                ["If holders spend 15%: buys and burns $EBB", usd2(FEES.pool * 0.85)],
              ]}
            />
            <H3>How the fees reach the Basin</H3>
            <P>
              Pons does not push fees. They sit on the curve (before graduation) or on the Pons hook (after) until they are swept into Pons&apos; fee escrow,
              and only the recipient can claim them. <C>harvest()</C>, which anyone can call, sweeps the curve, claims from the escrow, swaps the ETH to
              USDG on the Uniswap V3 WETH/USDG pool within 3% of its 30-minute TWAP, then splits it in the same transaction: 70% to the current
              tide&apos;s credit pool, 30% to the treasury. After graduation, fees reach the escrow when Pons&apos; sweep operator sweeps the hook.
            </P>
            <H3>Who receives them</H3>
            <P>
              The founder launches $EBB through the Pons UI. Right after launch the creator fee recipient is transferred on-chain to the Basin. From then
              on only the Basin holds that right, and it has no function to use it, so nobody we control can redirect the fees. Fees from the first
              minutes, before the transfer, are forwarded to the Basin by the founder. Pons&apos; owner can still propose a change (see{" "}
              <a href="#risks" className="link">Risks</a>).
            </P>
            <P>
              Play with the numbers in the <Link href="/#tide-tables" className="link">Tide tables</Link>.
            </P>
          </section>

          {/* 5 */}
          <section aria-labelledby="vault">
            <H2 id="vault" n={5}>
              EbbVault, the Basin
            </H2>
            <P>
              No owner. No upgrade. No <C>selfdestruct</C>, no <C>delegatecall</C>. Every address and constant is immutable. The operator key can only
              commit grant roots and pay the fixed settlement address; a guardian can freeze the operator, one way, forever.
            </P>
            <Table
              head={["function", "who", "what it does"]}
              mono={[0, 1]}
              rows={[
                ["harvest()", "anyone", "Sweeps the Pons curve and claims from Pons’ fee escrow (fees are not pushed), swaps all ETH to USDG on the V3 WETH/USDG pool within 3% of its 30-min TWAP, sends 30% to treasury, books 70% to the current tide."],
                ["commitGrants(tide, root, total, wallets)", "operator", "Once per ended tide. Stores the Merkle root of grants; total ≤ booked."],
                ["verifyGrant(tide, wallet, amount, proof)", "view", "True if the leaf is in that tide’s root."],
                ["withdrawForUsage(tide, amount, usageRoot)", "operator", "Pays the fixed settlement address for credit already used. withdrawn + amount ≤ granted. Not after expiry, not when frozen."],
                ["burnExpired(tide, maxAmount)", "anyone", "After tide start + 7 days: swaps min(remaining, max) to $EBB and burns it. Caller earns 0.25%, capped at $2."],
                ["freezeOperator()", "guardian", "One-way. Afterwards nothing can be withdrawn for usage; everything left burns."],
                ["currentEpoch() · epochStart(e) · epochs(e) · remaining(e) · totalOpen()", "view", "Read the Basin’s state per tide."],
              ]}
            />
            <P>
              Grant leaves follow the OpenZeppelin StandardMerkleTree layout: <C>keccak256(bytes.concat(keccak256(abi.encode(tide, wallet, amount))))</C>.
            </P>
            <P>
              Address on {CHAIN_ID === 4663 ? "Robinhood Chain" : "Robinhood Chain testnet"}:{" "}
              <code className="break-all font-mono text-[13px] text-foam">{VAULT_ADDRESS ?? "published at launch"}</code>
            </P>
          </section>

          {/* 6 */}
          <section aria-labelledby="burns">
            <H2 id="burns" n={6}>
              Burns
            </H2>
            <P>
              Every burn takes one path through the vault&apos;s immutable swap adapter: USDG → ETH, then ETH → $EBB on the Pons curve (before
              graduation) or the Uniswap v4 pool (after), bounded at 97% of a 30-minute TWAP quote, then <C>token.burn(amount)</C>. If the token had no burn function the vault would send to <C>0x…dEaD</C>; $EBB has one.
              Total supply drops by exactly the amount burned, which an invariant test checks.
            </P>
            <P>
              <C>burnExpired</C> takes a <C>maxAmount</C> so thin pools can be burned in slices without moving the price beyond the bound. Our keeper calls
              it every ten minutes for every expired tide with a remainder. If it stops, anyone can call it and keep the tip.
            </P>
          </section>

          {/* 7 */}
          <section aria-labelledby="logbook">
            <H2 id="logbook" n={7}>
              Logbook and Soundings
            </H2>
            <P>
              The <strong className="text-foam">Logbook</strong> has one entry per tide: booked, granted, wallets, used, withdrawn, still open, the grant
              root and its transaction, and the burn when it happens. It is available as JSON and CSV, and the console can verify your own grant against
              the on-chain root.
            </P>
            <P>
              <strong className="text-foam">Soundings</strong> is the reserve check. It reads the vault&apos;s USDG balance from the chain on every request
              and sets it against what the books say:
            </P>
            <CodeBlock className="mt-4" lang="txt" title="the soundings equation" code={`usdg.balanceOf(EbbVault) = open credits + used, not yet settled
difference                = 0`} />
          </section>

          {/* 8 */}
          <section aria-labelledby="tiers">
            <H2 id="tiers" n={8}>
              Depth tiers
            </H2>
            <P>Tiers are set by your current $EBB balance. They change rate limits and cosmetics, never the value of a credit or the size of a grant.</P>
            <Table
              head={["tier", "hold", "req/min", "concurrent", "adds"]}
              mono={[1, 2, 3]}
              rows={TIERS.map((t) => [
                <span key="l" className="font-display text-base italic text-foam">
                  {t.label}
                </span>,
                Number(t.min / 10n ** 18n).toLocaleString("en-US"),
                String(t.rpm),
                String(t.concurrent),
                t.perks.join(" · "),
              ])}
            />
          </section>

          {/* 9 */}
          <section aria-labelledby="token">
            <H2 id="token" n={9}>
              Token facts
            </H2>
            <Table
              head={["fact", "value"]}
              mono={[]}
              rows={[
                ["Contract", <code key="c" className="break-all font-mono text-[12.5px] text-foam">{LAUNCH_CA ?? "SOON: published here and on @ebbtidexyz at launch"}</code>],
                ["Launch", <span key="l">Fair launch on <a className="text-brass-ink underline underline-offset-2" href={BUY_URL} target="_blank" rel="noreferrer noopener">Pons</a>, 5 Oct 2026, 15:00 UTC</span>],
                ...(TOKEN_ADDRESS ? [["Testnet token (46630)", <code key="t" className="break-all font-mono text-[12.5px] text-mist">{TOKEN_ADDRESS}</code>] as [string, React.ReactNode]] : []),
                ["Chain", "Robinhood Chain, chain id 4663 (testnet 46630)"],
                ["Supply", "1,000,000,000 $EBB, fixed, no mint"],
                ["Decimals", "18"],
                ["Launchpad", "Pons v2: bonding curve priced in ETH, graduates at 4.2 ETH into a Uniswap v4 pool, liquidity locked forever"],
                ["Allocation", "Fair launch, no team allocation; dev buy disclosed at launch"],
                ["Trader fee", `${pct(TRADER_FEE_BPS)} on every trade: Pons 1% base fee + 2% creator tax`],
                ["Reaches the Basin", `${pct(VAULT_FEE_BPS)} of volume, in ETH (Pons keeps ${pct(LAUNCHPAD_KEEP_BPS)})`],
                [
                  "Creator fee recipient",
                  <span key="f">
                    EbbVault (the Basin), verify it on-chain:{" "}
                    <code className="break-all font-mono text-[12.5px] text-foam">{VAULT_ADDRESS ?? "published at launch"}</code>
                  </span>,
                ],
                ["Grant floor", "100,000 $EBB (0.01% of supply)"],
                ["Tide", "1,800 s; credit lives 336 tides (7 days)"],
              ]}
            />
            <P>Verify the address on this page, in the repository and on our X account before buying. Fake addresses are common in the first hour of any launch.</P>
          </section>

          {/* 10 */}
          <section aria-labelledby="api">
            <H2 id="api" n={10}>
              API reference
            </H2>
            <P>
              Base URL <C>{API_URL}</C>. Money fields are decimal strings with six places. Errors always look like{" "}
              <C>{`{ "error": { "type": "…", "message": "…" } }`}</C>.
            </P>
            <H3>Public</H3>
            <Table
              head={["endpoint", "returns"]}
              rows={[
                ["GET /v1/models", "Models with upstream name, context window, list price and minimum tier"],
                ["GET /api/stats", "Current and next tide; granted, used, expired and burned over 24 h and all time"],
                ["GET /api/tides/:n", "One tide’s Logbook entry"],
                ["GET /api/logbook?from=&limit=", "Logbook, newest first. Add format=csv for CSV"],
                ["GET /api/soundings", "vault_usdg (on-chain), open_credits, unsettled_used, difference, block, addresses"],
                ["GET /api/grants/:addr/:tide", "{ amount, proof[] } for verifyGrant"],
                ["GET /api/holders?limit=", "The depth wall: top holders by balance, with tier"],
                ["GET /api/health", "Liveness and mode"],
              ]}
            />
            <H3>With an API key</H3>
            <Table
              head={["endpoint", "returns"]}
              rows={[
                ["POST /v1/chat/completions", "OpenAI-compatible, streaming supported. Headers x-ebb-balance, x-ebb-cost, x-ebb-request-id"],
                ["GET /v1/key", "Balance, tidepools [{ tide, remaining, expires_at }], tier and limits"],
                ["GET /v1/usage?from=", "Your requests with tokens and cost"],
              ]}
            />
            <H3>With a wallet session</H3>
            <Table
              head={["endpoint", "does"]}
              rows={[
                ["GET /api/auth/nonce", "A single-use nonce for the SIWE message"],
                ["POST /api/auth/verify", "{ message, signature } → sets an httpOnly session cookie for 24 h"],
                ["POST /api/auth/logout", "Ends the session"],
                ["GET /api/me", "Address, tier, balance, credit, pools and keys"],
                ["POST /api/keys", "{ label, spend_cap?, parent_id? } → { key }, shown once"],
                ["POST /api/keys/:id/revoke", "Revokes a key and its sub-keys"],
              ]}
            />
            <H3>Errors</H3>
            <Table
              head={["status", "meaning"]}
              rows={[
                ["401", "Missing or unknown key, or no session"],
                ["402", "insufficient_credit: your pools cannot cover the reserved maximum"],
                ["429", "Rate or concurrency limit for your tier; honour retry-after"],
                ["503", "Spending paused because settlement failed three times in a row"],
              ]}
            />
            <CodeBlock className="mt-6" lang="sh" title="verify a grant yourself" code={`# 1. fetch your proof
curl ${API_URL}/api/grants/0xYourWallet/1234
# 2. call the vault (cast, from Foundry)
cast call <EbbVault> "verifyGrant(uint256,address,uint256,bytes32[])(bool)" \\
  1234 0xYourWallet <amount> "[<proof...>]" --rpc-url https://robinhood-rpc.publicnode.com`} />
          </section>

          {/* 11 */}
          <section aria-labelledby="security">
            <H2 id="security" n={11}>
              Security and anti-gaming
            </H2>
            <Table
              head={["attempt", "why it fails"]}
              mono={[]}
              rows={[
                ["Buy before the tide turns, sell after", "TWAB: five minutes of holding earns a sixth of the tide’s share."],
                ["Wash trading", "A round trip costs 6% in fees and only a pro-rata slice returns to the trader."],
                ["Redirecting the fees", "The creator fee recipient is the Basin, which has no function to change it. Nobody we control can move the fees."],
                ["Splitting a bag", "Pro-rata maths gains nothing; the floor keeps dust out."],
                ["Replaying a signature", "SIWE nonces are single-use with an expiry; keys are random, not derived."],
                ["Stolen database", "Keys are stored as SHA-256 hashes."],
                ["Compromised operator", "Pays only the fixed settlement address, bounded per tide by granted; the guardian can freeze it."],
                ["Stalled keeper", "harvest and burnExpired are permissionless, and burns pay a tip."],
                ["Indexer lag or reorg", "Indexer lags 3 blocks; the allocator waits rather than guesses."],
              ]}
            />
            <H3>Invariants</H3>
            <ol className="mt-4 grid gap-2 text-[14.5px] text-mist">
              {[
                "I1 · USDG in the vault equals the sum of remaining over every tide",
                "I2 · withdrawn ≤ granted ≤ booked, per tide",
                "I3 · burnExpired reverts before tide start + 7 days",
                "I4 · a fully burned tide can never be withdrawn",
                "I5 · every harvest splits exactly 70 / 30",
                "I6 · swaps revert beyond 3% of the oracle quote",
                "I7 · total supply drops by exactly the amount burned",
                "I8 · USDG moves only to settlement, treasury, the burn path or the caller tip",
              ].map((t) => (
                <li key={t} className="font-mono text-[13px]">
                  {t}
                </li>
              ))}
            </ol>
          </section>

          {/* 12 */}
          <section aria-labelledby="treasury">
            <H2 id="treasury" n={12}>
              Treasury
            </H2>
            <P>The treasury receives 30% of every harvest and is published monthly in Soundings with a transaction link for every movement.</P>
            <Table head={["bucket", "share", "for"]} mono={[1]} rows={TREASURY_SPLIT.map((s) => [s.label, `${s.pct}%`, s.note])} />
          </section>

          {/* 13 */}
          <section aria-labelledby="risks">
            <H2 id="risks" n={13}>
              Risks
            </H2>
            <ul className="mt-4 space-y-3 text-[15px] text-mist">
              {[
                "Grants follow trading volume. If volume falls, grants fall with it. Nothing is promised.",
                "Metering happens on our gateway. Withdrawals for usage are bounded, rooted and freezable, but usage figures are still reported by us.",
                "Pons’ owner (a 2-of-3 Safe) can propose moving the creator fees away from the Basin, a community takeover. The proposal is public and can only execute after a 3-day delay; our keeper watches for CreatorFeeRecipientChangeProposed and we will announce it publicly.",
                "Pons v2 is not yet audited. A bug in its curve, hook or fee escrow could stop or trap the fees.",
                "After graduation, fees reach Pons’ escrow only when Pons’ sweep operator sweeps the hook. If it stops, inflow pauses until it resumes.",
                "Fees from the first minutes, before the fee recipient moves to the Basin, depend on the founder forwarding them.",
                "Model providers can change prices, limits or access.",
                "Smart contracts can have bugs. At launch the vault is invariant- and fork-tested; an external audit is on the charted course.",
                "$EBB is volatile, like every token.",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span aria-hidden="true" className="mt-[9px] h-[5px] w-[5px] shrink-0 bg-coral" />
                  {t}
                </li>
              ))}
            </ul>
          </section>

          {/* 14 */}
          <section aria-labelledby="faq">
            <H2 id="faq" n={14}>
              FAQ
            </H2>
            <div className="mt-6 divide-y divide-line border-y border-line">
              {[
                ["Do I need to stake or lock anything?", "No. Hold $EBB in your own wallet, sign one message for a key, and tides arrive on their own."],
                ["Is this cash or a yield?", "No. Credit is access to model usage. It is not transferable, not redeemable and never a fixed amount."],
                ["What happens to credit I do not use?", "After seven days it buys $EBB on the market and burns it. You still benefit through the smaller supply."],
                ["Which models can I use?", "The ones listed at /v1/models, with their upstream names and list prices. Some arrive first for the Abyss tier."],
                ["Who triggers burns?", "Our keeper, every ten minutes. And anyone else: burnExpired is permissionless and pays a tip."],
                ["Can I share a key?", "Yes. It spends your credit. Use sub-keys with spend caps for agents and teammates, and revoke them any time."],
                ["Who can redirect the fees?", "Nobody we control. The creator fee recipient is the Basin, which has no function to change it. Pons’ owner can propose a change, publicly, with a 3-day delay; we would announce it."],
                ["Where does the money sit?", "In EbbVault, in USDG, booked per tide. It can only pay a provider for used credit or buy and burn $EBB."],
                ["Can I try it without buying?", "Yes. The sandbox runs the full stack against a simulated chain and holders; signing in gives a dev wallet a seeded balance."],
              ].map(([q, a]) => (
                <details key={q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] text-foam">
                    {q}
                    <span aria-hidden="true" className="font-mono text-mist transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-[15px] leading-relaxed text-mist">{a}</p>
                </details>
              ))}
            </div>
          </section>

          {/* 15 */}
          <section aria-labelledby="disclaimer">
            <H2 id="disclaimer" n={15}>
              Disclaimer
            </H2>
            <P>
              Ebb credits are a grant of access to AI model usage. They are not transferable, not redeemable for money or any digital asset, and not an
              investment return. Credit amounts depend on trading activity and are never fixed or promised. $EBB is a utility token for access within the
              product; it confers no ownership, profit share or claim on any person, entity or asset. Burns are a protocol mechanism, not a payment to
              holders. Nothing here is financial, investment, legal or tax advice. Smart contracts can contain bugs, providers can change price or access,
              and digital assets are volatile. Never risk what you cannot afford to lose.
            </P>
          </section>
        </article>
      </div>
    </div>
  );
}
