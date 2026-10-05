// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeployTestnet} from "../script/DeployTestnet.s.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {EbbVault} from "../src/EbbVault.sol";
import {EbbToken} from "../src/EbbToken.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockSwapAdapter} from "../src/mocks/MockSwapAdapter.sol";

contract DeployScriptsTest is Test {
    function test_deployTestnet_endToEnd() public {
        vm.warp(1_790_966_123); // not aligned
        // throwaway key derived in-test so the broadcaster and the token recipient are the same account
        vm.setEnv("PRIVATE_KEY", vm.toString(uint256(keccak256("ebb-deploy-test"))));
        DeployTestnet s = new DeployTestnet();
        DeployTestnet.Deployed memory d = s.run();
        EbbVault v = d.vault;

        assertEq(v.genesis(), 1_790_967_600); // next :00/:30
        assertEq(uint256(v.genesis()) % 1800, 0);
        assertGt(v.genesis(), block.timestamp);
        assertEq(v.token(), address(d.token));
        assertEq(d.token.balanceOf(address(d.adapter)), 300_000_000e18);

        // full loop on the mocks: inflow -> grant -> usage -> expiry burn
        vm.deal(address(v), 0.1 ether);
        v.harvest(); // before genesis: books to tide 0
        assertEq(v.totalOpen(), 175e6);
        vm.warp(v.epochStart(1));
        vm.prank(v.operator());
        v.commitGrants(0, keccak256("root"), 150e6, 3);
        vm.prank(v.operator());
        v.withdrawForUsage(0, 50e6, keccak256("usage"));
        vm.warp(v.expiresAt(0));
        uint256 supply = d.token.totalSupply();
        v.burnExpired(0, type(uint128).max);
        assertLt(d.token.totalSupply(), supply);
        assertEq(v.totalOpen(), 0);
    }

    function test_deployMainnet_fromEnv() public {
        vm.warp(1_790_966_123);
        MockUSDG usdg = new MockUSDG();
        EbbToken ebb = new EbbToken(address(this));
        address weth = makeAddr("weth");
        MockOracle oracle = new MockOracle(weth);
        oracle.setPrice(weth, 2500e18, 18);
        oracle.setPrice(address(usdg), 1e18, 6);
        oracle.setPrice(address(ebb), 1e14, 18);
        MockSwapAdapter adapter = new MockSwapAdapter(oracle);

        vm.setEnv("ALLOW_ANY_CHAIN", "true");
        vm.setEnv("TOKEN", vm.toString(address(ebb)));
        vm.setEnv("USDG", vm.toString(address(usdg)));
        vm.setEnv("WETH", vm.toString(weth));
        vm.setEnv("SWAP_ADAPTER", vm.toString(address(adapter)));
        vm.setEnv("ORACLE", vm.toString(address(oracle)));
        vm.setEnv("TREASURY", vm.toString(makeAddr("treasury")));
        vm.setEnv("SETTLEMENT", vm.toString(makeAddr("settlement")));
        vm.setEnv("OPERATOR", vm.toString(makeAddr("operator")));
        vm.setEnv("GUARDIAN", vm.toString(makeAddr("guardian")));

        EbbVault v = new Deploy().run();
        assertEq(v.genesis(), 1_790_967_600);
        assertEq(address(v.feeSource()), address(0));
        assertEq(v.operator(), makeAddr("operator"));

        // guards
        vm.setEnv("GUARDIAN", vm.toString(makeAddr("operator")));
        Deploy dep = new Deploy();
        vm.expectRevert(abi.encodeWithSelector(Deploy.SameKey.selector, "operator == guardian"));
        dep.run();
        vm.setEnv("GUARDIAN", vm.toString(makeAddr("guardian")));
        vm.setEnv("TOKEN", vm.toString(makeAddr("eoa")));
        vm.expectRevert(abi.encodeWithSelector(Deploy.NoCode.selector, "TOKEN", makeAddr("eoa")));
        dep.run();
        vm.setEnv("ALLOW_ANY_CHAIN", "false");
        vm.expectRevert(abi.encodeWithSelector(Deploy.WrongChain.selector, block.chainid));
        dep.run();
    }
}
