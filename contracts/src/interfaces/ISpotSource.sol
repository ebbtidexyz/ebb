// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ISpotSource
/// @notice Instantaneous price feed sampled by PokeTwapOracle.
interface ISpotSource {
    /// @return priceX18 raw units of `asset` per raw unit of `base`, scaled by 1e18
    ///         (i.e. `amountAsset = amountBase * priceX18 / 1e18`). MUST be > 0.
    function spot(address base, address asset) external view returns (uint256 priceX18);
}
