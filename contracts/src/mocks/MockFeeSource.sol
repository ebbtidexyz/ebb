// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFeeSource} from "../interfaces/IFeeSource.sol";

/// @title MockFeeSource (testnet + tests only)
/// @notice Escrow that pays its whole ETH balance (and optionally a USDG balance) to whoever calls `claim()`.
///         Can be told to revert, to check that `EbbVault.harvest` survives a failing fee source.
contract MockFeeSource is IFeeSource {
    IERC20 public immutable usdg;
    bool public shouldRevert;
    uint256 public claims;

    error ClaimFailed();

    constructor(IERC20 usdg_) {
        usdg = usdg_;
    }

    receive() external payable {}

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    /// @inheritdoc IFeeSource
    function claim() external {
        if (shouldRevert) revert ClaimFailed();
        claims++;
        uint256 bal = address(this).balance;
        if (bal != 0) {
            (bool ok,) = msg.sender.call{value: bal}("");
            if (!ok) revert ClaimFailed();
        }
        if (address(usdg) != address(0)) {
            uint256 u = usdg.balanceOf(address(this));
            if (u != 0) usdg.transfer(msg.sender, u);
        }
    }
}
