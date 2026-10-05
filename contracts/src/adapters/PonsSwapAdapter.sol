// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";
import {PoolKey, SwapParams, IPoolManager, IUnlockCallback} from "./UniswapV4Adapter.sol";
import {IPonsFactory, IPonsCurve, PONS_PHASE_NOT_GRADUATED, PONS_PHASE_POOL_CREATED} from "../interfaces/IPons.sol";

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IUniswapV3PoolSwap {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// @title PonsSwapAdapter
/// @notice EbbVault's `ISwapAdapter` for a pons v2 launch on Robinhood Chain. Routes:
///         - `ETH → USDG` (harvest, ETH-paired launch only): wrap to WETH, exact-input swap directly against the
///           Uniswap V3 WETH/USDG pool (no router), output to the vault.
///         - `USDG → $EBB` (burn): for a USDG-paired launch one leg, USDG → $EBB; for an ETH-paired launch USDG → WETH
///           on the V3 pool, unwrap, then ETH → $EBB. The $EBB leg goes to wherever the token trades:
///             * on its pons bonding curve (`curve.buy`) while the launch has not graduated;
///             * in its Uniswap v4 pool (pons meme hook, pool fee 0) once graduated (PoolManager unlock + swap).
///           Any other launch phase (Swept, Rescued) reverts, so the burn fails closed and simply waits.
///         Exact input only: a leg that does not consume its full input (v3/v4 price limit hit, or a curve fill
///         clamped at graduation) reverts. Price protection is the caller's `minOut` (EbbVault: 97% of the oracle
///         quote), re-checked by the vault against its own balances. Holds no funds between transactions.
contract PonsSwapAdapter is ISwapAdapter, IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint160 internal constant MIN_SQRT_PRICE_PLUS_ONE = 4295128740;
    uint160 internal constant MAX_SQRT_PRICE_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    struct Params {
        IPonsFactory factory;
        address token; // $EBB (launch token)
        address curve; // its bonding curve
        address pairToken; // address(0) = native ETH, else USDG
        address usdg;
        address weth;
        address v3Pool; // WETH/USDG V3 pool (required for ETH pairing)
        int24 tickSpacing; // v4 pool tick spacing (launch config)
        uint24 poolFee; // v4 pool fee (0 on pons)
    }

    IPonsFactory public immutable factory;
    address public immutable token;
    address public immutable curve;
    address public immutable pairToken;
    address public immutable usdg;
    address public immutable weth;
    IUniswapV3PoolSwap public immutable v3Pool;
    bool internal immutable v3WethIsToken0;
    IPoolManager public immutable poolManager;
    address public immutable hook;
    int24 internal immutable tickSpacing;
    uint24 internal immutable poolFee;
    bool internal immutable tokenIsCurrency0;

    /// @dev Only the V3 pool we called may call back, and only during our own swap.
    bool private _v3Active;

    error ZeroAddress();
    error BadParams();
    error UnsupportedRoute(address tokenIn, address tokenOut);
    error BadMsgValue();
    error NotPoolManager();
    error NotPool();
    error UnexpectedEth();
    error PartialFill(uint256 consumed, uint256 expected);
    error InsufficientOutput(uint256 out, uint256 minOut);
    error NoVenue(uint8 phase);

    constructor(Params memory p) {
        if (address(p.factory) == address(0) || p.token == address(0) || p.curve == address(0)) revert ZeroAddress();
        if (p.usdg == address(0) || p.weth == address(0)) revert ZeroAddress();
        if (p.pairToken != address(0) && p.pairToken != p.usdg) revert BadParams();
        if (p.pairToken == address(0)) {
            if (p.v3Pool == address(0)) revert ZeroAddress();
            address t0 = IUniswapV3PoolSwap(p.v3Pool).token0();
            address t1 = IUniswapV3PoolSwap(p.v3Pool).token1();
            if (!((t0 == p.weth && t1 == p.usdg) || (t0 == p.usdg && t1 == p.weth))) revert BadParams();
            v3WethIsToken0 = t0 == p.weth;
        }
        factory = p.factory;
        token = p.token;
        curve = p.curve;
        pairToken = p.pairToken;
        usdg = p.usdg;
        weth = p.weth;
        v3Pool = IUniswapV3PoolSwap(p.v3Pool);
        poolManager = IPoolManager(p.factory.poolManager());
        hook = p.factory.memeHook();
        tickSpacing = p.tickSpacing;
        poolFee = p.poolFee;
        tokenIsCurrency0 = p.token < p.pairToken;
    }

    /// @dev ETH arrives only from WETH unwraps and curve refunds (a refund then fails the partial-fill check).
    receive() external payable {
        if (msg.sender != weth && msg.sender != curve) revert UnexpectedEth();
    }

    /// @notice The graduated pool's key: $EBB/quote sorted, pons pool fee, launch tick spacing, pons meme hook.
    function poolKey() public view returns (PoolKey memory k) {
        (address c0, address c1) = tokenIsCurrency0 ? (token, pairToken) : (pairToken, token);
        k = PoolKey(c0, c1, poolFee, tickSpacing, hook);
    }

    /// @inheritdoc ISwapAdapter
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        payable
        nonReentrant
        returns (uint256 out)
    {
        if (amountIn == 0) revert BadParams();
        if (tokenIn == address(0) && tokenOut == usdg && pairToken == address(0)) {
            if (msg.value != amountIn) revert BadMsgValue();
            IWETH9(weth).deposit{value: amountIn}();
            out = _v3Swap(weth, amountIn, to);
        } else if (tokenIn == usdg && tokenOut == token) {
            if (msg.value != 0) revert BadMsgValue();
            IERC20(usdg).safeTransferFrom(msg.sender, address(this), amountIn);
            uint256 quoteAmount = amountIn;
            if (pairToken == address(0)) {
                quoteAmount = _v3Swap(usdg, amountIn, address(this));
                IWETH9(weth).withdraw(quoteAmount);
            }
            out = _buyToken(quoteAmount, to);
        } else {
            revert UnsupportedRoute(tokenIn, tokenOut);
        }
        if (out < minOut) revert InsufficientOutput(out, minOut);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Uniswap V3 leg (WETH <-> USDG)
    // ---------------------------------------------------------------------------------------------------------

    function _v3Swap(address tokenIn, uint256 amountIn, address recipient) internal returns (uint256 out) {
        bool zeroForOne = (tokenIn == weth) == v3WethIsToken0;
        _v3Active = true;
        (int256 a0, int256 a1) = v3Pool.swap(
            recipient,
            zeroForOne,
            amountIn.toInt256(),
            zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE,
            abi.encode(tokenIn)
        );
        _v3Active = false;
        (int256 inDelta, int256 outDelta) = zeroForOne ? (a0, a1) : (a1, a0);
        uint256 consumed = inDelta > 0 ? uint256(inDelta) : 0;
        if (consumed != amountIn) revert PartialFill(consumed, amountIn);
        out = outDelta < 0 ? uint256(-outDelta) : 0;
    }

    /// @notice Uniswap V3 swap callback: pays the pool the input it is owed.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender != address(v3Pool) || !_v3Active) revert NotPool();
        address tokenIn = abi.decode(data, (address));
        uint256 owed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        IERC20(tokenIn).safeTransfer(msg.sender, owed);
    }

    // ---------------------------------------------------------------------------------------------------------
    // $EBB leg (curve before graduation, v4 pool after)
    // ---------------------------------------------------------------------------------------------------------

    function _buyToken(uint256 quoteAmount, address to) internal returns (uint256 out) {
        uint8 phase = factory.getLaunchedToken(token).phase;
        uint256 before = IERC20(token).balanceOf(to);
        if (phase == PONS_PHASE_NOT_GRADUATED) {
            bool native = pairToken == address(0);
            uint256 quoteBefore = native ? address(this).balance : IERC20(pairToken).balanceOf(address(this));
            if (native) {
                IPonsCurve(curve).buy{value: quoteAmount}(quoteAmount, 0, to);
            } else {
                IERC20(pairToken).forceApprove(curve, quoteAmount);
                IPonsCurve(curve).buy(quoteAmount, 0, to);
                IERC20(pairToken).forceApprove(curve, 0);
            }
            uint256 quoteAfter = native ? address(this).balance : IERC20(pairToken).balanceOf(address(this));
            // a clamped fill (the buy that completes the curve) refunds part of the input: fail closed
            uint256 spent = quoteBefore > quoteAfter ? quoteBefore - quoteAfter : 0;
            if (spent != quoteAmount) revert PartialFill(spent, quoteAmount);
        } else if (phase == PONS_PHASE_POOL_CREATED) {
            poolManager.unlock(abi.encode(quoteAmount, to));
        } else {
            revert NoVenue(phase);
        }
        out = IERC20(token).balanceOf(to) - before;
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint256 amountIn, address to) = abi.decode(data, (uint256, address));

        bool zeroForOne = !tokenIsCurrency0; // quote -> token
        int256 delta = poolManager.swap(
            poolKey(),
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -amountIn.toInt256(),
                sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE
            }),
            ""
        );
        int128 amount0 = int128(delta >> 128);
        int128 amount1 = int128(delta);
        (int128 inDelta, int128 outDelta) = zeroForOne ? (amount0, amount1) : (amount1, amount0);
        uint256 consumed = inDelta < 0 ? uint256(uint128(-inDelta)) : 0;
        if (consumed != amountIn) revert PartialFill(consumed, amountIn);
        uint256 out = outDelta > 0 ? uint256(uint128(outDelta)) : 0;

        if (pairToken == address(0)) {
            poolManager.settle{value: amountIn}();
        } else {
            poolManager.sync(pairToken);
            IERC20(pairToken).safeTransfer(address(poolManager), amountIn);
            poolManager.settle();
        }
        if (out != 0) poolManager.take(token, to, out);
        return abi.encode(out);
    }
}
