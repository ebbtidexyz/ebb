// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapAdapter} from "../../src/interfaces/ISwapAdapter.sol";
import {IFeeSource} from "../../src/interfaces/IFeeSource.sol";
import {EbbVault} from "../../src/EbbVault.sol";
import {MockSwapAdapter} from "../../src/mocks/MockSwapAdapter.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";

/// @dev Token with no `burn` function at all.
contract NoBurnToken is ERC20 {
    constructor(address to) ERC20("NoBurn", "NB") {
        _mint(to, 1_000_000_000e18);
    }
}

/// @dev Token whose fallback accepts any call (so `burn` "succeeds" but burns nothing).
contract FallbackToken is ERC20 {
    constructor(address to) ERC20("Fallback", "FB") {
        _mint(to, 1_000_000_000e18);
    }

    fallback() external {}
}

/// @dev Adapter that pulls only part of the approved input.
contract UnderSpendAdapter is ISwapAdapter {
    MockSwapAdapter internal immutable inner;

    constructor(MockSwapAdapter inner_) {
        inner = inner_;
    }

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256, address to)
        external
        payable
        returns (uint256 out)
    {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn / 2);
        // pay full output from own inventory to make the under-spend the only anomaly
        out = inner.previewOut(tokenIn, tokenOut, amountIn);
        IERC20(tokenOut).transfer(to, out);
    }
}

/// @dev Adapter that also pushes USDG back into the vault (balance goes up during a burn).
contract RefundingAdapter is ISwapAdapter {
    MockSwapAdapter internal immutable inner;

    constructor(MockSwapAdapter inner_) {
        inner = inner_;
    }

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256, address to)
        external
        payable
        returns (uint256 out)
    {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).transfer(msg.sender, amountIn); // give it all back
        out = inner.previewOut(tokenIn, tokenOut, amountIn);
        IERC20(tokenOut).transfer(to, out);
    }
}

/// @dev Adapter that tries to re-enter the vault mid-swap with a configurable call.
contract ReentrantAdapter is ISwapAdapter {
    MockSwapAdapter public immutable inner;
    address public target;
    bytes public data;

    constructor(MockSwapAdapter inner_) {
        inner = inner_;
    }

    function arm(address target_, bytes calldata data_) external {
        target = target_;
        data = data_;
    }

    receive() external payable {}

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        payable
        returns (uint256 out)
    {
        if (target != address(0)) {
            (bool ok, bytes memory ret) = target.call(data);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
        // behave like the mock otherwise
        if (tokenIn != address(0)) {
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        }
        out = inner.previewOut(tokenIn, tokenOut, amountIn);
        if (out < minOut) revert("min");
        IERC20(tokenOut).transfer(to, out);
    }
}

/// @dev Fee source that re-enters `harvest()` from `claim()`.
contract ReentrantFeeSource is IFeeSource {
    EbbVault public vault;

    function setVault(EbbVault v) external {
        vault = v;
    }

    function claim() external {
        vault.harvest();
    }
}

/// @dev Oracle wrapper returning a fixed quote (for stress tests).
contract FixedOracle is IPriceOracle {
    uint256 public value;

    function set(uint256 v) external {
        value = v;
    }

    function quote(address, address, uint256) external view returns (uint256) {
        return value;
    }
}
