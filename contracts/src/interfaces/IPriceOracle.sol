// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IPriceOracle
/// @notice Manipulation-resistant (TWAP) quote: how many raw units of `tokenOut` `amountIn` raw units of `tokenIn`
///         are worth. Implementations should revert rather than return a stale price.
interface IPriceOracle {
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut);
}
