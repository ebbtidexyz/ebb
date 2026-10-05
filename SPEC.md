# Ebb — spec

> **$EBB · Spend it, or the tide takes it.**
> Hold $EBB and trading fees pay for your AI every 30 minutes. Credits you leave
> on the shore for seven days are drawn into the Trench: they buy $EBB back and burn it.

Working name **Ebb** (ticker `$EBB`). Rename = search/replace `Ebb`/`EBB`/`ebb`.

This is a fee-to-AI-credit token, modelled on orbz.app but fixing what that
project leaves to trust. Every number in this file is the single source of truth
for contracts, API and web. If code disagrees with this file, the code is wrong.

---

## 0. What we do better than Orbz

| Orbz (observed 2026-10-02) | Ebb |
|---|---|
| "OrbzVault" is an EOA: no code, any key holder can move funds | `EbbVault` is an immutable contract, no owner, no proxy, verified source in this repo |
| Grants live only in their DB | Every epoch's grants are committed on-chain as a Merkle root; anyone can verify their own grant |
| `/api/reserves` returns `vault_usdg: null` | Reserves read the vault on-chain every request and show the equation |
| API key = deterministic hash of a fixed signed message (phishable) | Random key issued after a SIWE (EIP-4361) signature with nonce + expiry; stored as SHA-256 |
| Docs disagree (1800 s vs 3600 s epoch, 1/6 vs 1/12) | One constants file per package, all generated from §1 |
| One hidden "Opus" model | Upstream model names are shown; list price shown; configurable OpenAI-compatible upstreams |
| No sandbox | `EBB_MODE=sandbox` runs the full stack with simulated chain + holders, no keys needed |

---

## 1. Constants (never change these without changing every package)

| name | value | note |
|---|---|---|
| `CHAIN_ID` mainnet | 4663 | Robinhood Chain |
| `CHAIN_ID` testnet | 46630 | Robinhood Chain testnet |
| `EPOCH_SECONDS` | 1800 | a **tide**: 30 min, on :00 and :30 UTC |
| `EXPIRY_EPOCHS` | 336 | 7 days = 336 tides |
| `POOL_BPS` | 7000 | 70% of harvested USDG → credit pool |
| `TREASURY_BPS` | 3000 | 30% → treasury |
| `MAX_DEVIATION_BPS` | 300 | swaps revert beyond 3% of the oracle TWAP |
| `TWAP_WINDOW` | 1800 s | |
| `CALLER_TIP_BPS` | 25 | 0.25% tip on burnExpired |
| `CALLER_TIP_CAP` | 2_000000 | $2 in USDG (6 decimals) |
| `GRANT_FLOOR` | 100_000e18 $EBB | 0.01% of supply |
| `TOTAL_SUPPLY` | 1_000_000_000e18 | fixed, no mint |
| `USDG_DECIMALS` | 6 | |
| money off-chain | integer **micro-dollars** (1 USD = 1_000_000) | API returns decimal strings with 6 dp |

`epoch(t) = floor((t - GENESIS) / 1800)`, where `GENESIS` is a vault immutable
(unix seconds, aligned to :00 or :30).

Launch (Pons v2, not ours): $EBB launches on **Pons v2** on Robinhood Chain (4663), 2026-10-05 15:00 UTC.
Fair launch, fixed supply 1,000,000,000, no team allocation; the founder launches it through the Pons UI and
the dev buy is disclosed at launch. It starts on a bonding curve priced in ETH (1.68 ETH phantom reserve) and
graduates when 4.2 ETH has been collected into a Uniswap v4 pool (Pons Meme hook, pool fee 0, liquidity locked
forever). Right after launch the creator fee recipient is transferred on-chain to the immutable EbbVault; fees
from the first minutes before the transfer are forwarded to the vault by the founder.

Trader fee (Pons side, not ours): **3% on every trade** = Pons 1% base fee + 2% $EBB creator tax, on the curve
and after graduation alike. The base fee splits 30% Pons / 70% creator; the creator gets 100% of the tax.
Creator = EbbVault → **2.7% of volume reaches EbbVault, paid in ETH.** Pons keeps 0.3%.
Per $100,000 volume: traders pay $3,000 · Pons keeps $300 · vault $2,700 · pool $1,890 · treasury $810.
At 15% spend: $283.50 becomes AI, $1,606.50 buys and burns $EBB.

---

## 2. Theme vocabulary (use these words in UI copy and docs)

| mechanism | Ebb word |
|---|---|
| epoch (30 min) | **tide** (`tide #244`) |
| grant lands | **flood** / "the tide comes in" |
| credit bucket | **pool** (a tidepool; each has its own countdown) |
| credit aging | **ebb** |
| expiry → buyback + burn | drawn into **the Trench** |
| vault | **the Basin** (contract name stays `EbbVault`) |
| trading fees | **inflow** / rivers |
| receipts | **the Logbook** |
| reserves page | **Soundings** ("vault depth = open credits") |
| almanac / calculator | **Tide tables** |
| roadmap | **Charted course** |
| architecture | **Hull** |
| safeguards | **Bulkheads** |

Tiers (by depth, by $EBB held):

| tier | hold | rpm | concurrent | perks |
|---|---|---|---|---|
| Shore | 0 | 10 | 2 | spends credit already held, receipts, docs |
| Reef | 100,000 (0.01%) | 60 | 8 | tides every 30 min, usage dashboard, ebb view |
| Shelf | 1,000,000 (0.1%) | 120 | 16 | badge on share cards |
| Abyss | 10,000,000 (1%) | 240 | 32 | new models first, name on the depth wall |

Tiers never change what a credit is worth or how grants split.

---

## 3. Repo layout (npm workspaces, Node ≥ 22.13, no native deps)

```
/contracts        Foundry project (Solidity 0.8.26)
/services/api     Node + TypeScript: HTTP API + workers in one process
/apps/web         Next.js (App Router, TS): landing, docs, console (/app/*)
/packages/shared  TS constants + types + ABI shared by api and web
/deploy           systemd units, nginx conf, deploy.sh for the VPS
SPEC.md           this file
```

Root `package.json` workspaces: `services/*`, `apps/*`, `packages/*`.

---

## 4. Contracts (`/contracts`)

### 4.1 `EbbToken.sol` (testnet only; mainnet token comes from Pons v2)
ERC20 "Ebb"/"EBB", 18 dp, 1e9 supply minted once to deployer, `burn(uint256)`
from caller, no owner. OpenZeppelin v5.

### 4.2 `EbbVault.sol` — the Basin
No owner. No upgrade. No `selfdestruct`, no `delegatecall`. All config immutable:

```
token, usdg, weth (address)
swapAdapter (ISwapAdapter)      // performs swaps, immutable
oracle (IPriceOracle)           // TWAP quotes, immutable
feeSource (IFeeSource, may be 0) // Pons v2 fee escrow; harvest() calls claim() in try/catch
treasury, settlement (address)
operator (address)              // allocator + settlement signer key
guardian (address)              // can only freeze operator
genesis (uint64)
constants from §1
```

State per epoch:
```
struct Epoch { uint128 booked; uint128 withdrawn; uint128 burned; bytes32 grantRoot; uint128 granted; bool closed; }
```
`remaining(e) = booked - withdrawn - burned`.

Functions:
- `receive()` — accepts ETH (Pons pays creator fees in ETH).
- `harvest()` — **anyone**. Calls `feeSource.claim()` if set (try/catch). Swaps the full ETH balance → USDG through `swapAdapter` with `minOut = oracle.quote(ETH→USDG) * (1 - 3%)`. Sends 30% to `treasury`, books 70% to `currentEpoch()`. Emits `Harvested(epoch, ethIn, usdgOut, toPool, toTreasury)`. No-op (no revert) if balance is 0.
- `commitGrants(uint256 epoch, bytes32 root, uint128 total)` — **operator**. Only for `epoch < currentEpoch()` (tide has ended), only once per epoch, `total <= booked(epoch)`. Leaf = `keccak256(bytes.concat(keccak256(abi.encode(epoch, wallet, amount))))` (OZ StandardMerkleTree style). Emits `GrantsCommitted(epoch, root, total, wallets)` (wallets passed as arg for indexing). Any `booked - total` dust stays and burns at expiry.
- `verifyGrant(epoch, wallet, amount, proof) view returns (bool)`.
- `withdrawForUsage(uint256 epoch, uint128 amount, bytes32 usageRoot)` — **operator**, not frozen. `epoch` must be not expired, `withdrawn + amount <= granted(epoch)`. Pays fixed `settlement`. Oldest-epoch-first is enforced off-chain; on-chain we enforce per-epoch bound. Emits `UsageWithdrawn(epoch, amount, usageRoot)`.
- `burnExpired(uint256 epoch, uint128 maxAmount)` — **anyone**, requires `block.timestamp >= epochStart(epoch) + 336*1800`. Takes `min(remaining, maxAmount)` (slices on thin pools), tip = min(0.25%, $2) in USDG to `msg.sender`, swaps rest USDG → ETH → $EBB via adapter with oracle bound, calls `token.burn(amount)`; if token has no burn, transfers to `0x…dEaD`. Emits `Burned(epoch, usdgIn, ebbBurned, caller, tip)`.
- `freezeOperator()` — **guardian**, one-way. Afterwards nothing can be withdrawn for usage; everything left eventually burns.
- Views: `currentEpoch()`, `epochStart(e)`, `epochs(e)`, `remaining(e)`, `totalOpen()`.

Invariants (Foundry invariant tests, `test/invariant/`):
- I1 `usdg.balanceOf(vault) == Σ remaining(e)` (± dust from swaps = 0 since booking happens after swap)
- I2 `withdrawn(e) <= granted(e) <= booked(e)`
- I3 `burnExpired` reverts before `epochStart + 7d`
- I4 after an epoch is fully burned, `withdrawForUsage` on it reverts
- I5 every harvest: `toPool * 3000 == toTreasury * 7000` (±1 wei rounding to pool)
- I6 swaps revert outside 3% of oracle quote
- I7 `totalSupply` drops by exactly `ebbBurned` per burn
- I8 no function moves USDG anywhere but `settlement`, `treasury`, burn path, caller tip

### 4.3 Interfaces
```solidity
interface ISwapAdapter { function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to) external payable returns (uint256 out); } // tokenIn == address(0) means native ETH
interface IPriceOracle { function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut); }
interface IFeeSource { function claim() external; }
```
Implementations:
- `mocks/MockSwapAdapter.sol`, `mocks/MockOracle.sol`, `mocks/MockUSDG.sol` (6 dp), `mocks/MockFeeSource.sol` — testnet + tests.
- `PokeTwapOracle.sol` — permissionless `poke()` records spot from an `ISpotSource` into a ring buffer; `quote` uses the 30-min TWAP; reverts if stale (> 2× window).
- `adapters/UniswapV4Adapter.sol` — PoolManager unlock-callback swap. Mark clearly as needing a mainnet-fork test before use.

### 4.4 Pons v2 integration
Mainnet fees come from Pons v2, not from a generic escrow. Fees are not pushed: they sit on the curve (before
graduation) or on the Pons hook (after) until swept into Pons' fee escrow, and only the recipient can claim them.
`harvest()` (anyone) sweeps the curve / pulls from the escrow, swaps ETH→USDG on the Uniswap V3 WETH/USDG pool
within 3% of its 30-minute TWAP, then books 70/30. After graduation, fees reach the escrow when Pons' sweep
operator sweeps the hook. Burns buy $EBB on the curve (before graduation) or the v4 pool (after), bounded at 97%
of a TWAP quote, and call $EBB's `burn()`. Mainnet uses `PonsSwapAdapter`, `PonsSpotSource` and `PonsOracle`.

Trust: the creator fee recipient is the immutable EbbVault, which has no function to change it, so nobody we
control can redirect fees. Pons' owner (a 2-of-3 Safe) can propose a creator-fee-recipient change (community
takeover): public, executable only after a 3-day delay; the keeper watches `CreatorFeeRecipientChangeProposed`
and we announce it publicly. Pons v2 is not yet audited. Details: `contracts/README.md`, `contracts/PONS_V2_DOCS.txt`.

### 4.5 Scripts
- `script/DeployTestnet.s.sol` — deploys EbbToken, MockUSDG, MockOracle, MockSwapAdapter (pre-funded), EbbVault; writes `deployments/46630.json`.
- `script/Deploy.s.sol` — mainnet, reads addresses from env.
- Export ABI to `packages/shared/src/abi/EbbVault.ts` (`as const`).

---

## 5. API (`/services/api`)

Stack: Node ≥ 22.13, TypeScript (run with `tsx` in dev, `tsc` build), **Hono** + `@hono/node-server`, **viem**, **`node:sqlite`** (built in; no native modules), `@openzeppelin/merkle-tree`, `siwe` or viem's `parseSiweMessage`/`verifySiweMessage`. One process: HTTP + workers on timers. Port from `PORT` (default 8787).

### 5.1 Config (env)
```
EBB_MODE=sandbox|chain
PORT=8787
DB_PATH=./data/ebb.sqlite
RPC_URL=https://robinhood-sepolia-rpc.publicnode.com
CHAIN_ID=46630
VAULT_ADDRESS= TOKEN_ADDRESS= USDG_ADDRESS= DEPLOY_BLOCK=
OPERATOR_PRIVATE_KEY=          # commitGrants + withdrawForUsage
KEEPER_PRIVATE_KEY=            # harvest + burnExpired (only needs gas)
EXCLUDED_ADDRESSES=0x..,0x..   # curve, pool, vault, treasury, dead, exchanges
UPSTREAMS_JSON=./upstreams.json
WEB_ORIGIN=http://localhost:3000
SIWE_DOMAIN=localhost:3000
```
`upstreams.json`: `[{ "id":"…", "label":"…", "base_url":"…", "api_key_env":"…", "upstream_model":"…", "input_per_million":"0.30", "output_per_million":"2.50", "context_window":131072, "min_tier":"shore" }]`.
Example file committed as `upstreams.example.json`.

### 5.2 DB (sqlite, migrations in code)
```
transfers(block, log_index, ts, from_addr, to_addr, amount TEXT)      -- raw
balance_points(addr, block, ts, balance TEXT)                          -- after each change
epochs(n PK, starts_at, booked_micro, granted_micro, root, committed_tx, withdrawn_micro, burned_micro, ebb_burned TEXT, burn_tx, status)
grants(epoch, addr, amount_micro, remaining_micro, expires_at, PK(epoch,addr))   -- the tidepools
keys(id PK, addr, hash UNIQUE, prefix, label, parent_id NULL, spend_cap_micro NULL, spent_micro, created_at, revoked_at)
siwe_nonces(nonce PK, created_at, used_at)
requests(id PK, key_id, addr, model, in_tokens, out_tokens, cost_micro, status, created_at, settled_epoch NULL)
debits(request_id, epoch, amount_micro)   -- which pools paid
settlements(id, epoch, amount_micro, usage_root, tx, created_at)
cursor(name PK, value)                    -- indexer block cursor etc
```

### 5.3 Workers (timers inside the process)
- **indexer** (every 5 s in chain mode): `getLogs` Transfer for token from cursor, writes transfers + balance_points. Reorg safety: lag 3 blocks.
- **allocator** (at :00/:30 + 60 s): for the tide that just ended, reads `booked` from vault, computes TWAB per address over `[start, end)` from balance_points (integrated by time), eligible = TWAB ≥ GRANT_FLOOR and not excluded, `amount = floor(booked * twab / Σtwab)` in micro-USD, builds Merkle tree, calls `commitGrants`, inserts grants rows (`expires_at = epochStart + 7d`). Never guesses: if indexer is behind `end`, wait.
- **keeper** (every 10 min): `harvest()` if vault ETH > threshold; `burnExpired(e, max)` for every expired epoch with remaining > 0.
- **settlement** (hourly): group settled `debits` by epoch not yet withdrawn, usage Merkle root over `(request_id, cost_micro)`, call `withdrawForUsage`. Fail closed: if a settlement tx fails 3× in a row, gateway returns 503 for spending until fixed.
- **publisher**: receipts are just queries over epochs/grants/requests/settlements; `/api/receipts/:n.svg` renders a logbook card.

Sandbox mode: no chain. A simulated clock-driven world: 40 fake holders with random balances, each tide books a random inflow ($20–$400), allocator runs the same code against simulated balance_points, keeper "burns" with a fake price. A dev wallet signing in gets a seeded balance so the console works end-to-end. Upstream may also be `"mock"` which streams lorem text and fake usage.

### 5.4 Gateway
`POST /v1/chat/completions` (OpenAI-compatible, `stream` supported):
1. Auth `Authorization: Bearer sk-ebb-…` → sha256 lookup → key, addr, tier (from current balance).
2. Rate limit per tier (token bucket in memory) + concurrency limit → 429 with `retry-after`.
3. Estimate max cost = `(prompt_tokens_estimate * in + max_tokens * out)`; **reserve** it from oldest unexpired pools (FIFO) in one sqlite transaction → 402 `{error:{type:"insufficient_credit"}}` if not enough.
4. Forward to upstream (force `stream_options.include_usage=true` when streaming), pipe SSE through.
5. On finish compute real cost from usage, write `requests` + `debits`, refund the difference to the same pools. On upstream error, refund all.
6. Headers: `x-ebb-balance` (before), `x-ebb-cost`, `x-ebb-request-id`.

### 5.5 HTTP endpoints
Public:
```
GET  /v1/models
GET  /api/stats                 tide now/next, 24h + all-time granted/used/burned, wallets
GET  /api/tides/:n              one tide's logbook entry
GET  /api/logbook?from=&limit=  paginated, newest first; ?format=csv
GET  /api/soundings             { vault_usdg (on-chain), open_credits, unsettled_used, difference, block, addresses }
GET  /api/grants/:addr/:epoch   { amount, proof[] } — for on-chain verifyGrant
GET  /api/holders?limit=        depth wall (top by balance, tier)
GET  /api/health
```
Key-auth:
```
GET  /v1/key      balance, pools [{epoch, remaining, expires_at}], tier, limits
GET  /v1/usage?from=
```
Wallet session (SIWE → httpOnly session cookie, 24 h):
```
GET  /api/auth/nonce
POST /api/auth/verify    { message, signature } → sets cookie
POST /api/auth/logout
GET  /api/me             addr, tier, balance, pools, keys
POST /api/keys           { label, spend_cap? , parent_id? } → { key } shown once
POST /api/keys/:id/revoke
```
Errors: `{ "error": { "type": "...", "message": "..." } }`. 401 bad key · 402 no credit · 429 rate · 503 settlement halted.

---

## 6. Web (`/apps/web`)

Next.js 15+ App Router, TypeScript, Tailwind v4 (CSS-first `@theme`), `wagmi` + `viem` (injected connector only, no WalletConnect project id needed), `@tanstack/react-query`. API base from `NEXT_PUBLIC_API_URL` (default `http://localhost:8787`).

### 6.1 Visual direction: **nautical chart at night**
- Feel: an Admiralty chart / tide almanac printed on dark paper. Precise, quiet, crafted. Not crypto-neon.
- Palette (dark default, light = day chart paper):
  - `--abyss #07131F` (bg), `--deep #0C2033`, `--shelf #12304A`, `--line #1F4562`
  - `--foam #E9E4D6` (text), `--mist #9FB3C2` (muted)
  - `--brass #C9A24A` (accent, buttons, gauge needles), `--kelp #4FA38A` (positive / granted), `--coral #E0694A` (ebb / burn / warning)
  - light mode: bg `#F3EEDF` chart paper, text `#0C2033`, lines `#B9C7CF`, brass `#9A7424`.
- Type: **Fraunces** (display serif, headings, numerals in hero), **Inter Tight** or **Manrope** (UI), **JetBrains Mono** (coordinates, hashes, figures). Use `font-variant-numeric: tabular-nums` for all figures.
- Motifs: bathymetric contour lines (SVG, subtle, animated drift), depth soundings as small numbers scattered on the bg, a compass rose as the logo mark, rhumb lines, a brass **tide gauge** clock for the epoch countdown, hatched hachures for "the Trench".
- Motion: slow (6–20 s) wave/contour drift; respect `prefers-reduced-motion`. No particle confetti.
- Accessibility: AA contrast, keyboard focus rings in brass, every interactive figure has a text equivalent.

### 6.2 Landing `/` sections
0. **Hero**: wordmark, "Spend it, or the tide takes it.", live tide gauge (UTC clock, tide #, next flood countdown), CA box with copy + explorer/DEX links, two CTAs (Open console, Read the docs), live counters (granted all-time, burned, current tide, chain head block read in-browser).
I. **Undertow** — why: credits nobody uses leak value; two roads (pay out = sell pressure, burn = buy pressure); comparison table Them vs Ebb (include the trust row: "vault is an immutable contract, not a wallet").
II. **Current** — the loop: 8 stations around a circular chart (Inflow → Basin → Split → Tide → Flood → Spend → Ebb → Trench), click a station or autoplay.
III. **Ebb** — one credit's life, drag hour 0→168: water level falls, spent portion turns kelp, expired portion drains coral into the Trench. FIFO / non-transferable / not cash / not revivable.
IV. **Tide tables** — calculator: daily volume, your $EBB, eligible supply %, spend share → printed almanac row (per tide, per day, per week; AI vs burn).
V. **The Trench** — burn path code block with `burnExpired`, the three pipes, burned-so-far counter.
VI. **Depth** — tier ruler (Shore/Reef/Shelf/Abyss) as a depth sounding line; slider "try a bag".
VII. **Charts** — fee split sankey per $100k; treasury split 35/20/15/20/10 (ops, provider float, free demo, growth, reserve).
VIII. **Hull** — architecture cross-section: chain (Pons fee escrow, EbbVault, $EBB pool) / our servers (indexer, allocator, gateway, settlement, keeper, publisher) / outside (holders, model providers). Every arrow labelled with the call.
IX. **Bulkheads** — invariants I1–I8, attack/defence table, security model.
X. **Soundings** — live reserve equation from `/api/soundings`.
XI. **Charted course** — roadmap phases.
Footer: X, GitHub, docs, disclaimer ("not an investment, credits are not cash").

### 6.3 Docs `/docs`
Single long page with sticky TOC: overview, quickstart (SIWE → key → base_url), how credits work (formulas from §1/§5), fees, EbbVault (functions table), burns, logbook & soundings, tiers, token facts, API reference (§5.5), security & anti-gaming, treasury, risks, FAQ, disclaimer.

### 6.4 Console `/app`
Layout with sidebar; wallet connect (injected) → SIWE sign-in with API.
- `/app` overview: balance, tier, tidepools list each with its ebb countdown bar (oldest first), next flood countdown.
- `/app/keys`: create (label, optional spend cap, optional parent = sub-key), shown-once modal with copy, list with prefix, revoke.
- `/app/usage`: per-request table + daily chart.
- `/app/playground`: chat UI streaming from `/v1/chat/completions` with selected key, shows cost per reply.
- `/app/logbook`: receipts table, CSV link, per-tide detail with Merkle root + verify-my-grant button (calls `verifyGrant` on-chain via viem with proof from `/api/grants`).
- `/app/soundings`: reserves equation.
- `/app/depth`: holder wall.
Sandbox banner when API reports `sandbox:true`.
