// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ISpotSource} from "../interfaces/ISpotSource.sol";

/// @title PokeTwapOracle
/// @notice Permissionless time-weighted average price over `window` seconds (SPEC: 1800 s), built from spot samples
///         that anyone records with `poke()`. Every tracked asset is priced against one `base` (WETH; `address(0)`
///         is treated as `base`). Cross quotes (e.g. USDG → $EBB) go through `base`.
///
///         Each feed keeps a ring buffer of `(timestamp, cumulative, price)` observations. Between two pokes the price
///         is held constant, so `cumulative` integrates price × seconds exactly like a Uniswap v2 accumulator. The
///         price recorded at a poke only starts counting *after* that poke, so a manipulation in the block of a
///         `quote` cannot move that quote.
///
///         Defences against cheap (flash) manipulation of the spot source at poke time:
///         - pokes are rate-limited to one per `minInterval` per feed, so a single sample weighs at most
///           `minInterval / window` of a TWAP until the next poke;
///         - each new sample is clamped to ±`maxStepBps` of the previous one, so one manipulated sample can shift
///           the TWAP by at most `maxStepBps × minInterval / window` (500 bps × 150 s / 1800 s ≈ 0.42%).
///         The clamp makes the oracle lag genuine crashes; EbbVault then *fails closed* (swaps revert until the
///         TWAP catches up), it never sells cheap. Keepers should poke every `minInterval`.
///
///         `quote` reverts if the newest sample is older than 2 × window (stale) or if no sample is at least `window`
///         old yet (not enough history).
contract PokeTwapOracle is IPriceOracle {
    struct Observation {
        uint64 timestamp;
        uint256 cumulative; // Σ price × seconds up to `timestamp`
        uint256 price; // priceX18 that holds from `timestamp` on
    }

    struct Feed {
        uint16 index; // slot of the newest observation
        uint16 count; // number of written observations (<= CARDINALITY)
        bool tracked;
    }

    /// @notice Ring buffer size per feed. With `minInterval = window / 12` it spans 4 windows.
    uint16 public constant CARDINALITY = 48;
    uint256 private constant BPS = 10_000;

    ISpotSource public immutable source;
    /// @notice Every asset is priced in units of `base` (WETH).
    address public immutable base;
    /// @notice TWAP length in seconds.
    uint256 public immutable window;
    /// @notice Minimum spacing of samples per feed (`window / 12`).
    uint256 public immutable minInterval;
    /// @notice Max relative change of a new sample vs. the previous one (0 = unclamped).
    uint256 public immutable maxStepBps;

    address[] internal _assets;
    mapping(address asset => Feed) public feeds;
    mapping(address asset => Observation[CARDINALITY]) internal _obs;

    event Poked(address indexed asset, uint256 spot, uint256 recorded, uint256 cumulative);

    error ZeroAddress();
    error BadParams();
    error UnknownAsset(address asset);
    error StalePrice(address asset, uint256 lastUpdate);
    error InsufficientHistory(address asset);
    error ZeroPrice(address asset);

    /// @param source_     spot price feed
    /// @param base_       quote currency for every feed (WETH)
    /// @param assets_     assets to track against `base_` (e.g. USDG, $EBB)
    /// @param window_     TWAP window in seconds (1800)
    /// @param maxStepBps_ per-sample clamp (e.g. 500); 0 disables it
    constructor(ISpotSource source_, address base_, address[] memory assets_, uint256 window_, uint256 maxStepBps_) {
        if (address(source_) == address(0) || base_ == address(0)) revert ZeroAddress();
        if (window_ < 12 || maxStepBps_ >= BPS || assets_.length == 0) revert BadParams();
        source = source_;
        base = base_;
        window = window_;
        minInterval = window_ / 12;
        maxStepBps = maxStepBps_;
        for (uint256 i; i < assets_.length; ++i) {
            address a = assets_[i];
            if (a == address(0) || a == base_) revert ZeroAddress();
            if (feeds[a].tracked) revert BadParams();
            feeds[a].tracked = true;
            _assets.push(a);
        }
    }

    /// @notice Assets tracked against `base`.
    function assets() external view returns (address[] memory) {
        return _assets;
    }

    /// @notice Anyone: record a spot sample for every feed whose last sample is at least `minInterval` old.
    function poke() external {
        for (uint256 i; i < _assets.length; ++i) {
            _poke(_assets[i]);
        }
    }

    /// @notice Newest observation of `asset`.
    function latest(address asset) external view returns (Observation memory) {
        Feed memory f = feeds[asset];
        if (!f.tracked) revert UnknownAsset(asset);
        return _obs[asset][f.index];
    }

    /// @notice TWAP of `asset` per `base` over the last `window` seconds (priceX18, see ISpotSource).
    function twap(address asset) public view returns (uint256) {
        Feed memory f = feeds[asset];
        if (!f.tracked) revert UnknownAsset(asset);
        if (f.count == 0 || block.timestamp < window) revert InsufficientHistory(asset);

        Observation[CARDINALITY] storage obs = _obs[asset];
        Observation memory newest = obs[f.index];
        if (block.timestamp - newest.timestamp > 2 * window) revert StalePrice(asset, newest.timestamp);

        uint256 cumNow = newest.cumulative + newest.price * (block.timestamp - newest.timestamp);
        uint256 target = block.timestamp - window;

        // walk back to the newest observation at or before `target`
        uint256 idx = f.index;
        for (uint256 n; n < f.count; ++n) {
            Observation memory o = obs[idx];
            if (o.timestamp <= target) {
                return (cumNow - o.cumulative) / (block.timestamp - o.timestamp);
            }
            idx = idx == 0 ? CARDINALITY - 1 : idx - 1;
        }
        revert InsufficientHistory(asset);
    }

    /// @inheritdoc IPriceOracle
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        if (tokenIn == address(0)) tokenIn = base;
        if (tokenOut == address(0)) tokenOut = base;
        if (tokenIn == tokenOut) return amountIn;
        if (tokenIn == base) return Math.mulDiv(amountIn, twap(tokenOut), 1e18);
        if (tokenOut == base) return Math.mulDiv(amountIn, 1e18, twap(tokenIn));
        return Math.mulDiv(amountIn, twap(tokenOut), twap(tokenIn));
    }

    function _poke(address asset) internal {
        Feed storage f = feeds[asset];
        uint256 spot = source.spot(base, asset);
        if (spot == 0) revert ZeroPrice(asset);
        Observation[CARDINALITY] storage obs = _obs[asset];

        if (f.count == 0) {
            obs[0] = Observation(uint64(block.timestamp), 0, spot);
            f.count = 1;
            emit Poked(asset, spot, spot, 0);
            return;
        }

        Observation memory last = obs[f.index];
        if (block.timestamp < last.timestamp + minInterval) return; // rate limit: no-op

        uint256 recorded = spot;
        if (maxStepBps != 0) {
            uint256 hi = last.price * (BPS + maxStepBps) / BPS;
            uint256 lo = last.price * (BPS - maxStepBps) / BPS;
            if (recorded > hi) recorded = hi;
            else if (recorded < lo) recorded = lo;
            if (recorded == 0) recorded = 1;
        }

        uint256 cumulative = last.cumulative + last.price * (block.timestamp - last.timestamp);
        uint16 next = f.index + 1 == CARDINALITY ? 0 : f.index + 1;
        obs[next] = Observation(uint64(block.timestamp), cumulative, recorded);
        f.index = next;
        if (f.count < CARDINALITY) f.count++;
        emit Poked(asset, spot, recorded, cumulative);
    }
}
