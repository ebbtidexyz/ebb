# @ebb/web

Landing (`/`), docs (`/docs`) and console (`/app/*`) for Ebb. Next.js 16 App Router, React 19,
Tailwind v4 (CSS-first tokens in `app/globals.css`), wagmi 3 + viem (injected connector only),
TanStack Query. Constants, API types and the vault ABI come from `@ebb/shared`.

## Run

```sh
# from the repo root
npm run build -w @ebb/shared      # once, so @ebb/shared/dist exists
npm run dev -w @ebb/web           # http://localhost:3000
npm run typecheck -w @ebb/web
npm run build -w @ebb/web && npm run start -w @ebb/web
```

The API (`services/api`, default `http://localhost:8787`) is optional for browsing: every data
view degrades to skeletons / "—" and an explanatory notice when it is down. In development only,
the landing counters and Soundings fall back to clearly labelled fixtures (`lib/fixtures.ts`).

## Environment

Set in `apps/web/.env.local` (all `NEXT_PUBLIC_*`, read at build time):

| var | default | notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8787` | Ebb API base, no trailing slash |
| `NEXT_PUBLIC_CHAIN_ID` | `46630` | `46630` Robinhood Chain testnet, `4663` mainnet |
| `NEXT_PUBLIC_TOKEN_ADDRESS` | unset | $EBB address; the landing shows "Published at launch" until set |
| `NEXT_PUBLIC_VAULT_ADDRESS` | unset | EbbVault; needed for "verify my grant on-chain" in the Logbook |
| `NEXT_PUBLIC_EXPLORER_URL` | Robinhood explorer for the chain | used for address / tx links |
| `NEXT_PUBLIC_DEX_URL` | unset | DEX link in the hero contract box |
| `NEXT_PUBLIC_GITHUB_URL`, `NEXT_PUBLIC_X_URL` | placeholders | footer links |

RPCs (in `lib/chains.ts`): testnet `https://robinhood-sepolia-rpc.publicnode.com`, mainnet
`https://robinhood-rpc.publicnode.com`. The landing reads the chain head in the browser.

## API expectations

- CORS: the API must allow `WEB_ORIGIN` with credentials for `/api/auth/*`, `/api/me`, `/api/keys*`
  (session cookie), and should expose `x-ebb-cost, x-ebb-balance, x-ebb-request-id` via
  `Access-Control-Expose-Headers` so the playground can show per-reply cost. Without the header
  the playground uses a cost in the final SSE chunk (`ebb.cost`) or estimates from `usage` × list price.
- SIWE: `GET /api/auth/nonce` may return `{ nonce }` or plain text. The message is built with
  `viem/siwe` `createSiweMessage` (domain = page host, uri = page origin, 10-minute expiry).
- `POST /api/keys` body: `{ label, spend_cap?: "12.500000", parent_id? }`, response `{ key }`.
- List endpoints (`/api/logbook`, `/api/holders`, `/v1/usage`, `/v1/models`) may return an array or
  `{ items | data | tides | holders | requests: [...] }`.
- `/api/grants/:addr/:tide` → `{ amount, proof }`; `amount` as micro-USD integer or 6-dp decimal.
- Sandbox banner shows when `/api/stats` (or `/api/health`) reports `sandbox: true`.

## Layout

```
app/(site)/page.tsx          landing        components/landing/*
app/(site)/docs/page.tsx     docs           components/docs/toc.tsx
app/app/*                    console        components/console/*
components/site/*            header, footer, compass mark, icons, code block, bathymetry background
lib/                         env, chains, wagmi, api client, queries (react-query hooks), siwe, model maths, formatting
```

Theme: dark "night chart" by default, light "day chart" via `prefers-color-scheme` or the toggle
(stored in `localStorage["ebb-theme"]`, applied before paint). Tokens are CSS variables with the same
names in both themes (`--abyss --deep --shelf --line --foam --mist --brass --kelp --coral`), exposed to
Tailwind as `bg-abyss`, `text-brass-ink`, etc.
