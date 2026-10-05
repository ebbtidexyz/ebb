// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IBurnable
/// @notice Optional `burn(uint256)` from caller. EbbVault falls back to a transfer to 0x…dEaD when it is absent.
interface IBurnable {
    function burn(uint256 amount) external;
}
