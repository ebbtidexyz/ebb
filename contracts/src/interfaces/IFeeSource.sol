// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IFeeSource
/// @notice Launchpad fee escrow. `claim()` pays accrued creator fees (ETH, or USDG) to the caller (EbbVault).
interface IFeeSource {
    function claim() external;
}
