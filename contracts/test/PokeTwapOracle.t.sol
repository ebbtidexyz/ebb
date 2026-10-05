// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PokeTwapOracle} from "../src/oracle/PokeTwapOracle.sol";
import {MockSpotSource} from "../src/mocks/MockSpotSource.sol";
import {ISpotSource} from "../src/interfaces/ISpotSource.sol";

contract PokeTwapOracleTest is Test {
    address internal weth = makeAddr("WETH");
    address internal usdg = makeAddr("USDG");
    address internal ebb = makeAddr("EBB");
    MockSpotSource internal src;
    PokeTwapOracle internal o;

    // 1 ETH (1e18 wei) = 2500 USDG (2500e6) -> priceX18 = 2500e6 * 1e18 / 1e18 = 2500e6
    uint256 internal constant P_USDG = 2500e6;
    // 1 ETH = 250_000 EBB (1e18-dec) -> priceX18 = 250_000e18
    uint256 internal constant P_EBB = 250_000e18;

    function setUp() public {
        vm.warp(1_800_000_000);
        src = new MockSpotSource();
        src.set(weth, usdg, P_USDG);
        src.set(weth, ebb, P_EBB);
        address[] memory a = new address[](2);
        a[0] = usdg;
        a[1] = ebb;
        o = new PokeTwapOracle(src, weth, a, 1800, 500);
    }

    function _pokeEvery(uint256 step, uint256 total) internal {
        for (uint256 t; t < total; t += step) {
            o.poke();
            vm.warp(block.timestamp + step);
        }
        o.poke();
    }

    function test_constructor_params() public {
        address[] memory a = new address[](1);
        a[0] = usdg;
        vm.expectRevert(PokeTwapOracle.ZeroAddress.selector);
        new PokeTwapOracle(ISpotSource(address(0)), weth, a, 1800, 500);
        vm.expectRevert(PokeTwapOracle.BadParams.selector);
        new PokeTwapOracle(src, weth, a, 1800, 10_000);
        vm.expectRevert(PokeTwapOracle.BadParams.selector);
        new PokeTwapOracle(src, weth, new address[](0), 1800, 500);
        a[0] = weth;
        vm.expectRevert(PokeTwapOracle.ZeroAddress.selector);
        new PokeTwapOracle(src, weth, a, 1800, 500);
        assertEq(o.minInterval(), 150);
        assertEq(o.assets().length, 2);
    }

    function test_quote_revertsWithoutHistory() public {
        vm.expectRevert(abi.encodeWithSelector(PokeTwapOracle.InsufficientHistory.selector, usdg));
        o.quote(weth, usdg, 1e18);
        o.poke();
        vm.warp(block.timestamp + 1799);
        vm.expectRevert(abi.encodeWithSelector(PokeTwapOracle.InsufficientHistory.selector, usdg));
        o.quote(weth, usdg, 1e18);
        vm.warp(block.timestamp + 1);
        assertEq(o.quote(weth, usdg, 1e18), 2500e6);
    }

    function test_quote_constantPrice_allDirections() public {
        _pokeEvery(300, 2400);
        assertEq(o.twap(usdg), P_USDG);
        assertEq(o.quote(weth, usdg, 2e18), 5000e6);
        assertEq(o.quote(address(0), usdg, 1e18), 2500e6);
        assertEq(o.quote(usdg, weth, 2500e6), 1e18);
        assertEq(o.quote(usdg, address(0), 2500e6), 1e18);
        assertEq(o.quote(usdg, ebb, 1e6), 100e18); // $1 = 100 EBB
        assertEq(o.quote(ebb, usdg, 100e18), 1e6);
        assertEq(o.quote(weth, weth, 7), 7);
    }

    function test_twap_isTimeWeighted() public {
        _pokeEvery(150, 1800); // flat at P for >= window
        // halve the price smoothly within the clamp: step -5% per poke until 50%
        uint256 p = P_USDG;
        for (uint256 i; i < 14; ++i) {
            p = p * 95 / 100;
            src.set(weth, usdg, p);
            vm.warp(block.timestamp + 150);
            o.poke();
        }
        uint256 t = o.twap(usdg);
        assertLt(t, P_USDG);
        assertGt(t, p);
    }

    function test_poke_rateLimited() public {
        o.poke();
        PokeTwapOracle.Observation memory a = o.latest(usdg);
        src.set(weth, usdg, P_USDG * 104 / 100);
        vm.warp(block.timestamp + 149);
        o.poke(); // no-op
        PokeTwapOracle.Observation memory b = o.latest(usdg);
        assertEq(b.timestamp, a.timestamp);
        assertEq(b.price, P_USDG);
        vm.warp(block.timestamp + 1);
        o.poke();
        assertEq(o.latest(usdg).price, P_USDG * 104 / 100);
    }

    function test_poke_clampsSpikes() public {
        o.poke();
        src.set(weth, usdg, P_USDG * 10); // flash manipulation
        vm.warp(block.timestamp + 150);
        o.poke();
        assertEq(o.latest(usdg).price, P_USDG * 105 / 100);
        src.set(weth, usdg, 1);
        vm.warp(block.timestamp + 150);
        o.poke();
        assertEq(o.latest(usdg).price, (P_USDG * 105 / 100) * 95 / 100);
    }

    function test_manipulatedSample_limitedImpact() public {
        _pokeEvery(150, 1800);
        src.set(weth, usdg, P_USDG * 100); // one manipulated poke
        vm.warp(block.timestamp + 150);
        o.poke();
        src.set(weth, usdg, P_USDG);
        vm.warp(block.timestamp + 150);
        o.poke();
        vm.warp(block.timestamp + 1);
        uint256 t = o.twap(usdg);
        // <= 5% x 150/1800 ≈ 0.42%
        assertLe(t, P_USDG * 10_042 / 10_000);
    }

    function test_quote_revertsWhenStale() public {
        _pokeEvery(300, 1800);
        vm.warp(block.timestamp + 3600);
        o.quote(weth, usdg, 1e18); // exactly 2x window: still ok
        vm.warp(block.timestamp + 1);
        vm.expectRevert(); // StalePrice
        o.quote(weth, usdg, 1e18);
    }

    function test_unknownAsset() public {
        address x = makeAddr("x");
        vm.expectRevert(abi.encodeWithSelector(PokeTwapOracle.UnknownAsset.selector, x));
        o.quote(weth, x, 1);
    }

    function test_zeroSpotReverts() public {
        src.set(weth, usdg, 0);
        vm.expectRevert(abi.encodeWithSelector(PokeTwapOracle.ZeroPrice.selector, usdg));
        o.poke();
    }

    function test_ringBufferWraps() public {
        _pokeEvery(150, 150 * 200); // 200 pokes > CARDINALITY
        assertEq(o.twap(usdg), P_USDG);
        (,, bool tracked) = o.feeds(usdg);
        assertTrue(tracked);
    }
}
