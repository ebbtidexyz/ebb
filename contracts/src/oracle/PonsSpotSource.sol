// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISpotSource} from "../interfaces/ISpotSource.sol";
import {
    IPonsFactory,
    IPonsCurve,
    IPonsMemeHook,
    PONS_PHASE_NOT_GRADUATED,
    PONS_PHASE_POOL_CREATED
} from "../interfaces/IPons.sol";

interface IExtsload {
    function extsload(bytes32 slot) external view returns (bytes32);
}

/// @title PonsSpotSource
/// @notice Spot price of a pons v2 launch token against its quote asset, read from wherever the token trades right now:
///         the bonding curve's pricing reserves (`getReserves()`, phantom reserve included, pending fees excluded)
///         while the launch is on its curve, and the Uniswap v4 pool's `slot0.sqrtPriceX96` (read from the
///         PoolManager with `extsload`, same slot layout as v4 `StateLibrary`) once it graduated. Reverts while the
///         launch is between venues (Swept) or Rescued, so `PokeTwapOracle.poke()` simply cannot sample then.
///
///         Also reports the pons trade fee of the live venue (`tradeFeeBps`), which `PonsOracle` nets out of quotes:
///         a buy on the curve pays `feeBps + creatorTaxBps` of its input, a v4 swap pays `hookFeeBps + creatorTaxBps`
///         of its (unspecified) output. That is a fee, not slippage, so it must not eat the vault's 3% bound.
/// @dev Feed into `PokeTwapOracle(source = this, base = quoteBase, assets = [token])`. The curve price at graduation
///      equals the pool's opening price (pons seeds the pool from the curve's own reserves), so one TWAP spans both.
contract PonsSpotSource is ISpotSource {
    uint256 private constant BPS = 10_000;
    bytes32 private constant POOLS_SLOT = bytes32(uint256(6)); // v4-core StateLibrary.POOLS_SLOT
    uint256 private constant Q96 = 1 << 96;

    IPonsFactory public immutable factory;
    /// @notice Launch token ($EBB).
    address public immutable token;
    /// @notice Asset the oracle uses for the quote side: WETH for a native-ETH launch, else the pair token.
    address public immutable quoteBase;
    /// @notice The launch's bonding curve.
    address public immutable curve;
    /// @notice Uniswap v4 PoolManager.
    address public immutable poolManager;
    /// @notice pons meme hook.
    address public immutable hook;
    /// @notice v4 pool id of the graduated pool.
    bytes32 public immutable poolId;
    /// @notice true if the token sorts as currency0 in the v4 pool (never for a native-ETH launch).
    bool public immutable tokenIsCurrency0;

    error WrongPair(address base, address asset);
    error NoVenue(uint8 phase);
    error ZeroReserves();

    /// @param pairToken the launch's quote asset as pons records it (`address(0)` = native ETH)
    /// @param weth      used as `quoteBase` when `pairToken == address(0)`
    constructor(
        IPonsFactory factory_,
        address token_,
        address curve_,
        address pairToken,
        address weth,
        int24 tickSpacing,
        uint24 poolFee
    ) {
        factory = factory_;
        token = token_;
        curve = curve_;
        quoteBase = pairToken == address(0) ? weth : pairToken;
        poolManager = factory_.poolManager();
        hook = factory_.memeHook();
        tokenIsCurrency0 = token_ < pairToken; // ETH (0) always sorts first
        (address c0, address c1) = tokenIsCurrency0 ? (token_, pairToken) : (pairToken, token_);
        poolId = keccak256(abi.encode(c0, c1, poolFee, tickSpacing, hook));
    }

    /// @notice pons launch phase (0 curve, 1 swept, 2 v4 pool, 3 rescued).
    function phase() public view returns (uint8) {
        return factory.getLaunchedToken(token).phase;
    }

    /// @inheritdoc ISpotSource
    /// @dev Returns raw `token` units per raw `quoteBase` unit × 1e18.
    function spot(address base, address asset) external view returns (uint256 priceX18) {
        if (base != quoteBase || asset != token) revert WrongPair(base, asset);
        uint8 p = phase();
        if (p == PONS_PHASE_NOT_GRADUATED) {
            (uint256 q, uint256 t) = IPonsCurve(curve).getReserves();
            if (q == 0 || t == 0) revert ZeroReserves();
            return Math.mulDiv(t, 1e18, q);
        }
        if (p == PONS_PHASE_POOL_CREATED) {
            uint256 sqrtP =
                uint160(uint256(IExtsload(poolManager).extsload(keccak256(abi.encodePacked(poolId, POOLS_SLOT)))));
            if (sqrtP == 0) revert ZeroReserves();
            if (!tokenIsCurrency0) {
                // price = currency1 (token) per currency0 (quote) = sqrtP² / 2^192
                return Math.mulDiv(Math.mulDiv(sqrtP, sqrtP, Q96), 1e18, Q96);
            }
            // token is currency0: token per quote = 2^192 / sqrtP²
            return Math.mulDiv(Math.mulDiv(Q96, Q96, sqrtP), 1e18, sqrtP);
        }
        revert NoVenue(p);
    }

    /// @notice Total pons trade fee (bps) a buy of the token pays on the live venue.
    function tradeFeeBps() external view returns (uint256) {
        uint8 p = phase();
        if (p == PONS_PHASE_NOT_GRADUATED) {
            return IPonsCurve(curve).feeBps() + IPonsCurve(curve).creatorTaxBps();
        }
        if (p == PONS_PHASE_POOL_CREATED) {
            // LaunchInfo is 13 static words; creatorTaxBps is word 7, hookFeeBps word 10
            (bool ok, bytes memory ret) = hook.staticcall(abi.encodeCall(IPonsMemeHook.launches, (poolId)));
            if (!ok || ret.length < 13 * 32) revert NoVenue(p);
            uint256 creatorTaxBps;
            uint256 hookFeeBps;
            assembly ("memory-safe") {
                creatorTaxBps := mload(add(ret, add(32, mul(7, 32))))
                hookFeeBps := mload(add(ret, add(32, mul(10, 32))))
            }
            return hookFeeBps + creatorTaxBps;
        }
        revert NoVenue(p);
    }
}
