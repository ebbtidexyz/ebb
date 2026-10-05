# @ebb/api

HTTP API, OpenAI-compatible gateway and background workers for Ebb, all in one Node process
(SPEC.md §5). Node ≥ 22.13, TypeScript, Hono, viem, `node:sqlite`. There are no native modules.

```
src/
  index.ts            boot: env → DB → Basin (chain or sandbox) → workers → HTTP
  config.ts           zod-validated env
  app.ts              Hono app, CORS, error envelope
  context.ts          the Ctx object shared by routes and workers
  db/                 node:sqlite wrapper + migrations (PRAGMA user_version)
  chain/              Robinhood chain defs (4663 / 46630), viem clients, sendTx retries, ChainBasin (EbbVault),
                      pons.ts (Pons v2: mode detection, TWAP poke, pending fees, launch state, fee-recipient events)
  core/               pure logic: twab, allocate (pro-rata), merkle (grant/usage trees), tides, DB records,
                      keeperPlan (poke/harvest/burn scheduling), feeAlerts (creator-fee-recipient alerts)
  gateway/            /v1/chat/completions proxy, FIFO credit ledger, rate limiter, mock upstream, upstreams.json
  auth/               SIWE (viem/siwe), session cookie (HMAC), API keys
  routes/             public, auth/keys, v1
  workers/            indexer, allocator, keeper (+ poke, tide harvest), ponsMonitor, settlement, publisher (+ scheduler)
  sandbox/            simulated world + SandboxBasin
test/                 node:test suites
```

## Run

```bash
# sandbox (default when VAULT_ADDRESS is unset): no keys, no chain, mock model
npm run dev -w @ebb/api            # http://localhost:8787, tsx watch
npm test -w @ebb/api               # node:test
npm run typecheck -w @ebb/api
npm run build -w @ebb/api && npm start -w @ebb/api   # compiled (dist/)
```

The first sandbox boot seeds about 6 hours of history (12 tides), plus 4 tides from just over 7 days
ago that the keeper burns right away, so the Logbook and Trench aren't empty. Delete `data/` to reseed.

Against testnet (chain 46630):

```bash
cd services/api
cat > .env <<EOF
EBB_MODE=chain
CHAIN_ID=46630
RPC_URL=https://robinhood-sepolia-rpc.publicnode.com
VAULT_ADDRESS=0x...            # from contracts/deployments/46630.json
TOKEN_ADDRESS=0x...
DEPLOY_BLOCK=123456
OPERATOR_PRIVATE_KEY=0x...     # must be the vault's operator
KEEPER_PRIVATE_KEY=0x...       # any funded EOA (gas only)
SESSION_SECRET=$(openssl rand -hex 32)
WEB_ORIGIN=http://localhost:3000
SIWE_DOMAIN=localhost:3000
EOF
npm run dev
```

`.env` in the working directory is loaded with Node's built-in `process.loadEnvFile`. Real environment
variables take precedence. If `*.chain.robinhood.com` is blocked on your network, use the publicnode RPCs.

## Environment

| var | default | notes |
|---|---|---|
| `EBB_MODE` | `chain` if `VAULT_ADDRESS` else `sandbox` | |
| `PORT` / `HOST` | `8787` / all interfaces | set `HOST=127.0.0.1` behind nginx |
| `DB_PATH` | `./data/ebb.sqlite` | WAL mode |
| `RPC_URL` | by `CHAIN_ID`: 46630 `https://robinhood-sepolia-rpc.publicnode.com`, 4663 `https://rpc.mainnet.chain.robinhood.com` | |
| `CHAIN_ID` | `46630` | `4663` mainnet, `31337` anvil |
| `VAULT_ADDRESS`, `TOKEN_ADDRESS` | | required in chain mode |
| `USDG_ADDRESS` | `vault.usdg()` | |
| `DEPLOY_BLOCK` | `0` | indexer start block |
| `OPERATOR_PRIVATE_KEY` | | `commitGrants`, `withdrawForUsage`. If unset, tides stay `committing` and nothing becomes spendable (fail closed) |
| `KEEPER_PRIVATE_KEY` | | `harvest`, `burnExpired`, `poke`. If unset, the keeper skips |
| `EXCLUDED_ADDRESSES` | | comma list. The vault, token, USDG, treasury, settlement, `0x0` and `0x…dEaD` are always excluded |
| `UPSTREAMS_JSON` | `./upstreams.json` | falls back to the built-in mock when missing. See `upstreams.example.json` |
| `WEB_ORIGIN` | `http://localhost:3000` | comma list; credentialed CORS + allowed `Origin` for cookie POSTs |
| `SIWE_DOMAIN` | `localhost:3000` | must equal the SIWE message `domain` |
| `SESSION_SECRET` | random, persisted in DB (sandbox only) | required (≥ 32 chars) in chain mode |
| `INDEXER_INTERVAL_MS` / `INDEXER_BATCH_BLOCKS` / `INDEXER_LAG_BLOCKS` | `5000` / `2000` / `3` | |
| `ALLOCATOR_DELAY_S` | `60` | allocation runs at :00/:30 + this |
| `KEEPER_INTERVAL_MS` | `600000` | |
| `KEEPER_HARVEST_MIN_WEI` | `1000000000000000` | legacy (testnet) vaults: harvest only above 0.001 ETH. Ignored in Pons mode |
| `BURN_SLICE_MICRO` | `50000000` | `maxAmount` per `burnExpired` call ($50) |
| `BURN_MAX_SLICES` | `10` | `burnExpired` calls per tide per keeper round. The first failing slice ends that tide for the round |
| `PONS_MODE` | `auto` | `auto`: Pons when the vault answers `quote()`/`feeCurve()` with a non-zero curve. `true` fails boot if it doesn't |
| `POKE_TWAP_ADDRESS` | `vault.oracle().tokenTwap()` | PokeTwapOracle to poke (Pons) |
| `POKE_INTERVAL_MS` | `155000` | min 30000 |
| `HARVEST_OFFSET_S` | `300` | Pons: harvest once per tide at :00/:30 + this |
| `PONS_FACTORY_ADDRESS` | `0x7eD5…EC7e` on 4663 | watched for creator-fee-recipient events |
| `MONITOR_INTERVAL_MS` / `MONITOR_BATCH_BLOCKS` | `60000` / `50000` | |
| `SETTLEMENT_INTERVAL_MS` | `3600000` | |
| `PUBLISHER_INTERVAL_MS` | `30000` | |
| `DEFAULT_MAX_TOKENS` | `1024` | used when a request has no `max_tokens` (shrunk to what the wallet can afford) |
| `SANDBOX_HOLDERS` / `SANDBOX_SEED_TIDES` / `SANDBOX_TICK_MS` | `40` / `12` / `15000` | |
| `SANDBOX_WELCOME_CREDIT` | `2.00` | USD credit given to a wallet on its first sandbox sign-in |
| `LOG_LEVEL` | `info` | |

### upstreams.json

```json
[{ "id": "ebb-mock", "label": "…", "base_url": "mock", "upstream_model": "mock-1",
   "input_per_million": "0.30", "output_per_million": "2.50", "context_window": 131072, "min_tier": "shore" }]
```

`base_url: "mock"` is the built-in streaming mock. Any other value is an OpenAI-compatible base URL
(`…/v1`). The API key comes from `process.env[api_key_env]`, and entries whose env var is unset are
skipped. You can also set `extra_headers` and `disabled`.

## Workers

| worker | schedule | does |
|---|---|---|
| indexer (chain) | every 5 s | `getLogs` on token + vault from the cursor up to `head − 3`. Token `Transfer` → `transfers` + `balance_points`; vault `Harvested` → `harvests` (adds to `epochs.booked`); vault `Burned` → `burns` (epoch state re-read on-chain) |
| sandbox (sandbox) | every 15 s | random buys and sells against a simulated, excluded AMM pool. Three harvests per tide at +10/+20/+30 min, $20–$400 in total. Simulated holders spend credit on the mock model |
| allocator | :00/:30 + 60 s, plus a 60 s catch-up | for each ended tide: wait until the indexer has passed the tide end, read `booked` from the vault, compute TWAB over `[start,end)` from `balance_points`, keep TWAB ≥ 100,000 EBB and not excluded, `floor(booked·twab/Σ)`, build the StandardMerkleTree `(uint256 epoch, address wallet, uint256 amount)`, store the tree dump + grants (`committing`), `commitGrants`, then `committed` (spendable). If a restart happens mid-commit, the on-chain root is checked before resending |
| keeper | every 10 min | refunds stale reservations; legacy vaults: `harvest()` when the vault holds ≥ `KEEPER_HARVEST_MIN_WEI`; for every tide past 7 days up to `BURN_MAX_SLICES` × `burnExpired(e, min(remaining, BURN_SLICE))`, stopping that tide for the round at the first failure |
| poke (Pons) | every 155 s | `PokeTwapOracle.poke()` when a feed's newest sample is ≥ `minInterval` (150 s) old; simulated first |
| harvest (Pons) | checked every minute | `harvest()` once per tide at :05/:35, if any fee source holds something; simulated first; logs the `Harvested` booking |
| pons-monitor (Pons) | every 60 s | factory `CreatorFeeRecipient*` events for our token + factory record check → alerts |
| settlement | hourly | groups settled debits by tide, oldest first. Usage root over `(string request_id, uint256 amount)`, then `withdrawForUsage`. A tx that still fails after 3 attempts sets `settlement_halted`, and `/v1/chat/completions` returns **503** until a later run succeeds. A guardian freeze also halts |
| publisher | every 30 s | marks tides past 7 days `expired`. Receipts are queries |

Sandbox mode runs the exact same allocator, settlement and keeper code. Only the `Basin` (vault
access) differs: `SandboxBasin` vs `ChainBasin`.

## Endpoints

Money is a 6-dp decimal string (micro-dollars internally). $EBB amounts are decimal strings.
Errors look like `{"error":{"type","message"}}`: 401 bad key · 402 `insufficient_credit` / `spend_cap_exceeded`
· 403 `tier_required` · 404 `model_not_found` · 429 `rate_limited` / `concurrency_limited` (+`retry-after`)
· 503 `settlement_halted`.

Public:

| | |
|---|---|
| `GET /v1/models` | OpenAI list + `label`, `upstream_model`, `context_window`, `pricing`, `min_tier` |
| `GET /api/stats` | `StatsResponse` + `pons` (Pons mode, else `null`): `{ phase, curve_progress, pool_id, quote, quote_collected, graduation_threshold, creator_fee_recipient, fee_recipient_is_vault, … }`, on-chain, cached 30 s |
| `GET /api/tides/:n` | `TideEntry` + `receipt_svg` |
| `GET /api/logbook?from=&limit=&format=csv` | `{ entries: TideEntry[], next_from }`, newest first. `from` is a tide number |
| `GET /api/soundings` | `SoundingsResponse` + `expected`, `ungranted`, `awaiting_burn`, `equation`, `fee_recipient_alert` (first active alert or `null`). `vault_usdg` is read on-chain each request (simulated in sandbox) |
| `GET /api/grants/:addr/:epoch` | `{ amount, amount_micro, proof[], root, leaf, verify:{args} }` for `verifyGrant` |
| `GET /api/holders?limit=` | `{ holders:[{rank, addr, balance, tier}], total }` |
| `GET /api/receipts/:n.svg` | logbook card |
| `GET /api/health` | mode, tide, block, indexer progress, worker status, `settlement_halted`, `pons`, `alerts` (active creator-fee-recipient alerts) |

Wallet session (SIWE → `ebb_session` httpOnly SameSite=Lax cookie, 24 h):

| | |
|---|---|
| `GET /api/auth/nonce` | `{ nonce, expires_at, domain, uri, chain_id, statement }`. The nonce is single-use and expires in 10 min |
| `POST /api/auth/verify` | `{ message, signature }` → cookie. Sandbox: a Reef balance + welcome credit |
| `POST /api/auth/logout` | |
| `GET /api/me` | `MeResponse` + `tier_label`, `limits` |
| `POST /api/keys` | `{ label, spend_cap?, parent_id? }` → `{ key, info }`. The key is shown once |
| `POST /api/keys/:id/revoke` | revokes the key and all its sub-keys |

Key auth (`Authorization: Bearer sk-ebb-…`; `/v1/key` and `/v1/usage` also accept the session cookie):

| | |
|---|---|
| `POST /v1/chat/completions` | OpenAI-compatible, `stream` supported |
| `GET /v1/key` | `{ key, addr, tier, limits, balance, pools[] }` |
| `GET /v1/usage?from=&limit=` | `{ data:[{id, model, in_tokens, out_tokens, cost, status, pools[]}], daily[], total_cost }`. `from` is unix seconds or ISO |

Gateway headers: `x-ebb-request-id`, `x-ebb-balance` (credit before the request) and `x-ebb-cost`.
For streams, `x-ebb-cost` is the reserved upper bound (`x-ebb-cost-kind: reserved-max`). The exact cost
arrives in a final SSE chunk before `[DONE]`: `{"choices":[],"ebb":{"cost","balance","request_id",…}}`.
The same values are added as an `ebb` field on non-streaming responses.

Credit flow: estimate `prompt·in + max_tokens·out`, then reserve FIFO from the oldest unexpired pools in
one sqlite transaction. The request is forwarded with `stream_options.include_usage=true`. The real cost
is charged FIFO and the rest is refunded to the same pools. Upstream errors refund everything. If the
client disconnects, it is charged only for the tokens produced so far.

## Mainnet (Pons v2)

Chain 4663, vault deployed by `contracts/script/DeployMainnet.s.sol` (launcher → PonsSpotSource → PokeTwapOracle →
PonsOracle → PonsSwapAdapter → EbbVault), token launched by `Launch.s.sol` at genesis (2026-10-05 15:00 UTC). The
same binary runs testnet and mainnet: Pons mode switches on when the vault has the new views
(`quote()`, `feeCurve()`, `feeHook()`, `feePoolId()`), or with `PONS_MODE=true`.

### Env

Template: [`deploy/env.api.mainnet.example`](../../deploy/env.api.mainnet.example). Generate the chain-derived lines
from the deployment json (no secrets printed):

```bash
cd services/api
npx tsx scripts/mainnet-env-from-deployment.ts            # reads ../../contracts/deployments/4663.json
npx tsx scripts/mainnet-env-from-deployment.ts path/to/4663.dryrun.json
```

RPC: `https://rpc.mainnet.chain.robinhood.com` is reachable directly from the VPS. It also serves `eth_getLogs`
back to `DEPLOY_BLOCK`, which the indexer and monitor need. It is blocked on the dev laptop's ISP. viem uses
Node's `fetch`, which does not speak SOCKS, so `ALL_PROXY=socks5h://…` has no effect on the API. Locally, either use
`RPC_URL=https://robinhood-rpc.publicnode.com` (live reads work, getLogs older than ~1 day is refused without a token),
or an HTTP(S) proxy through Node's built-in support (`NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://…`, Node ≥ 22.21),
or run on the VPS.

**Grant exclusions.** Before graduation the pons **curve** holds the whole unsold supply, so a TWAB pro-rata would hand
it nearly every grant. After graduation the Uniswap v4 **PoolManager** holds the pool's $EBB. Neither may ever receive
grants. In Pons mode the API excludes these itself: vault, token, USDG, treasury, settlement, curve, hook, fee escrow,
swap adapter, oracle, poke TWAP, factory, PoolManager `0x8366…0951`, pons locker `0x2674…4952`, pons buyback vault
`0x42df…219c`, `0x0` and `0x…dEaD`. Keep them in `EXCLUDED_ADDRESSES` as well, so the list is visible and survives a
wrong `PONS_MODE`: vault, launcher, curve, swap adapter, PoolManager, locker, buyback vault, dead/zero (the script
prints the full list). Add CEX or bridge wallets once they are known. The dev-buy recipient is a normal holder.

### What runs, when

| job | cadence | what |
|---|---|---|
| poke | every `POKE_INTERVAL_MS` (155 s) | reads `feeds/latest` and chain time. If a feed is due (≥ 150 s since its last sample), it simulates `poke()` and then sends it. Too soon means a silent skip. A revert (for example, before launch the spot source has no curve) is logged once per distinct reason. The TWAP needs **30 min of samples** before `quote()` works, and it goes stale after 60 min without a poke. **Burns** depend on it. Harvest with the ETH pair prices ETH→USDG from the V3 pool TWAP instead |
| harvest | once per tide at :05 / :35 (`HARVEST_OFFSET_S`) | reads pending fees: curve `quoteFeeBalance + creatorTaxBalance`; hook quote-side pending (only when no $EBB-side fees are pending, since otherwise only pons' operator can sweep); escrow `balanceOf(vault)`; vault ETH; unbooked vault USDG. If everything is 0 it skips. Otherwise it simulates `harvest()`, sends it, and logs the `Harvested` event (`ethIn`, `usdgOut`, `booked` = `toPool`, `toTreasury`). A skip or revert still counts as the tide's attempt. An RPC error retries the next minute |
| keeper | every 10 min | for each tide past 7 days, `burnExpired(e, $50)` up to `BURN_MAX_SLICES` times. The first revert stops that tide until the next round. Burns fail closed before 30 min of TWAP history, in the Swept/Rescued phases, when the price is pushed > 3% off the TWAP, or when a slice would complete the curve |
| pons-monitor | every 60 s | `eth_getLogs` on the factory for `CreatorFeeRecipientChangeProposed / Updated / ChangeCancelled` with topic1 = our token, from `DEPLOY_BLOCK` in 50k-block batches. Plus `getLaunchedToken(token).creatorFeeRecipient == vault` |
| indexer, allocator, settlement, publisher | unchanged | |

Gas (keeper EOA): about 560 pokes, 48 harvests and a few burns per day, all at ~0.01 gwei. 0.01 ETH lasts a long time,
but watch the balance.

### Alerts

pons' owner (2-of-3 Safe) can propose moving $EBB's creator fees away from the vault. The proposal becomes executable
by anyone 3 days later and lapses 6 days later. We cannot block it. The monitor raises:

- `creator_fee_recipient_change_proposed`: active until executed, cancelled or past `expires_at`
- `creator_fee_recipient_changed`: an `Updated` event to a recipient other than the vault (stays until set back)
- `creator_fee_recipient_mismatch`: the factory record does not name the vault

Each one is logged as `ERROR [pons-monitor] ALERT: …`, then re-logged every 30 min while active. It also appears in
`GET /api/health` → `alerts[]` and `GET /api/soundings` → `fee_recipient_alert`. Wire an uptime check to
`jq -e '.alerts | length == 0'`. Event signatures were matched against the factory's bytecode and real mainnet logs
(see `src/chain/abis.ts`).

### Cutover (testnet → mainnet)

On the VPS (`ssh saltbound`) after `DeployMainnet.s.sol --broadcast` (T−hours; the vault must exist so the API can
read `genesis`):

1. `sudo systemctl stop ebb-api && sudo systemctl disable --now ebb-inflow.timer`. The inflow timer mints testnet
   MockUSDG and must never run against mainnet. Keep a copy: `sudo cp /opt/ebb/.env.api /opt/ebb/.env.api.testnet`.
2. Write the new env **before** deploying, because `deploy.sh` restarts `ebb-api` with whatever `/opt/ebb/.env.api`
   holds. Start from `deploy/env.api.mainnet.example` and add the output of
   `npx tsx scripts/mainnet-env-from-deployment.ts`. You can run it on the VPS from `/opt/ebb/services/api` once
   `contracts/deployments/4663.json` is synced, or locally. Then fill in a new `SESSION_SECRET`,
   `OPERATOR_PRIVATE_KEY` (the vault's operator) and `KEEPER_PRIVATE_KEY` (funded EOA). Set
   `DB_PATH=./data/ebb-mainnet.sqlite`: a **new database**, never the testnet sqlite.
   `sudo install -m 600 -o ebb -g ebb env.api.mainnet /opt/ebb/.env.api`.
3. From the laptop, run `deploy/deploy.sh`. It syncs, builds, and restarts `ebb-api` + `ebb-web`. Point
   `/opt/ebb/.env.web` at chain 4663 first (outside this service).
4. `journalctl -u ebb-api -f`. Expect `Pons v2 mode`, `excluded from grants: N` and `listening`. Before launch,
   `poke reverted: …` (once) is normal because the curve has no code yet.
5. Check: `curl -s localhost:8790/api/health | jq '{ok, chain_id, pons, alerts, block}'` and
   `curl -s localhost:8790/api/stats | jq .pons` (`phase: "not_launched"` until 15:00 UTC, then `curve`).
6. After launch: within ~3 min `poked TWAP` appears in the log. Burns can work 30 min later. The first `harvested` log
   comes at the next :05/:35. The first allocation runs at 15:31 UTC for tide 0.

Rollback: stop `ebb-api`, restore `.env.api.testnet` (its DB is untouched), start.

## Quick check

```bash
curl -s localhost:8787/api/stats | jq
curl -s 'localhost:8787/api/logbook?limit=3' | jq '.entries[].tide'
curl -s localhost:8787/api/soundings | jq
curl -N localhost:8787/v1/chat/completions -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"model":"ebb-mock","stream":true,"messages":[{"role":"user","content":"hello"}]}'
```
