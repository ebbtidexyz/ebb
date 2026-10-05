// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title EbbToken (testnet only)
/// @notice "Ebb"/"EBB", 18 decimals, 1,000,000,000 supply minted once to the deployer. No owner, no further mint.
///         Anyone can `burn` their own tokens. On mainnet the token comes from the launchpad instead.
contract EbbToken is ERC20 {
    /// @notice Fixed total supply (SPEC §1 `TOTAL_SUPPLY`).
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    /// @param recipient receives the whole supply
    constructor(address recipient) ERC20("Ebb", "EBB") {
        _mint(recipient, TOTAL_SUPPLY);
    }

    /// @notice Destroys `amount` of the caller's tokens, reducing `totalSupply`.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
