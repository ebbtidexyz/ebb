// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDG (testnet + tests only)
/// @notice 6-decimal stand-in for Global Dollar (USDG). Anyone can mint — it is worthless by design.
contract MockUSDG is ERC20 {
    constructor() ERC20("Mock Global Dollar", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint `amount` to `to`. Unrestricted: test token.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
