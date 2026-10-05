// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @title MockSwapAdapter (testnet + tests only)
/// @notice Swaps at `oracle.quote × (1 − slippageBps)`. Pays out of its own inventory; if the inventory of an
///         ERC20 is short it tries `mint()` (works for MockUSDG), so ETH → USDG never runs dry on testnet. $EBB has
///         a fixed supply, so the adapter must be pre-funded with $EBB for the burn path; ETH output likewise needs
///         ETH inventory. Multi-hop routes (USDG → ETH → $EBB) are settled directly at the composite oracle price.
///         Anyone can change the knobs — test contract.
contract MockSwapAdapter is ISwapAdapter {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    IPriceOracle public immutable oracle;
    /// @notice Haircut applied to the oracle quote, in bps (0 = perfect execution).
    uint256 public slippageBps;
    /// @notice If false, the adapter does not check `minOut` (lets tests exercise the vault's own check).
    bool public enforceMinOut = true;

    /// @notice Cumulative amounts pulled in / paid out per token (`address(0)` = ETH).
    mapping(address token => uint256) public totalIn;
    mapping(address token => uint256) public totalOut;

    error BadMsgValue();
    error InsufficientOutput(uint256 out, uint256 minOut);
    error InsufficientInventory(address token, uint256 needed, uint256 available);
    error SlippageTooHigh();

    event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address to);

    constructor(IPriceOracle oracle_) {
        oracle = oracle_;
    }

    receive() external payable {}

    function setSlippageBps(uint256 bps) external {
        if (bps > BPS) revert SlippageTooHigh();
        slippageBps = bps;
    }

    function setEnforceMinOut(bool v) external {
        enforceMinOut = v;
    }

    /// @notice What `swapExactIn` would pay for `amountIn`.
    function previewOut(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        return oracle.quote(tokenIn, tokenOut, amountIn) * (BPS - slippageBps) / BPS;
    }

    /// @inheritdoc ISwapAdapter
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        payable
        returns (uint256 out)
    {
        if (tokenIn == address(0)) {
            if (msg.value != amountIn) revert BadMsgValue();
        } else {
            if (msg.value != 0) revert BadMsgValue();
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }
        totalIn[tokenIn] += amountIn;

        out = previewOut(tokenIn, tokenOut, amountIn);
        if (enforceMinOut && out < minOut) revert InsufficientOutput(out, minOut);
        totalOut[tokenOut] += out;

        if (tokenOut == address(0)) {
            if (address(this).balance < out) revert InsufficientInventory(tokenOut, out, address(this).balance);
            (bool ok,) = to.call{value: out}("");
            require(ok, "ETH transfer failed");
        } else {
            uint256 bal = IERC20(tokenOut).balanceOf(address(this));
            if (bal < out) {
                try IMintable(tokenOut).mint(address(this), out - bal) {}
                catch {
                    revert InsufficientInventory(tokenOut, out, bal);
                }
            }
            IERC20(tokenOut).safeTransfer(to, out);
        }
        emit Swapped(tokenIn, tokenOut, amountIn, out, to);
    }
}
