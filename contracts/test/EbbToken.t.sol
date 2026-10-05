// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {EbbToken} from "../src/EbbToken.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

contract EbbTokenTest is Test {
    function test_metadataAndSupply() public {
        address d = makeAddr("d");
        EbbToken t = new EbbToken(d);
        assertEq(t.name(), "Ebb");
        assertEq(t.symbol(), "EBB");
        assertEq(t.decimals(), 18);
        assertEq(t.totalSupply(), 1_000_000_000e18);
        assertEq(t.balanceOf(d), 1_000_000_000e18);
    }

    function testFuzz_burn(uint256 amt) public {
        address d = makeAddr("d");
        EbbToken t = new EbbToken(d);
        amt = bound(amt, 0, 1_000_000_000e18);
        vm.prank(d);
        t.burn(amt);
        assertEq(t.totalSupply(), 1_000_000_000e18 - amt);
        assertEq(t.balanceOf(d), 1_000_000_000e18 - amt);
    }

    function test_burnMoreThanBalanceReverts() public {
        address d = makeAddr("d");
        EbbToken t = new EbbToken(d);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, address(this), 0, 1));
        t.burn(1);
    }

    function test_mockUsdg() public {
        MockUSDG u = new MockUSDG();
        assertEq(u.decimals(), 6);
        u.mint(address(this), 5e6);
        assertEq(u.balanceOf(address(this)), 5e6);
    }
}
