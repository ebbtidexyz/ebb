// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey, SwapParams, IPoolManager, IUnlockCallback} from "../../src/adapters/UniswapV4Adapter.sol";

/// @dev Test-only exact-input swapper for a Uniswap v4 pool (stands in for a trader's router in fork tests).
contract V4Trader is IUnlockCallback {
    IPoolManager public immutable pm;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    receive() external payable {}

    function swap(PoolKey memory key, bool zeroForOne, uint256 amountIn) external payable returns (uint256 out) {
        bytes memory r = pm.unlock(abi.encode(key, zeroForOne, amountIn, msg.sender));
        out = abi.decode(r, (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "pm");
        (PoolKey memory key, bool zeroForOne, uint256 amountIn, address user) =
            abi.decode(data, (PoolKey, bool, uint256, address));
        int256 delta = pm.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? 4295128740 : 1461446703485210103287273052203988822378723970341
            }),
            ""
        );
        int128 a0 = int128(delta >> 128);
        int128 a1 = int128(delta);
        (int128 inD, int128 outD) = zeroForOne ? (a0, a1) : (a1, a0);
        uint256 paid = uint256(uint128(-inD));
        uint256 out = uint256(uint128(outD));
        address cin = zeroForOne ? key.currency0 : key.currency1;
        address cout = zeroForOne ? key.currency1 : key.currency0;
        if (cin == address(0)) {
            pm.settle{value: paid}();
        } else {
            pm.sync(cin);
            IERC20(cin).transferFrom(user, address(pm), paid);
            pm.settle();
        }
        pm.take(cout, user, out);
        if (address(this).balance != 0) payable(user).transfer(address(this).balance);
        return abi.encode(out);
    }
}
