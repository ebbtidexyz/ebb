// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ISpotSource} from "../interfaces/ISpotSource.sol";

/// @title MockSpotSource (tests only)
/// @notice Settable spot prices for PokeTwapOracle tests.
contract MockSpotSource is ISpotSource {
    mapping(address base => mapping(address asset => uint256)) public prices;

    function set(address base, address asset, uint256 priceX18) external {
        prices[base][asset] = priceX18;
    }

    /// @inheritdoc ISpotSource
    function spot(address base, address asset) external view returns (uint256) {
        return prices[base][asset];
    }
}
