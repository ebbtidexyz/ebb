# Ebb contracts

Foundry project for **EbbVault** ("the Basin") and everything around it. Solidity 0.8.26, OpenZeppelin v5.4,
optimizer on, no via-IR, EVM `cancun`.

Dependencies live in `lib/` and are not committed. Install them once:

```bash
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.4.0 --no-git
forge build && forge test
```
`SPEC.md` §1 and §4 at the repo root are the source of truth; this file explains how the code meets them.

```
src/
  EbbVault.sol                 the vault (immutable, ownerless)
  EbbToken.sol                 testnet $EBB (fixed 1e9 supply, burn)
  interfaces/                  ISwapAdapter, IPriceOracle, IFeeSource, IBurnable, ISpotSource
  oracle/PokeTwapOracle.sol    permissionless poke-based 30-min TWAP
  adapters/UniswapV4Adapter.sol  v4 PoolManager unlock-callback swaps (generic, NOT used on mainnet)
  adapters/PonsSwapAdapter.sol   mainnet adapter: V3 WETH/USDG + pons curve / pons v4 pool (fork-tested)
  oracle/PonsSpotSource.sol, oracle/PonsOracle.sol   mainnet price sources (V3 observe TWAP + poke TWAP)
  EbbLauncher.sol              single-use pons v2 launcher (creator fee recipient = vault)
  mocks/                       MockUSDG, MockOracle, MockSwapAdapter, MockFeeSource, MockSpotSource
script/
  DeployTestnet.s.sol          mocks + token + vault on 46630
  Deploy.s.sol                 generic vault-only deploy from env (superseded for the pons launch)
  EbbMainnetBase.sol, DeployMainnet.s.sol, Launch.s.sol   pons v2 mainnet deploy + launch
  export-abi.mjs               writes packages/shared/src/abi/EbbVault.ts
test/                          unit + fuzz + invariant (test/invariant/)
```

## What each contract does

**EbbVault** holds the USDG that backs AI credit.

| function | who | what |
|---|---|---|
| `receive()` | anyone | accepts ETH (launchpad creator fees) |
| `harvest()` | anyone | `feeSource.claim()` in try/catch → swaps the whole ETH balance to USDG with `minOut = oracle.quote(WETH→USDG) × 97%` → 30% to `treasury`, 70% booked to `currentEpoch()`. USDG paid to the vault directly (e.g. a fee source that pays in USDG, or testnet mints) is split the same way. No-op if there is nothing new. |
| `commitGrants(epoch, root, total, wallets)` | operator | once per tide, only after it ended (`epoch < currentEpoch()`) and before it expired, `total <= booked`. `root` must be non-zero if `total > 0`. |
| `verifyGrant(epoch, wallet, amount, proof)` | view | OZ `MerkleProof` against the committed root |
| `withdrawForUsage(epoch, amount, usageRoot)` | operator | pays the immutable `settlement` address; `withdrawn + amount <= granted`, tide not expired |
| `burnExpired(epoch, maxAmount)` | anyone | from `epochStart + 7d`: takes `min(remaining, maxAmount)`, tips the caller `min(0.25%, $2)`, swaps the rest USDG → ETH → $EBB through the adapter with `minOut = 97% × quote(ETH→EBB, quote(USDG→ETH, x))`, then `token.burn()`; if the token has no working burn the $EBB goes to `0x…dEaD` |
| `freezeOperator()` | guardian | one-way; afterwards no commits and no withdrawals, so everything left burns |
| views | | `currentEpoch()`, `epochStart(e)`, `expiresAt(e)`, `epochs(e)`, `remaining(e)`, `totalOpen()`, `grantLeaf(e, wallet, amount)`, all config + constants |

Epoch math: `currentEpoch = floor((now - genesis) / 1800)` (0 before genesis; anything harvested before genesis
belongs to tide 0). `genesis % 1800 == 0` is enforced in the constructor, so tides start on :00/:30 UTC.
A tide is withdrawable while `now < epochStart + 336·1800` and burnable from that exact second on — the two windows
never overlap.

**Grant leaf** (must match the API's `@openzeppelin/merkle-tree`):
`StandardMerkleTree.of(rows, ["uint256", "address", "uint256"])` with rows `[epoch, wallet, amountMicroUsd]`, i.e.
`leaf = keccak256(bytes.concat(keccak256(abi.encode(epoch, wallet, amount))))`. A vector produced by the JS
library is checked in `test_verifyGrant_ozStandardMerkleTreeVector`.

**Event semantics** worth knowing for indexers:
- `Harvested.usdgOut` = all newly distributed USDG (`toPool + toTreasury`), swap output plus direct transfers.
- `Burned.usdgIn` = the slice taken from the tide **including** the tip (so Σ`usdgIn` = `epochs(e).burned`);
  `usdgIn - tip` was swapped.

**EbbToken** (testnet only): ERC20 "Ebb"/"EBB", 18 dp, 1,000,000,000 minted once to the deployer, `burn(uint256)`,
no owner.

**PokeTwapOracle**: anyone calls `poke()`; each tracked asset (USDG, $EBB) is sampled against WETH from an
`ISpotSource` into a 48-slot ring buffer. Samples are rate-limited to one per `window/12` (150 s) and each one is
clamped to ±`maxStepBps` of the previous, so a flash-manipulated poke moves the 30-min TWAP by at most
`maxStep × 150/1800` (≈0.42% at 500 bps). `quote` reverts if the newest sample is older than 2 × window, or if there
is no sample at least one window old. Big genuine moves make it lag; the vault then fails closed (swaps revert)
rather than selling cheap. Keepers should poke every ~150 s.

**UniswapV4Adapter**: `ISwapAdapter` over a native-ETH/USDG pool and a native-ETH/$EBB pool. USDG → $EBB is two
swaps inside one `unlock`, the intermediate ETH nets to zero in the PoolManager. Exact-input only; a partial fill
reverts. It is tested only against a toy PoolManager (`test/UniswapV4Adapter.t.sol`) — **run a mainnet-fork test
against the real PoolManager and pools before deploying a vault that points at it** (the adapter is immutable in
the vault). If the launchpad pools use WETH instead of native ETH, it needs changes.

**Mocks** (testnet + tests): `MockUSDG` (6 dp, anyone can mint), `MockOracle` (settable USD prices),
`MockSwapAdapter` (fills at oracle price × (1 − slippage), mints MockUSDG when short, must be pre-funded with
$EBB), `MockFeeSource` (pays its ETH/USDG to the caller of `claim()`, can be set to revert), `MockSpotSource`.

## Trust model

Nothing in `EbbVault` can be changed after deployment: no owner, no proxy, no `delegatecall`, no `selfdestruct`,
every address immutable.

| role | can | cannot |
|---|---|---|
| anyone | `harvest`, `burnExpired` (earns ≤ $2 tip), send ETH/USDG in | choose the swap route, price bound, recipients or epoch |
| operator | commit one root per ended tide (`total <= booked`); send up to `granted` of an unexpired tide to `settlement` | re-commit or raise a tide's grants, touch the 30% treasury split, withdraw to any other address, withdraw expired tides, stop burns |
| guardian | `freezeOperator()` once | unfreeze, move funds, anything else |
| treasury / settlement | receive | call anything privileged |
| adapter / oracle (immutable, chosen at deploy) | execute swaps the vault asks for | deliver < 97% of the oracle quote (the vault measures its own balances), pull more USDG than approved (approval is exact and reset to 0), re-enter (all mutating functions are `nonReentrant`) |

Worst case with a compromised operator key: it can send each unexpired tide's still-unwithdrawn `granted` amount
to `settlement` (a fixed address chosen at deploy), and can commit inflated-but-≤-booked grants for tides that are
not committed yet. The guardian freezing the operator stops both; whatever is left then burns.

Invariants (`test/invariant/EbbVault.invariant.t.sol`, handler in `VaultHandler.sol`):

| | asserted as |
|---|---|
| I1 | `usdg.balanceOf(vault) == Σ remaining(e)` (+ USDG transferred in since the last harvest), and `totalOpen == Σ remaining(e)` |
| I2 | `withdrawn ≤ granted ≤ booked` and `withdrawn + burned ≤ booked` for every tide |
| I3 | probe: `burnExpired` on any unexpired tide never succeeds |
| I4 | probe: `withdrawForUsage` on a fully burned tide never succeeds |
| I5 | every `Harvested`: `toPool + toTreasury == usdgOut`, `0 ≤ toPool·3000 − toTreasury·7000 < 10000` (rounding only favours the pool) |
| I6 | probe: harvest and burn with adapter slippage > 3% (adapter's own check disabled) always revert |
| I7 | `totalSupply` drops by exactly `ebbBurned` per burn and cumulatively |
| I8 | treasury / settlement / tip receivers / adapter hold exactly the ghost totals, and USDG is conserved: swap-in + transfers-in = vault + treasury + settlement + tips + burn-swap-in |
| + | probes: committing twice, committing an unended tide, withdrawing more than granted never succeed |

## Test

```sh
cd contracts
forge build
forge test                    # unit + fuzz (1024 runs) + invariants (256 runs × depth 128)
FOUNDRY_PROFILE=ci forge test # invariants at 1024 runs
forge fmt --check
```

## Deploy to Robinhood Chain testnet (46630)

The `*.chain.robinhood.com` RPCs are blocked on this network; use publicnode (already set as `robinhood_testnet` in
`foundry.toml`): `https://robinhood-sepolia-rpc.publicnode.com`. A full deploy costs ≈ 7.4M gas ≈ 0.00015 ETH at
0.02 gwei; testnet ETH: https://faucet.zalalena.com/robinhood (0.0005 ETH per claim).

```sh
cd contracts
# optional: OPERATOR, GUARDIAN, TREASURY, SETTLEMENT (default: deployer), WETH, ETH_USD_X18, EBB_USD_X18, ADAPTER_EBB
# 1) dry run (no transactions; writes deployments/46630.dryrun.json)
forge script script/DeployTestnet.s.sol --rpc-url robinhood_testnet --sender <deployer>
# 2) real deploy (writes deployments/46630.json: every address, genesis, deployBlock)
forge script script/DeployTestnet.s.sol --rpc-url robinhood_testnet --account <keystore> --broadcast
```

Genesis is set to the next :00/:30 boundary after the simulated block. `deployBlock` is the block the script was
simulated at — a safe lower bound for the indexer's `getLogs` start.

Testnet inflow without a launchpad: send ETH to the vault (or to the `feeSource`) and call `harvest()`, or mint
MockUSDG straight to the vault (`MockUSDG.mint(vault, x)`) and call `harvest()` — it books 70% / sends 30%.

## Mainnet: pons v2 launch on Robinhood Chain (4663)

Launch: **2026-10-05 15:00 UTC** (1791212400, `% 1800 == 0`). Pairing decided: **native ETH**, creator tax **200 bps**,
buyback off. **Current plan: runbook B** (creator launches via the Pons UI, then transfers the fee role to the vault). USDG pairing is supported by the same code (`PAIR=usdg`) and fork-tested.

### What pons v2 does with creator fees (from the verified source: factory 0x7eD5…EC7e, exact match)

- Every trade charges the base fee (curve `feeBps` = 100 before graduation, hook `hookFeeBps` = 100 after) plus the
  creator tax (200), both in the quote asset on the curve; on the v4 pool the hook takes them from the swap's
  *unspecified* currency (for an exact-input buy that is $EBB). Base fee split: 30% protocol, 70% creator (buyback is off
  for $EBB, so 0% buyback). The creator tax goes 100% to the creator. With ETH pairing the creator therefore gets
  0.7% + 2% = **2.7% of volume**, paid in ETH.
- Fees are **not** pushed. They sit on the curve (`quoteFeeBalance`, `creatorTaxBalance`) or on the hook (`pendingFees`,
  `pendingCreatorTax`) until a sweep credits `PonsV2FeeEscrow`. Then only the recipient itself can withdraw:
  `claim()` (ETH) / `claimToken(token)` both pay `msg.sender`. Nobody can claim on the vault's behalf, so the vault does it.
  - Before graduation: `curve.sweepFees(min)`, callable by pons' sweep operator **or the creator fee recipient**. The
    creator's call is refused only when a buyback is pending, and buyback is off, so the vault can always sweep.
  - Graduation (`curve.graduate`) sweeps the curve's remaining fees to the escrow automatically.
  - After graduation: `hook.sweepPoolFees(poolId, minConversionQuoteOut, minBuybackTokensOut)`, operator or creator, but
    the creator's call reverts `InternalSwapRequiresOperator` whenever $EBB-denominated fees are pending (every buy
    creates some). **In practice post-graduation fees reach the escrow only when pons' sweep operator
    (0xa1018c…, a contract) sweeps.** The vault tries every harvest and moves on if refused.
- **Who can redirect fees.** The only launch-level role with powers is `creatorFeeRecipient`:
  `factory.transferCreatorFeeRecipient` (instant, future fees), `setBuybackEnabled(true)`, and the creator sweeps above.
  For $EBB it is the immutable `EbbVault`, which has no code path that calls any of these, so **nobody we control
  can redirect fees**. The initiator (`originalDeployer` = `EbbLauncher`) is only recorded (`LaunchedToken.deployer`,
  the token's informational `deployer()`) and snipe-tax-exempt. It has no privileged function anywhere (checked in the
  factory, curve, hook, buyback vault, locker and token). `EbbLauncher` itself can only call `launch()` once.
- **What pons itself can still do** (owner = 2-of-3 Safe 0x263e…19Dd, which is also the protocol fee recipient):
  - **CTO / fee-recipient override:** `setCreatorFeeRecipient(token, x)` emits `CreatorFeeRecipientChangeProposed`.
    Anyone can execute it from 3 days later until 6 days later (`executeCreatorFeeRecipientChange`), and the owner can cancel it.
    It redirects all future creator fees away from the vault. We cannot block it. Monitor that event (3-day notice).
  - Turn buyback **off** (never on). It is already off.
  - Rotate the fee sweep operator, change hook/curve fee policy, launch configs, launch fee, snipe-tax terms and pair
    approvals. **These apply only to future launches.** $EBB's curve and pool snapshot their terms at launch/registration.
  - Rescue paths: `rescueCurveFees` / `rescuePoolFees` pay the creator share directly to the vault (ETH/USDG are then
    booked by `harvest`; a memecoin share would sit idle in the vault as $EBB). There is also
    `forceSweptGraduation` + `rescueSweptGraduation`, but only for a launch that cannot seed its pool for 7 days (phase Rescued).
  - pons v2 audits have **not** closed (docs). Treat it as unaudited.

### Final design

| | ETH pairing (chosen) | USDG pairing (supported) |
|---|---|---|
| fees arrive as | ETH in the escrow | USDG in the escrow |
| `harvest()` | sweep curve → sweep hook (if allowed) → `escrow.claim()` → ETH→USDG on the V3 WETH/USDG fee-100 pool, `minOut` = 97% × V3 `observe()` 30-min TWAP → 70/30 | sweep curve → sweep hook → `escrow.claimToken(USDG)` → 70/30, **no swap, no oracle** |
| `burnExpired()` | USDG→WETH (V3) → unwrap → $EBB on the curve (pre-grad) or v4 pool (post-grad) → `token.burn` | USDG→$EBB on curve / v4 pool → `token.burn` |
| price risk on harvest | ETH/USDG swap (deep pool, TWAP-bound) | none |
| dependencies | V3 pool TWAP + $EBB poke TWAP | $EBB poke TWAP only |

New contracts (all immutable, ownerless):
- `EbbVault` gains immutables `quote` (0 = ETH, or USDG), `feeCurve`, `feeHook`, `feePoolId`. `harvest()` pulls fees
  best-effort (try/catch; targets without code, e.g. the curve before launch, are skipped). A USDG vault rejects ETH.
  All other behaviour and I1–I8 are unchanged.
- `PonsSwapAdapter` (`ISwapAdapter`): `ETH→USDG` via a direct V3 pool swap (no router), `USDG→$EBB` via (V3 + unwrap for ETH
  pairing) + `curve.buy` while phase = NotGraduated, or a PoolManager unlock+swap on the pons v4 pool once phase =
  PoolCreated. Swept/Rescued revert (burn waits). Exact input only. A clamped curve fill (the buy that completes the
  curve) reverts.
- `PonsSpotSource` (`ISpotSource`): $EBB per quote unit from the curve's `getReserves()` before graduation and from v4
  `slot0` via `PoolManager.extsload` after. Pons seeds the pool at the curve's final price, so one TWAP spans both. Also
  reports the live venue's pons trade fee (`feeBps+creatorTaxBps`, or `hookFeeBps+creatorTaxBps`).
- `PonsOracle` (`IPriceOracle`): ETH↔USDG from the V3 pool's `observe([1800,0])` (cardinality 10809 already, nothing to
  increase); $EBB↔quote from `PokeTwapOracle(PonsSpotSource)` **net of the pons trade fee** (3% at 1% + 2%), so the
  vault's 3% bound covers only slippage/manipulation.
- `EbbLauncher`: `launch(params, devBuyQuoteIn)` is callable once, by the EOA that deployed it. It requires
  `creatorFeeRecipient = vault`, the fixed creator tax, buyback off and a non-zero economics pin. It calls
  `factory.launchToken(…, [devBuyRecipient])`, asserts token/curve equal the vault's immutables and that the factory
  record and curve name the vault, then buys from the curve for `devBuyRecipient` **capped at 2% of supply** (larger
  requests are clamped; unspent ETH is refunded to the caller in the same tx).

**Burning before graduation** is enabled and is safe for the same reason the post-graduation burn is: the swap is bounded
at 97% of a poke-TWAP (rate-limited samples, ±5% clamp). On top of that, a sandwich on the curve costs the attacker the
pons fee twice (1% + 2% each way, 6% round trip) on a position that must be large next to the ≥1.68 ETH pricing reserve.
So keep burn slices small (a keeper `maxAmount` of about $50–100) and sandwiching is unprofitable. If a burn would be the
buy that completes the curve, it reverts and waits for the pool.

### Runbook B: launch through the Pons UI, then hand the fees to the vault (current plan)

The creator launches $EBB themselves. We deploy the vault for the existing token, and the creator transfers the creator
fee role to it. Pons function: `PonsV2LaunchFactory.transferCreatorFeeRecipient(address token, address newRecipient)`.
Only the current recipient can call it, it takes effect immediately on the curve or (after graduation) the hook, and it
also moves the buyback-vest beneficiary. Afterwards the creator wallet has **no power left**:
- `transferCreatorFeeRecipient` and `setBuybackEnabled` revert `NotCreatorFeeRecipient` / `NotBuybackController`.
- `curve.sweepFees` reverts `NotFeeSweepOperator`.
- Being the initiator (`LaunchedToken.deployer`, the token's `deployer()`) grants nothing.

All of this is asserted in `test/fork/PonsUiFlow.fork.t.sol`. Pons' own powers listed above still apply.

1. **Pons UI, 2026-10-05 15:00 UTC.** Name, symbol, logo, description and socials (X, Telegram, website) as decided.
   Quote asset **ETH (native)**. Creator tax **2% (200 bps)**. Buyback **off**. Creator fee recipient **= your own
   wallet** (the router rejects zero). Opening buy is optional, but note:
   - **The UI path has no 2% cap.** At the opening price 0.1 ETH buys **≈54.6M $EBB = 5.46% of supply**
     (fork-measured; the buy recipient is snipe-tax exempt).
   - To stay within SPEC's 2%, buy at most **0.0353 ETH**.
2. **Send us the token address immediately.**
3. **We deploy** (any EOA, no role; ≈10.3M gas ≈ 0.0006 ETH, 5 txs):
   ```sh
   cd contracts
   export TOKEN=0x… OPERATOR=0x… GUARDIAN=0x… TREASURY=0x… SETTLEMENT=0x… PAIR=eth CREATOR_TAX_BPS=200   # GENESIS optional
   ALL_PROXY=socks5h://127.0.0.1:1080 forge script script/DeployForToken.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --sender <deployer>   # dry run
   ALL_PROXY=… forge script script/DeployForToken.s.sol --rpc-url … --broadcast --slow   # writes deployments/4663.json
   ```
   The script reads the curve, pair, tax, buyback flag, pool fee, tick spacing and phase from the factory. It refuses
   if the pair is not ETH, the tax is not 200 or buyback is on. It works on the curve and after graduation (it then
   checks the predicted v4 poolId is registered on the hook). It prints the **exact transaction for the creator**:
   `to = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` (pons factory), `value = 0`,
   `data = transferCreatorFeeRecipient(token, vault)`.
4. **Creator sends that transaction from the fee-recipient wallet** (wallet "send data" / explorer write-contract on the
   factory). Then check `getLaunchedToken(token).creatorFeeRecipient == vault` and `buybackEnabled == false`.
5. **Keeper starts:** `pokeTwap.poke()` every ~150 s and `vault.harvest()` periodically.

**Fees earned before the transfer:**
- Fees still **pending on the curve/hook** at transfer time are paid to whoever is recipient when they are swept, so they
  go **to the vault** on its next harvest (fork-tested).
- Fees **already swept/credited to the creator** in the escrow stay the creator's. That happens if the creator or pons'
  operator swept before the transfer, and **at graduation, which sweeps everything to the then-recipient**. To forward
  them, the creator calls `escrow.claim()` on `0xd3AF…Ac9e`, then sends the ETH to the vault with a plain transfer.
  The next `harvest()` swaps it and books it 70/30 like any fee (fork-tested).
- **So transfer as early as possible, ideally minutes after launch and certainly before graduation.**

Risk window: until step 4 the creator wallet controls the fee role. If it enabled buyback before transferring, only
the new recipient (the vault, which never does) could turn it back on or off, apart from pons' owner, who can turn it off.
Check `buybackEnabled == false` after the transfer.

### Runbook A: EbbLauncher (launch from our contract; superseded by runbook B, kept working)

### Deploy + launch sequence (dry-run only so far)

```sh
cd contracts
export PRIVATE_KEY=0x…            # one deployer EOA for BOTH steps; no other tx from it between the 6 CREATEs
export OPERATOR=0x… GUARDIAN=0x… TREASURY=0x… SETTLEMENT=0x… DEV_BUY_RECIPIENT=0x…
export PAIR=eth CREATOR_TAX_BPS=200
export NAME=… SYMBOL=… LOGO=… DESCRIPTION=… X=… TELEGRAM=… WEBSITE=… SALT=0x<32 bytes>   # frozen after step 1
# step 1 (T-few hours): launcher → spot source → poke TWAP → oracle → adapter → vault; writes deployments/4663.json
ALL_PROXY=socks5h://127.0.0.1:1080 forge script script/DeployMainnet.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com            # dry run
ALL_PROXY=socks5h://127.0.0.1:1080 forge script script/DeployMainnet.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast --slow
# step 2 (15:00:00 UTC): re-checks pin, gate and predicted addresses, then launches (fee + dev buy as value)
export DEV_BUY_WEI=100000000000000000
ALL_PROXY=… forge script script/Launch.s.sol --rpc-url … [--broadcast]
# after launch: keeper calls pokeTwap.poke() every ~150 s (needs 30 min of history before the first burn), harvest()
```

Costs measured on a local anvil fork of mainnet: step 1 is 6 txs, 10.42M gas (≈0.0003–0.0006 ETH at 0.03–0.055 gwei).
Step 2 is 1 tx, 3.80M gas, plus the 0.0005 ETH launch fee and the dev buy.

If pons changes the fee policy, launch config or launch deployer between the two steps, the predicted token address no
longer matches. `Launch.s.sol` refuses before sending; `launch()` would revert on the pin / address assert. Re-run
step 1 with a new SALT (≈0.0005 ETH).

Fork tests (real pons v2 + Uniswap contracts):
`ALL_PROXY=socks5h://127.0.0.1:1080 FORK_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-path 'test/fork/*' -vv`.
publicnode forks fail on this pool's storage (pruned "historical state"); use the official RPC through the tunnel.

## ABI

```sh
forge build && node script/export-abi.mjs   # → packages/shared/src/abi/EbbVault.ts (export ebbVaultAbi, as const)
```

## Known limits / risks

- **Sandwiching within the bound.** `harvest` and `burnExpired` are public; an MEV searcher can make each swap
  execute up to 3% below the oracle. Keep swaps small (keeper harvests often, slices burns with `maxAmount`).
- **Oracle quality is the real price guard.** The poke TWAP limits single-sample manipulation but a sustained
  multi-poke manipulation of a thin $EBB pool can drift it (≤5% per 150 s step). Poke from a keeper every interval.
- **Oracle/adapter liveness.** Both are immutable. A stale oracle or a dead pool blocks harvest and burn (funds stay
  safe in the vault, nothing is lost), but they cannot be replaced without deploying a new vault.
- **USDG issuer powers.** USDG is a centrally issued stablecoin; the issuer can freeze the vault address.
- **Settlement timing.** Usage that is not withdrawn before a tide expires burns; the off-chain settlement worker
  must withdraw ahead of `expiresAt(e)`.
- **Fee-on-transfer / rebasing USDG** is not supported (USDG is neither). $EBB with a transfer tax is handled (the
  vault burns what it actually received).
