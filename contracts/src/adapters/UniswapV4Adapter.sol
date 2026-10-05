// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// =====================================================================================================================
//  WARNING — NOT YET VALIDATED AGAINST A REAL POOLMANAGER.
//  This adapter compiles and follows the Uniswap v4 unlock/callback flow, but it MUST be exercised in a mainnet-fork
//  test (real PoolManager, the real ETH/USDG and ETH/$EBB pools, their hooks and fees) before an EbbVault is deployed
//  pointing at it. The vault's adapter is immutable: a broken adapter means a vault that can never harvest or burn.
// =====================================================================================================================

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";

/// @dev Minimal, ABI-compatible subset of Uniswap v4 types. `Currency` and `IHooks` are addresses on the wire;
///      `BalanceDelta` is an int256 packing (amount0 << 128 | uint128(amount1)) from the caller's point of view
///      (negative = caller owes the pool manager).
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified; // < 0 = exact input
    uint160 sqrtPriceLimitX96;
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
        external
        returns (int256 swapDelta);
    function sync(address currency) external;
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

/// @title UniswapV4Adapter
/// @notice ISwapAdapter over two native-ETH Uniswap v4 pools: ETH/USDG and ETH/$EBB. Supported routes:
///         ETH ↔ USDG, ETH ↔ $EBB (one hop) and USDG ↔ $EBB (two hops through ETH, netted inside one `unlock`, so
///         no ETH ever leaves the PoolManager in the middle). Exact input only: every hop must consume its full
///         input or the swap reverts (fails closed instead of leaving dust). Swaps are unbounded by price limit;
///         the caller's `minOut` (EbbVault: 97% of the oracle quote) is the protection.
/// @dev Holds no funds between transactions. Pools must use native ETH (currency0 == address(0)); if the launchpad
///      pools use WETH, a different adapter is needed.
contract UniswapV4Adapter is ISwapAdapter, IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint160 internal constant MIN_SQRT_PRICE_PLUS_ONE = 4295128740;
    uint160 internal constant MAX_SQRT_PRICE_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    IPoolManager public immutable poolManager;
    address public immutable usdg;
    address public immutable token;

    // PoolKey fields stored flat as immutables
    uint24 internal immutable usdgFee;
    int24 internal immutable usdgTickSpacing;
    address internal immutable usdgHooks;
    uint24 internal immutable tokenFee;
    int24 internal immutable tokenTickSpacing;
    address internal immutable tokenHooks;

    struct Hop {
        PoolKey key;
        bool zeroForOne;
    }

    struct CallbackData {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        address to;
        Hop[] path;
    }

    error ZeroAddress();
    error NotNativePool();
    error UnsupportedRoute(address tokenIn, address tokenOut);
    error BadMsgValue();
    error NotPoolManager();
    error PartialFill(uint256 consumed, uint256 expected);
    error InsufficientOutput(uint256 out, uint256 minOut);

    /// @param ethUsdg native ETH / USDG pool key (currency0 = address(0), currency1 = usdg)
    /// @param ethToken native ETH / $EBB pool key (currency0 = address(0), currency1 = token)
    constructor(IPoolManager poolManager_, PoolKey memory ethUsdg, PoolKey memory ethToken) {
        if (address(poolManager_) == address(0)) revert ZeroAddress();
        if (ethUsdg.currency0 != address(0) || ethToken.currency0 != address(0)) revert NotNativePool();
        if (ethUsdg.currency1 == address(0) || ethToken.currency1 == address(0)) revert ZeroAddress();
        poolManager = poolManager_;
        usdg = ethUsdg.currency1;
        token = ethToken.currency1;
        usdgFee = ethUsdg.fee;
        usdgTickSpacing = ethUsdg.tickSpacing;
        usdgHooks = ethUsdg.hooks;
        tokenFee = ethToken.fee;
        tokenTickSpacing = ethToken.tickSpacing;
        tokenHooks = ethToken.hooks;
    }

    /// @dev Needed for ETH output routes (PoolManager.take of native ETH lands in `to`, not here; kept for safety).
    receive() external payable {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
    }

    function ethUsdgKey() public view returns (PoolKey memory) {
        return PoolKey(address(0), usdg, usdgFee, usdgTickSpacing, usdgHooks);
    }

    function ethTokenKey() public view returns (PoolKey memory) {
        return PoolKey(address(0), token, tokenFee, tokenTickSpacing, tokenHooks);
    }

    /// @inheritdoc ISwapAdapter
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        payable
        nonReentrant
        returns (uint256 out)
    {
        Hop[] memory path = _route(tokenIn, tokenOut);
        if (tokenIn == address(0)) {
            if (msg.value != amountIn) revert BadMsgValue();
        } else {
            if (msg.value != 0) revert BadMsgValue();
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }
        bytes memory res = poolManager.unlock(abi.encode(CallbackData(tokenIn, tokenOut, amountIn, to, path)));
        out = abi.decode(res, (uint256));
        if (out < minOut) revert InsufficientOutput(out, minOut);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        CallbackData memory d = abi.decode(data, (CallbackData));

        uint256 amount = d.amountIn;
        for (uint256 i; i < d.path.length; ++i) {
            Hop memory h = d.path[i];
            int256 delta = poolManager.swap(
                h.key,
                SwapParams({
                    zeroForOne: h.zeroForOne,
                    amountSpecified: -amount.toInt256(),
                    sqrtPriceLimitX96: h.zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE
                }),
                ""
            );
            int128 amount0 = int128(delta >> 128);
            int128 amount1 = int128(delta);
            int128 inDelta = h.zeroForOne ? amount0 : amount1;
            int128 outDelta = h.zeroForOne ? amount1 : amount0;
            uint256 consumed = inDelta < 0 ? uint256(uint128(-inDelta)) : 0;
            if (consumed != amount) revert PartialFill(consumed, amount);
            amount = outDelta > 0 ? uint256(uint128(outDelta)) : 0;
        }

        // pay the input
        if (d.tokenIn == address(0)) {
            poolManager.settle{value: d.amountIn}();
        } else {
            poolManager.sync(d.tokenIn);
            IERC20(d.tokenIn).safeTransfer(address(poolManager), d.amountIn);
            poolManager.settle();
        }
        // collect the output (intermediate ETH nets to zero inside the PoolManager)
        if (amount != 0) poolManager.take(d.tokenOut, d.to, amount);
        return abi.encode(amount);
    }

    function _route(address tokenIn, address tokenOut) internal view returns (Hop[] memory path) {
        address eth = address(0);
        if (tokenIn == eth && tokenOut == usdg) {
            path = new Hop[](1);
            path[0] = Hop(ethUsdgKey(), true);
        } else if (tokenIn == usdg && tokenOut == eth) {
            path = new Hop[](1);
            path[0] = Hop(ethUsdgKey(), false);
        } else if (tokenIn == eth && tokenOut == token) {
            path = new Hop[](1);
            path[0] = Hop(ethTokenKey(), true);
        } else if (tokenIn == token && tokenOut == eth) {
            path = new Hop[](1);
            path[0] = Hop(ethTokenKey(), false);
        } else if (tokenIn == usdg && tokenOut == token) {
            path = new Hop[](2);
            path[0] = Hop(ethUsdgKey(), false); // USDG -> ETH
            path[1] = Hop(ethTokenKey(), true); // ETH -> $EBB
        } else if (tokenIn == token && tokenOut == usdg) {
            path = new Hop[](2);
            path[0] = Hop(ethTokenKey(), false); // $EBB -> ETH
            path[1] = Hop(ethUsdgKey(), true); // ETH -> USDG
        } else {
            revert UnsupportedRoute(tokenIn, tokenOut);
        }
    }
}
