// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {PokeTwapOracle} from "./PokeTwapOracle.sol";
import {PonsSpotSource} from "./PonsSpotSource.sol";

interface IUniswapV3PoolOracle {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

/// @title PonsOracle
/// @notice EbbVault's `IPriceOracle` on Robinhood Chain mainnet. Two independent price sources:
///         - ETH ↔ USDG: the Uniswap V3 WETH/USDG pool's own `observe()` arithmetic-mean tick over `v3Window`
///           seconds (1800). Not set (address 0) for a USDG-paired launch, which never swaps ETH.
///         - $EBB ↔ quote asset (WETH or USDG): `PokeTwapOracle` fed by `PonsSpotSource` (curve price before
///           graduation, v4 slot0 after), minus the pons trade fee of the live venue (`PonsSpotSource.tradeFeeBps`),
///           so the vault's 3% bound only covers slippage/manipulation and not the fixed launchpad fee.
///         `address(0)` is treated as WETH everywhere. Any other pair reverts.
contract PonsOracle is IPriceOracle {
    uint256 private constant BPS = 10_000;

    /// @notice WETH/USDG Uniswap V3 pool (may be 0 for a USDG-paired launch).
    IUniswapV3PoolOracle public immutable ethUsdgPool;
    address public immutable weth;
    address public immutable usdg;
    /// @notice $EBB.
    address public immutable token;
    /// @notice TWAP of $EBB against `tokenTwap.base()` (the launch's quote asset).
    PokeTwapOracle public immutable tokenTwap;
    /// @notice Venue/fee reader for the launch.
    PonsSpotSource public immutable venue;
    /// @notice V3 TWAP window in seconds.
    uint32 public immutable v3Window;

    error ZeroAddress();
    error BadPool();
    error BadTwap();
    error UnsupportedPair(address tokenIn, address tokenOut);

    constructor(
        IUniswapV3PoolOracle ethUsdgPool_,
        address weth_,
        address usdg_,
        PokeTwapOracle tokenTwap_,
        PonsSpotSource venue_,
        uint32 v3Window_
    ) {
        if (weth_ == address(0) || usdg_ == address(0) || address(tokenTwap_) == address(0)) {
            revert ZeroAddress();
        }
        if (address(venue_) == address(0)) revert ZeroAddress();
        if (address(ethUsdgPool_) != address(0)) {
            address t0 = ethUsdgPool_.token0();
            address t1 = ethUsdgPool_.token1();
            if (!((t0 == weth_ && t1 == usdg_) || (t0 == usdg_ && t1 == weth_))) revert BadPool();
            if (v3Window_ == 0) revert BadPool();
        }
        address token_ = venue_.token();
        if (address(tokenTwap_.source()) != address(venue_) || tokenTwap_.base() != venue_.quoteBase()) {
            revert BadTwap();
        }
        (,, bool tracked) = tokenTwap_.feeds(token_);
        if (!tracked) revert BadTwap();

        ethUsdgPool = ethUsdgPool_;
        weth = weth_;
        usdg = usdg_;
        token = token_;
        tokenTwap = tokenTwap_;
        venue = venue_;
        v3Window = v3Window_;
    }

    /// @inheritdoc IPriceOracle
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        if (tokenIn == address(0)) tokenIn = weth;
        if (tokenOut == address(0)) tokenOut = weth;
        if (tokenIn == tokenOut) return amountIn;

        if (tokenIn == token || tokenOut == token) {
            address other = tokenIn == token ? tokenOut : tokenIn;
            if (other != tokenTwap.base()) revert UnsupportedPair(tokenIn, tokenOut);
            uint256 fair = tokenTwap.quote(tokenIn, tokenOut, amountIn);
            return fair * (BPS - venue.tradeFeeBps()) / BPS;
        }

        if (
            address(ethUsdgPool) != address(0)
                && ((tokenIn == weth && tokenOut == usdg) || (tokenIn == usdg && tokenOut == weth))
        ) {
            return v3Quote(tokenIn, tokenOut, amountIn);
        }
        revert UnsupportedPair(tokenIn, tokenOut);
    }

    /// @notice Arithmetic-mean tick of the V3 pool over the last `v3Window` seconds (rounded toward -inf, as
    ///         Uniswap's OracleLibrary.consult). Reverts ("OLD") if the pool has no observation that old.
    function meanTick() public view returns (int24 tick) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = v3Window;
        (int56[] memory cum,) = ethUsdgPool.observe(ago);
        int56 delta = cum[1] - cum[0];
        int56 w = int56(uint56(v3Window));
        tick = int24(delta / w);
        if (delta < 0 && (delta % w != 0)) tick--;
    }

    /// @notice V3 TWAP quote between WETH and USDG (Uniswap OracleLibrary.getQuoteAtTick).
    function v3Quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(meanTick());
        bool inIsToken0 = tokenIn < tokenOut;
        if (sqrtP <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtP) * sqrtP;
            return inIsToken0 ? Math.mulDiv(ratioX192, amountIn, 1 << 192) : Math.mulDiv(1 << 192, amountIn, ratioX192);
        }
        uint256 ratioX128 = Math.mulDiv(sqrtP, sqrtP, 1 << 64);
        return inIsToken0 ? Math.mulDiv(ratioX128, amountIn, 1 << 128) : Math.mulDiv(1 << 128, amountIn, ratioX128);
    }
}
