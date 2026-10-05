# Ebb

**$EBB · Spend it, or the tide takes it.** Hold $EBB and trading fees pay for your AI every 30 minutes. Credits left on the shore for seven days are drawn into the Trench: they buy $EBB back and burn it. Robinhood Chain.

`SPEC.md` is the source of truth for every number and word. `apps/web/LANDING.md` is the landing art direction.

## Layout

| path | what |
|---|---|
| `contracts/` | Foundry. `EbbVault` (immutable, ownerless basin), `EbbToken` (testnet), oracle, adapters, mocks, 97 tests incl. invariants I1–I8 |
| `services/api/` | Hono + `node:sqlite` + viem. OpenAI-compatible gateway, SIWE keys, indexer / allocator / keeper / settlement / publisher workers. Sandbox mode needs nothing |
| `apps/web/` | Next.js 16. Landing (GSAP + three.js), `/docs`, console `/app/*` |
| `packages/shared/` | constants, API types, vault ABI |
| `deploy/` | systemd units, nginx, env examples, `deploy.sh` for the VPS |

## Live (testnet)

- Web: https://ebbtide.xyz (landing, `/docs`, console `/app`); www and the old sslip.io names 301 here
- API: https://api.ebbtide.xyz (`/v1` OpenAI-compatible, `/api/*` public)
- VPS `saltbound`: `/opt/ebb`, units `ebb-api` (:8790), `ebb-web` (:3110), `ebb-inflow.timer` (simulated fees every tide, testnet only). Redeploy with `deploy/deploy.sh`.
- Only one API instance may run against a vault at a time (it holds the operator/keeper role). Stop the VPS API before running chain mode locally.
- `services/api/scripts/e2e-testnet.ts` runs SIWE → key → streamed chat → balance → on-chain `verifyGrant` against any deployment.

## Run locally

```bash
npm install
npm run build -w @ebb/shared
npm run dev:api        # :8787 — sandbox; chain-mode env for the testnet is in services/api/.env.testnet (VPS is the live operator)
npm run dev:web        # :3000
cd contracts && forge test
```

## Testnet (Robinhood Chain 46630)

Deployed 2026-10-03 — addresses in `contracts/deployments/46630.json`:

- EbbVault `0x2d7aA8AB158F46c2EA8FA344D05b60B216Bec293`
- EbbToken `0xB2744c634B30F43a69A292f2Bd6b09CE7c6aEe59`
- MockUSDG `0xf11103c3F1aaf97C8CdcC1917a87d5c755ffB899`
- genesis `1790969400` (2026-10-02 19:30 UTC), L2 deploy block `127743092`

Simulate trading-fee inflow on testnet (MockUSDG `mint` is open):

```bash
cast send $USDG 'mint(address,uint256)' $VAULT 50000000 --private-key $PK --rpc-url https://robinhood-sepolia-rpc.publicnode.com
cast send $VAULT 'harvest()' --private-key $PK --rpc-url https://robinhood-sepolia-rpc.publicnode.com
```

The `*.chain.robinhood.com` RPCs are blocked on some ISPs; use publicnode.

## Secrets

`.secrets/` (deployer key, Meshy key) and every `.env*` are git-ignored. Never commit them.

## Before mainnet

- Fork-test `UniswapV4Adapter` + `PokeTwapOracle` against the real PoolManager and the $EBB pool.
- Separate keys: operator ≠ guardian (a multisig), treasury ≠ settlement.
- Set the vault as the launchpad creator-fee recipient from block one.
- Real AI upstream in `services/api/upstreams.json` (e.g. OpenRouter) + provider float.
- Third-party review of `EbbVault`.
