// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {IFeeSource} from "./interfaces/IFeeSource.sol";
import {IBurnable} from "./interfaces/IBurnable.sol";
import {IPonsCurve, IPonsMemeHook, IPonsFeeEscrow} from "./interfaces/IPons.sol";

/// @title EbbVault — "the Basin"
/// @notice Turns launchpad trading fees into AI credit for $EBB holders, and burns $EBB with every credit that is
///         not spent within 7 days.
///
///         Flow per tide (epoch, 30 min, on :00/:30 UTC):
///         1. `harvest()` (anyone): claims fees, swaps ETH → USDG at an oracle-bounded price (only when the launch
///            is paired with native ETH; a USDG-paired launch pays USDG and needs no swap), sends 30% to the
///            treasury and books 70% to the current tide.
///         2. `commitGrants()` (operator): after the tide ended, commits a Merkle root of per-wallet grants
///            (`total <= booked`). Anyone can check their own grant with `verifyGrant()`.
///         3. `withdrawForUsage()` (operator): while the tide is not expired, pays USDG to the fixed `settlement`
///            address for AI usage, bounded by the tide's committed `granted` total.
///         4. `burnExpired()` (anyone): once the tide is 7 days old, everything left (granted-but-unspent and
///            un-granted dust alike) is swapped USDG → (ETH →) $EBB at an oracle-bounded price and burned.
///
/// @dev Trust model: no owner, no proxy, no upgrade, no `delegatecall`, no `selfdestruct`. Every address and
///      parameter is immutable. The operator can only (a) commit one grant root per ended tide and (b) send at most
///      the committed grant total of an unexpired tide to the immutable `settlement` address. The guardian can only
///      freeze the operator, one-way. USDG can only ever leave this contract to `treasury` (30% of inflow),
///      `settlement` (bounded by grants), the swap adapter (burn path, oracle-bounded), or a burn caller's tip
///      (min(0.25%, $2) of the burned slice).
contract EbbVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // ---------------------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Accounting for one tide. `remaining = booked - withdrawn - burned`.
    /// @param booked     USDG (6 dp) booked to this tide by `harvest()` — final once the tide has ended
    /// @param withdrawn  USDG paid to `settlement` for usage of this tide's grants
    /// @param burned     USDG taken by `burnExpired()` (tip included)
    /// @param grantRoot  Merkle root of `(epoch, wallet, amount)` leaves (OZ StandardMerkleTree encoding)
    /// @param granted    Σ grant amounts in the root; `withdrawn <= granted <= booked`
    /// @param closed     true once grants were committed (exactly once per tide)
    struct Epoch {
        uint128 booked;
        uint128 withdrawn;
        uint128 burned;
        bytes32 grantRoot;
        uint128 granted;
        bool closed;
    }

    /// @notice Constructor parameters (all become immutables).
    struct Config {
        address token;
        address usdg;
        address weth;
        ISwapAdapter swapAdapter;
        IPriceOracle oracle;
        IFeeSource feeSource;
        address treasury;
        address settlement;
        address operator;
        address guardian;
        uint64 genesis;
        // --- launchpad pairing (pons v2 on mainnet; all zero on testnet) ---
        address quote; // asset creator fees arrive in: address(0) = native ETH, or == usdg
        address feeCurve; // pons bonding curve of $EBB (vault is its creator) — swept pre-graduation, may be 0
        address feeHook; // pons meme hook — swept post-graduation, may be 0
        bytes32 feePoolId; // Uniswap v4 pool id of $EBB/quote behind `feeHook`
    }

    // ---------------------------------------------------------------------------------------------------------
    // Constants (SPEC §1)
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Length of one tide in seconds.
    uint256 public constant EPOCH_SECONDS = 1800;
    /// @notice Tides until a tide's credits expire (7 days).
    uint256 public constant EXPIRY_EPOCHS = 336;
    /// @notice Share of harvested USDG booked to the credit pool.
    uint256 public constant POOL_BPS = 7000;
    /// @notice Share of harvested USDG sent to the treasury.
    uint256 public constant TREASURY_BPS = 3000;
    /// @notice Swaps revert if they deliver less than (1 - 3%) of the oracle quote.
    uint256 public constant MAX_DEVIATION_BPS = 300;
    /// @notice Caller tip on `burnExpired`, in bps of the burned slice.
    uint256 public constant CALLER_TIP_BPS = 25;
    /// @notice Caller tip cap: $2 in USDG (6 dp).
    uint256 public constant CALLER_TIP_CAP = 2_000000;
    /// @notice Burn sink used when the token has no working `burn(uint256)`.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 private constant BPS = 10_000;
    uint256 private constant EXPIRY_SECONDS = EPOCH_SECONDS * EXPIRY_EPOCHS;

    // ---------------------------------------------------------------------------------------------------------
    // Immutable configuration
    // ---------------------------------------------------------------------------------------------------------

    /// @notice $EBB.
    address public immutable token;
    /// @notice USDG (6 dp), the credit unit.
    address public immutable usdg;
    /// @notice Address the oracle uses to denote ETH (WETH on mainnet).
    address public immutable weth;
    /// @notice Performs ETH → USDG (harvest) and USDG → ETH → $EBB (burn) swaps.
    ISwapAdapter public immutable swapAdapter;
    /// @notice TWAP quotes that bound every swap.
    IPriceOracle public immutable oracle;
    /// @notice Launchpad fee escrow; `address(0)` if fees are pushed to the vault directly.
    IFeeSource public immutable feeSource;
    /// @notice Receives 30% of every harvest.
    address public immutable treasury;
    /// @notice Only destination of `withdrawForUsage` (pays the model providers).
    address public immutable settlement;
    /// @notice Allocator + settlement key: commits grant roots, withdraws for usage.
    address public immutable operator;
    /// @notice Can only call `freezeOperator()`.
    address public immutable guardian;
    /// @notice Start of tide 0 (unix seconds, multiple of 1800 → :00 or :30 UTC).
    uint64 public immutable genesis;
    /// @notice Asset the launchpad pays creator fees in: `address(0)` (native ETH, swapped to USDG on harvest) or
    ///         `usdg` (booked directly, no swap, no oracle).
    address public immutable quote;
    /// @notice pons v2 bonding curve of $EBB; `harvest()` sweeps its creator fees into the escrow while the token is
    ///         still on the curve (the vault is the curve's creator fee recipient). `address(0)` = none.
    address public immutable feeCurve;
    /// @notice pons v2 meme hook; `harvest()` tries to sweep the v4 pool's quote-denominated fees after graduation.
    address public immutable feeHook;
    /// @notice Uniswap v4 pool id of the graduated $EBB pool (key: $EBB/quote, fee 0, pons hook).
    bytes32 public immutable feePoolId;

    // ---------------------------------------------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Per-tide accounting.
    mapping(uint256 epoch => Epoch) public epochs;
    /// @notice Σ remaining(e) over all tides — the USDG the vault owes to credits or to the Trench.
    uint256 public totalOpen;
    /// @notice Set once by the guardian; afterwards the operator can do nothing.
    bool public operatorFrozen;

    // ---------------------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------------------

    /// @notice `usdgOut` is all new USDG distributed by this harvest (swap output plus any USDG paid to the vault
    ///         directly since the last harvest). `usdgOut == toPool + toTreasury`.
    event Harvested(uint256 indexed epoch, uint256 ethIn, uint256 usdgOut, uint256 toPool, uint256 toTreasury);
    event GrantsCommitted(uint256 indexed epoch, bytes32 root, uint128 total, uint32 wallets);
    event UsageWithdrawn(uint256 indexed epoch, uint128 amount, bytes32 usageRoot);
    /// @notice `usdgIn` is the slice taken from the tide (tip included); `usdgIn - tip` was swapped.
    event Burned(uint256 indexed epoch, uint256 usdgIn, uint256 ebbBurned, address indexed caller, uint256 tip);
    event OperatorFrozen();

    // ---------------------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------------------

    error ZeroAddress();
    error GenesisNotAligned(uint64 genesis);
    error SameToken();
    error NotOperator();
    error NotGuardian();
    error OperatorIsFrozen();
    error EpochNotEnded(uint256 epoch);
    error EpochExpired(uint256 epoch);
    error EpochNotExpired(uint256 epoch, uint256 expiresAt);
    error AlreadyCommitted(uint256 epoch);
    error GrantsExceedBooked(uint256 total, uint256 booked);
    error EmptyRoot();
    error ZeroAmount();
    error ExceedsGranted(uint256 requested, uint256 available);
    error NothingToBurn(uint256 epoch);
    error SlippageExceeded(uint256 received, uint256 minOut);
    error AdapterSpendMismatch(uint256 spent, uint256 expected);
    error BadQuote(address quote);
    error EthNotAccepted();

    // ---------------------------------------------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------------------------------------------

    /// @param c Immutable configuration. `feeSource`, `quote`, `feeCurve`, `feeHook` may be zero; every other address
    ///          must be non-zero. `quote` must be `address(0)` (native ETH) or `usdg`.
    constructor(Config memory c) {
        if (
            c.token == address(0) || c.usdg == address(0) || c.weth == address(0)
                || address(c.swapAdapter) == address(0) || address(c.oracle) == address(0) || c.treasury == address(0)
                || c.settlement == address(0) || c.operator == address(0) || c.guardian == address(0)
        ) revert ZeroAddress();
        if (c.token == c.usdg) revert SameToken();
        if (c.genesis % EPOCH_SECONDS != 0) revert GenesisNotAligned(c.genesis);
        if (c.quote != address(0) && c.quote != c.usdg) revert BadQuote(c.quote);

        token = c.token;
        usdg = c.usdg;
        weth = c.weth;
        swapAdapter = c.swapAdapter;
        oracle = c.oracle;
        feeSource = c.feeSource;
        treasury = c.treasury;
        settlement = c.settlement;
        operator = c.operator;
        guardian = c.guardian;
        genesis = c.genesis;
        quote = c.quote;
        feeCurve = c.feeCurve;
        feeHook = c.feeHook;
        feePoolId = c.feePoolId;
    }

    /// @notice Accepts ETH when the launch is ETH-paired (creator fees are paid in ETH). A USDG-paired vault rejects
    ///         ETH, since it never swaps it (a forced send would just sit idle).
    receive() external payable {
        if (quote != address(0)) revert EthNotAccepted();
    }

    // ---------------------------------------------------------------------------------------------------------
    // Inflow
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Anyone: pull creator fees, swap all ETH → USDG (oracle-bounded; ETH pairing only), 30% → treasury,
    ///         70% → current tide.
    /// @dev No-op if there is neither ETH nor unbooked USDG. Every fee pull is best-effort (try/catch, skipped while
    ///      the target has no code), so a failing launchpad call can never block harvesting. Pull order:
    ///      1. `feeCurve.sweepFees(0)` — pre-graduation, credits the curve's pending creator fees to the escrow. The
    ///         vault is the curve's creator; with buyback disabled no internal swap runs, so no price is chosen here.
    ///      2. `feeHook.sweepPoolFees(feePoolId, 0, 0)` — post-graduation; succeeds only when no memecoin conversion
    ///         is pending (otherwise pons' sweep operator must sweep).
    ///      3. escrow claim — `claim()` (ETH) or `claimToken(usdg)`; the escrow pays `msg.sender`, i.e. this vault.
    ///      Any USDG sent to the vault directly (not booked yet) is distributed by the same 70/30 split, so the vault
    ///      never holds unaccounted USDG after a harvest (I1).
    function harvest() external nonReentrant {
        _pullFees();

        uint256 epoch = currentEpoch();
        IERC20 usdg_ = IERC20(usdg);
        uint256 ethIn = quote == address(0) ? address(this).balance : 0;

        if (ethIn != 0) {
            uint256 minOut = _minOut(oracle.quote(weth, usdg, ethIn));
            uint256 before = usdg_.balanceOf(address(this));
            swapAdapter.swapExactIn{value: ethIn}(address(0), usdg, ethIn, minOut, address(this));
            uint256 afterBal = usdg_.balanceOf(address(this));
            uint256 received = afterBal > before ? afterBal - before : 0;
            if (received < minOut) revert SlippageExceeded(received, minOut);
        }

        uint256 balance = usdg_.balanceOf(address(this));
        uint256 open = totalOpen;
        if (balance <= open) return;

        uint256 usdgOut = balance - open;
        uint256 toTreasury = usdgOut * TREASURY_BPS / BPS; // rounds down: dust goes to the pool
        uint256 toPool = usdgOut - toTreasury;

        epochs[epoch].booked += toPool.toUint128();
        totalOpen = open + toPool;

        if (toTreasury != 0) usdg_.safeTransfer(treasury, toTreasury);
        emit Harvested(epoch, ethIn, usdgOut, toPool, toTreasury);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Operator
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Operator: commit the grant Merkle root of an ended, unexpired tide. Exactly once per tide.
    /// @dev Leaf = keccak256(bytes.concat(keccak256(abi.encode(uint256 epoch, address wallet, uint256 amount)))).
    ///      `booked - total` (pro-rata rounding dust, excluded holders) stays in the tide and burns at expiry.
    /// @param epoch   tide number, must be `< currentEpoch()` so `booked` is final
    /// @param root    Merkle root; must be non-zero when `total > 0`
    /// @param total   Σ amounts in the tree (USDG, 6 dp), `<= booked`
    /// @param wallets number of leaves (informational, for indexers)
    function commitGrants(uint256 epoch, bytes32 root, uint128 total, uint32 wallets) external {
        _checkOperator();
        if (epoch >= currentEpoch()) revert EpochNotEnded(epoch);
        if (_isExpired(epoch)) revert EpochExpired(epoch);
        Epoch storage e = epochs[epoch];
        if (e.closed) revert AlreadyCommitted(epoch);
        if (total > e.booked) revert GrantsExceedBooked(total, e.booked);
        if (total != 0 && root == bytes32(0)) revert EmptyRoot();

        e.grantRoot = root;
        e.granted = total;
        e.closed = true;
        emit GrantsCommitted(epoch, root, total, wallets);
    }

    /// @notice Operator: pay `amount` of a tide's granted credit to `settlement` for AI usage.
    /// @dev Oldest-first spending is enforced off-chain; on-chain the bound is `withdrawn + amount <= granted` and
    ///      the tide must not be expired (so it can never race `burnExpired`).
    /// @param usageRoot Merkle root over the settled `(request_id, cost_micro)` pairs (informational)
    function withdrawForUsage(uint256 epoch, uint128 amount, bytes32 usageRoot) external nonReentrant {
        _checkOperator();
        if (amount == 0) revert ZeroAmount();
        if (_isExpired(epoch)) revert EpochExpired(epoch);
        Epoch storage e = epochs[epoch];
        uint256 withdrawn = uint256(e.withdrawn) + amount;
        if (withdrawn > e.granted) revert ExceedsGranted(amount, e.granted - e.withdrawn);

        // casting to 'uint128' is safe because withdrawn <= granted, a uint128
        // forge-lint: disable-next-line(unsafe-typecast)
        e.withdrawn = uint128(withdrawn);
        totalOpen -= amount;

        IERC20(usdg).safeTransfer(settlement, amount);
        emit UsageWithdrawn(epoch, amount, usageRoot);
    }

    // ---------------------------------------------------------------------------------------------------------
    // The Trench
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Anyone: burn up to `maxAmount` USDG of an expired tide. The caller earns min(0.25%, $2) of the slice;
    ///         the rest is swapped USDG → ETH → $EBB through the adapter (bounded at 97% of the oracle quote of the
    ///         full route) and the $EBB is burned (`token.burn`, else sent to 0x…dEaD).
    /// @dev `maxAmount` lets keepers slice large tides when pools are thin.
    function burnExpired(uint256 epoch, uint128 maxAmount) external nonReentrant {
        uint256 expiry = expiresAt(epoch);
        if (block.timestamp < expiry) revert EpochNotExpired(epoch, expiry);

        Epoch storage e = epochs[epoch];
        uint256 rem = uint256(e.booked) - e.withdrawn - e.burned;
        uint256 amount = rem < maxAmount ? rem : maxAmount;
        if (amount == 0) revert NothingToBurn(epoch);

        // effects first
        // casting to 'uint128' is safe because amount <= remaining <= booked, a uint128
        // forge-lint: disable-next-line(unsafe-typecast)
        e.burned += uint128(amount);
        totalOpen -= amount;

        uint256 tip = amount * CALLER_TIP_BPS / BPS;
        if (tip > CALLER_TIP_CAP) tip = CALLER_TIP_CAP;
        uint256 swapIn = amount - tip; // > 0 since tip < amount

        uint256 ebbOut = _swapUsdgToToken(swapIn);
        _burnToken(ebbOut);

        if (tip != 0) IERC20(usdg).safeTransfer(msg.sender, tip);
        emit Burned(epoch, amount, ebbOut, msg.sender, tip);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Guardian
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Guardian: permanently disable the operator. No more grant commits or usage withdrawals; everything
    ///         left in the vault burns as tides expire.
    function freezeOperator() external {
        if (msg.sender != guardian) revert NotGuardian();
        if (operatorFrozen) revert OperatorIsFrozen();
        operatorFrozen = true;
        emit OperatorFrozen();
    }

    // ---------------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------------

    /// @notice Tide number at `block.timestamp` (0 before genesis).
    function currentEpoch() public view returns (uint256) {
        if (block.timestamp < genesis) return 0;
        return (block.timestamp - genesis) / EPOCH_SECONDS;
    }

    /// @notice Unix start of tide `epoch`.
    function epochStart(uint256 epoch) public view returns (uint256) {
        return uint256(genesis) + epoch * EPOCH_SECONDS;
    }

    /// @notice Unix time from which tide `epoch` can be burned and no longer withdrawn (`epochStart + 7 days`).
    function expiresAt(uint256 epoch) public view returns (uint256) {
        return epochStart(epoch) + EXPIRY_SECONDS;
    }

    /// @notice USDG still held for tide `epoch`: `booked - withdrawn - burned`.
    function remaining(uint256 epoch) external view returns (uint256) {
        Epoch storage e = epochs[epoch];
        return uint256(e.booked) - e.withdrawn - e.burned;
    }

    /// @notice True iff `(wallet, amount)` is a leaf of tide `epoch`'s committed grant root.
    function verifyGrant(uint256 epoch, address wallet, uint256 amount, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        Epoch storage e = epochs[epoch];
        if (!e.closed || e.grantRoot == bytes32(0)) return false;
        return MerkleProof.verifyCalldata(proof, e.grantRoot, grantLeaf(epoch, wallet, amount));
    }

    /// @notice The Merkle leaf for a grant (OZ StandardMerkleTree, types `["uint256","address","uint256"]`).
    function grantLeaf(uint256 epoch, address wallet, uint256 amount) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(epoch, wallet, amount))));
    }

    // ---------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------

    /// @dev Best-effort fee pulls (see `harvest`). Calls to addresses without code are skipped: Solidity would
    ///      otherwise revert outside the try (e.g. the curve before the launch transaction).
    function _pullFees() internal {
        address curve_ = feeCurve;
        if (curve_ != address(0) && curve_.code.length != 0) {
            try IPonsCurve(curve_).sweepFees(0) {} catch {}
        }
        address hook_ = feeHook;
        if (hook_ != address(0) && hook_.code.length != 0) {
            try IPonsMemeHook(hook_).sweepPoolFees(feePoolId, 0, 0) {} catch {}
        }
        address source = address(feeSource);
        if (source != address(0) && source.code.length != 0) {
            if (quote == address(0)) {
                try feeSource.claim() {} catch {}
            } else {
                try IPonsFeeEscrow(source).claimToken(usdg) {} catch {}
            }
        }
    }

    function _checkOperator() internal view {
        if (msg.sender != operator) revert NotOperator();
        if (operatorFrozen) revert OperatorIsFrozen();
    }

    function _isExpired(uint256 epoch) internal view returns (bool) {
        return block.timestamp >= expiresAt(epoch);
    }

    function _minOut(uint256 quoted) internal pure returns (uint256) {
        return quoted * (BPS - MAX_DEVIATION_BPS) / BPS;
    }

    /// @dev Swaps exactly `amountIn` USDG for $EBB: along USDG → ETH → $EBB for an ETH-paired launch (bound: oracle
    ///      quote of the full route, USDG→ETH then ETH→$EBB, minus 3%), or directly USDG → $EBB for a USDG-paired
    ///      launch (bound: oracle quote USDG→$EBB minus 3%). The adapter must consume exactly `amountIn` (anything else
    ///      would leave unaccounted USDG behind) and the vault measures what it actually received.
    function _swapUsdgToToken(uint256 amountIn) internal returns (uint256 received) {
        IERC20 usdg_ = IERC20(usdg);
        IERC20 token_ = IERC20(token);

        uint256 minOut = quote == address(0)
            ? _minOut(oracle.quote(weth, token, oracle.quote(usdg, weth, amountIn)))
            : _minOut(oracle.quote(usdg, token, amountIn));

        uint256 usdgBefore = usdg_.balanceOf(address(this));
        uint256 tokenBefore = token_.balanceOf(address(this));

        usdg_.forceApprove(address(swapAdapter), amountIn);
        swapAdapter.swapExactIn(usdg, token, amountIn, minOut, address(this));
        usdg_.forceApprove(address(swapAdapter), 0);

        uint256 usdgAfter = usdg_.balanceOf(address(this));
        uint256 spent = usdgBefore > usdgAfter ? usdgBefore - usdgAfter : 0;
        if (spent != amountIn || usdgAfter > usdgBefore) revert AdapterSpendMismatch(spent, amountIn);

        uint256 tokenAfter = token_.balanceOf(address(this));
        received = tokenAfter > tokenBefore ? tokenAfter - tokenBefore : 0;
        if (received < minOut) revert SlippageExceeded(received, minOut);
    }

    /// @dev Burns `amount` $EBB held by the vault: `token.burn(amount)` if it exists and actually removes the
    ///      tokens, otherwise (or for whatever it did not remove) a transfer to 0x…dEaD.
    function _burnToken(uint256 amount) internal {
        if (amount == 0) return;
        IERC20 token_ = IERC20(token);
        uint256 before = token_.balanceOf(address(this));
        try IBurnable(token).burn(amount) {} catch {}
        uint256 afterBal = token_.balanceOf(address(this));
        uint256 gone = before > afterBal ? before - afterBal : 0;
        if (gone < amount) token_.safeTransfer(DEAD, amount - gone);
    }
}
