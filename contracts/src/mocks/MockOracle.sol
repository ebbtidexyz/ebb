// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @title MockOracle (testnet + tests only)
/// @notice Settable USD prices. `quote = amountIn * usd(tokenIn) / usd(tokenOut)`, adjusted for decimals.
///         `address(0)` is treated as `eth` (the vault's `weth` key). Anyone can set prices — test contract.
contract MockOracle is IPriceOracle {
    struct Price {
        uint256 usdX18; // USD value of one whole token, 1e18-scaled
        uint8 decimals;
        bool set;
    }

    /// @notice Address that stands for native ETH (quotes for `address(0)` use its price).
    address public immutable eth;
    mapping(address token => Price) public prices;
    /// @notice When true, `quote` reverts (simulates a stale oracle).
    bool public broken;

    error PriceNotSet(address token);
    error OracleBroken();

    event PriceSet(address indexed token, uint256 usdX18, uint8 decimals);

    constructor(address eth_) {
        eth = eth_;
    }

    function setPrice(address token, uint256 usdX18, uint8 decimals) external {
        prices[token] = Price(usdX18, decimals, true);
        emit PriceSet(token, usdX18, decimals);
    }

    function setBroken(bool broken_) external {
        broken = broken_;
    }

    /// @inheritdoc IPriceOracle
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        if (broken) revert OracleBroken();
        if (tokenIn == address(0)) tokenIn = eth;
        if (tokenOut == address(0)) tokenOut = eth;
        if (tokenIn == tokenOut) return amountIn;
        Price memory pIn = prices[tokenIn];
        Price memory pOut = prices[tokenOut];
        if (!pIn.set) revert PriceNotSet(tokenIn);
        if (!pOut.set) revert PriceNotSet(tokenOut);
        // amountIn * pIn * 10^decOut / (pOut * 10^decIn)
        return Math.mulDiv(amountIn, pIn.usdX18 * 10 ** pOut.decimals, pOut.usdX18 * 10 ** pIn.decimals);
    }
}
