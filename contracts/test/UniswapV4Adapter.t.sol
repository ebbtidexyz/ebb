// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    UniswapV4Adapter,
    IPoolManager,
    IUnlockCallback,
    PoolKey,
    SwapParams
} from "../src/adapters/UniswapV4Adapter.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {EbbToken} from "../src/EbbToken.sol";

/// @dev Toy PoolManager with v4-style flash accounting (per-currency deltas that must net to zero by the end of
///      `unlock`) and fixed-rate pools. This checks the adapter's sign conventions and settle/take sequencing only;
///      the real PoolManager still needs a mainnet-fork test.
contract FakePoolManager is IPoolManager {
    mapping(address => int256) public delta; // + = owed to the unlocker
    mapping(address => uint256) public rate; // currency1 per 1e18 ETH
    address internal synced;
    uint256 internal syncedBal;
    bool internal unlocked;
    uint256 public partialBps; // if > 0, consume only this share of input (simulate price-limit partial fill)

    receive() external payable {}

    function setRate(address c1, uint256 r) external {
        rate[c1] = r;
    }

    function setPartial(uint256 bps) external {
        partialBps = bps;
    }

    function unlock(bytes calldata data) external returns (bytes memory r) {
        unlocked = true;
        r = IUnlockCallback(msg.sender).unlockCallback(data);
        unlocked = false;
        require(delta[address(0)] == 0, "eth not settled");
        // the two ERC20s used in tests
        require(_allZero(), "currency not settled");
    }

    address[] internal seen;

    function _allZero() internal view returns (bool) {
        for (uint256 i; i < seen.length; ++i) {
            if (delta[seen[i]] != 0) return false;
        }
        return true;
    }

    function _touch(address c) internal {
        for (uint256 i; i < seen.length; ++i) {
            if (seen[i] == c) return;
        }
        seen.push(c);
    }

    function swap(PoolKey memory key, SwapParams memory p, bytes calldata) external returns (int256) {
        require(unlocked, "locked");
        require(p.amountSpecified < 0, "exact in only");
        uint256 amountIn = uint256(-p.amountSpecified);
        if (partialBps != 0) amountIn = amountIn * partialBps / 10_000;
        uint256 r = rate[key.currency1];
        uint256 out = p.zeroForOne ? amountIn * r / 1e18 : amountIn * 1e18 / r;
        int128 a0;
        int128 a1;
        if (p.zeroForOne) {
            a0 = -int128(int256(amountIn));
            a1 = int128(int256(out));
        } else {
            a0 = int128(int256(out));
            a1 = -int128(int256(amountIn));
        }
        _touch(key.currency0);
        _touch(key.currency1);
        delta[key.currency0] += a0;
        delta[key.currency1] += a1;
        return (int256(a0) << 128) | int256(uint256(uint128(a1)));
    }

    function sync(address c) external {
        synced = c;
        syncedBal = IERC20(c).balanceOf(address(this));
    }

    function settle() external payable returns (uint256 paid) {
        if (msg.value > 0) {
            paid = msg.value;
            delta[address(0)] += int256(paid);
        } else {
            paid = IERC20(synced).balanceOf(address(this)) - syncedBal;
            delta[synced] += int256(paid);
        }
    }

    function take(address c, address to, uint256 amount) external {
        delta[c] -= int256(amount);
        if (c == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            require(ok);
        } else {
            IERC20(c).transfer(to, amount);
        }
    }
}

contract UniswapV4AdapterTest is Test {
    FakePoolManager internal pm;
    MockUSDG internal usdg;
    EbbToken internal ebb;
    UniswapV4Adapter internal ad;
    address internal user = makeAddr("user");

    function setUp() public {
        pm = new FakePoolManager();
        usdg = new MockUSDG();
        ebb = new EbbToken(address(pm));
        pm.setRate(address(usdg), 2500e6);
        pm.setRate(address(ebb), 250_000e18);
        usdg.mint(address(pm), 1_000_000e6);
        vm.deal(address(pm), 1000 ether);
        ad = new UniswapV4Adapter(
            pm,
            PoolKey(address(0), address(usdg), 500, 10, address(0)),
            PoolKey(address(0), address(ebb), 10_000, 200, address(0))
        );
    }

    function test_ethToUsdg() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        uint256 out = ad.swapExactIn{value: 1 ether}(address(0), address(usdg), 1 ether, 2500e6, user);
        assertEq(out, 2500e6);
        assertEq(usdg.balanceOf(user), 2500e6);
        assertEq(address(ad).balance, 0);
    }

    function test_usdgToEbb_twoHopsNetted() public {
        usdg.mint(user, 100e6);
        vm.startPrank(user);
        usdg.approve(address(ad), 100e6);
        uint256 out = ad.swapExactIn(address(usdg), address(ebb), 100e6, 1, user);
        vm.stopPrank();
        assertEq(out, 10_000e18); // $100 at $0.01
        assertEq(ebb.balanceOf(user), 10_000e18);
        assertEq(usdg.balanceOf(address(ad)), 0);
        assertEq(pm.delta(address(0)), 0);
    }

    function test_minOutEnforced() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(UniswapV4Adapter.InsufficientOutput.selector, 2500e6, 2500e6 + 1));
        ad.swapExactIn{value: 1 ether}(address(0), address(usdg), 1 ether, 2500e6 + 1, user);
    }

    function test_partialFillReverts() public {
        pm.setPartial(5000);
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(UniswapV4Adapter.PartialFill.selector, 0.5 ether, 1 ether));
        ad.swapExactIn{value: 1 ether}(address(0), address(usdg), 1 ether, 0, user);
    }

    function test_unsupportedRoute() public {
        vm.expectRevert(
            abi.encodeWithSelector(UniswapV4Adapter.UnsupportedRoute.selector, address(usdg), address(usdg))
        );
        ad.swapExactIn(address(usdg), address(usdg), 1, 0, user);
    }

    function test_badMsgValue() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(UniswapV4Adapter.BadMsgValue.selector);
        ad.swapExactIn{value: 1}(address(0), address(usdg), 2, 0, user);
    }

    function test_callbackOnlyPoolManager() public {
        vm.expectRevert(UniswapV4Adapter.NotPoolManager.selector);
        ad.unlockCallback("");
    }

    function test_constructorRejectsNonNativePools() public {
        vm.expectRevert(UniswapV4Adapter.NotNativePool.selector);
        new UniswapV4Adapter(
            pm,
            PoolKey(address(1), address(usdg), 500, 10, address(0)),
            PoolKey(address(0), address(ebb), 10_000, 200, address(0))
        );
    }
}
