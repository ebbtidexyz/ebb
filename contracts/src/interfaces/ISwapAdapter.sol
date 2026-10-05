// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ISwapAdapter
/// @notice Exact-input swap entry point used by EbbVault. `tokenIn`/`tokenOut == address(0)` means native ETH.
/// @dev For ERC20 input the adapter pulls `amountIn` from `msg.sender` with `transferFrom` (caller approves first).
///      For native input the caller sends `msg.value == amountIn`. Output is sent to `to`.
///      Implementations MUST revert if fewer than `minOut` units are delivered. EbbVault re-checks this itself
///      against its own balance delta, so a buggy adapter cannot under-deliver silently.
interface ISwapAdapter {
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        payable
        returns (uint256 out);
}
