// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base} from "./utils/Base.sol";
import {MockPonsEscrow, MockPonsCurve, MockPonsHook} from "./utils/PonsMocks.sol";

import {EbbVault} from "../src/EbbVault.sol";
import {EbbLauncher} from "../src/EbbLauncher.sol";
import {IFeeSource} from "../src/interfaces/IFeeSource.sol";
import {IPonsFactory, PonsTokenParams} from "../src/interfaces/IPons.sol";

/// @notice Unit tests (mocks) for the pons v2 mainnet paths of EbbVault: quote = native ETH (fees pulled from the
///         curve + escrow, swapped to USDG) and quote = USDG (fees booked directly, burn USDG -> $EBB directly).
contract EbbVaultPonsTest is Base {
    bytes32 internal constant POOL_ID = keccak256("pool");

    MockPonsEscrow internal escrow;
    MockPonsHook internal hook;

    function setUp() public override {
        super.setUp();
        escrow = new MockPonsEscrow();
        hook = new MockPonsHook();
    }

    /// @dev Vault wired to the pons mocks; the curve is created after the vault (its creator must be the vault).
    function _ponsVault(address quote_) internal returns (EbbVault v, MockPonsCurve curve) {
        EbbVault.Config memory c = _config();
        c.feeSource = IFeeSource(address(escrow));
        c.quote = quote_;
        c.feeHook = address(hook);
        c.feePoolId = POOL_ID;
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        c.feeCurve = predicted;
        v = new EbbVault(c);
        curve = new MockPonsCurve(escrow, address(v), quote_);
        assertEq(address(curve), predicted);
    }

    // ---------------------------------------------------------------------------------------------------------
    // constructor
    // ---------------------------------------------------------------------------------------------------------

    function test_constructor_quoteMustBeEthOrUsdg() public {
        EbbVault.Config memory c = _config();
        c.quote = address(ebb);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.BadQuote.selector, address(ebb)));
        new EbbVault(c);
        c.quote = address(usdg);
        assertEq(new EbbVault(c).quote(), address(usdg));
    }

    function test_constructor_setsPonsImmutables() public {
        (EbbVault v, MockPonsCurve curve) = _ponsVault(address(0));
        assertEq(v.quote(), address(0));
        assertEq(v.feeCurve(), address(curve));
        assertEq(v.feeHook(), address(hook));
        assertEq(v.feePoolId(), POOL_ID);
    }

    // ---------------------------------------------------------------------------------------------------------
    // ETH pairing
    // ---------------------------------------------------------------------------------------------------------

    function test_eth_harvest_sweepsCurveClaimsEscrowAndSwaps() public {
        (EbbVault v, MockPonsCurve curve) = _ponsVault(address(0));
        vm.deal(address(curve), 1 ether); // pending creator fees on the curve
        vm.deal(address(escrow), 0.5 ether);
        escrow.credit{value: 0}(address(v));
        vm.deal(address(this), 0.5 ether);
        escrow.credit{value: 0.5 ether}(address(v)); // e.g. credited at graduation

        vm.prank(keeper);
        v.harvest();

        assertEq(curve.sweeps(), 1);
        assertEq(escrow.balanceOf(address(v)), 0);
        assertEq(address(v).balance, 0);
        uint256 usdgOut = 1.5 ether * 2500 / 1e12; // 1.5 ETH at $2500, 6 dp, mock adapter 0 slippage
        uint256 toTreasury = usdgOut * 3000 / 10_000;
        assertEq(usdg.balanceOf(treasury), toTreasury);
        assertEq(v.totalOpen(), usdgOut - toTreasury);
        assertEq(usdg.balanceOf(address(v)), v.totalOpen()); // I1
    }

    function test_eth_harvest_curveWithoutCode_isSkipped() public {
        EbbVault.Config memory c = _config();
        c.feeSource = IFeeSource(address(escrow));
        c.feeCurve = makeAddr("not-yet-launched-curve");
        c.feeHook = makeAddr("no-code-hook");
        EbbVault v = new EbbVault(c);
        vm.deal(address(v), 1 ether);
        v.harvest(); // must not revert before the launch exists
        assertGt(v.totalOpen(), 0);
    }

    function test_eth_harvest_survivesFailingPulls() public {
        (EbbVault v, MockPonsCurve curve) = _ponsVault(address(0));
        curve.setGraduated(true); // sweepFees reverts AlreadyGraduated
        // hook reverts InternalSwapRequiresOperator, escrow reverts NoBalance
        vm.deal(address(v), 1 ether);
        v.harvest();
        assertEq(curve.sweeps(), 0);
        assertEq(hook.sweeps(), 0);
        assertEq(address(v).balance, 0);
        assertGt(v.totalOpen(), 0);
    }

    function test_eth_harvest_sweepsHookWhenAllowed() public {
        (EbbVault v,) = _ponsVault(address(0));
        hook.setAllowCreatorSweep(true);
        v.harvest();
        assertEq(hook.sweeps(), 1);
        assertEq(hook.lastPoolId(), POOL_ID);
    }

    function test_eth_harvest_swapBoundStillEnforced() public {
        (EbbVault v,) = _ponsVault(address(0));
        adapter.setEnforceMinOut(false);
        adapter.setSlippageBps(301);
        vm.deal(address(v), 1 ether);
        vm.expectPartialRevert(EbbVault.SlippageExceeded.selector);
        v.harvest();
    }

    function test_eth_burn_routesViaWeth() public {
        (EbbVault v,) = _ponsVault(address(0));
        vm.deal(address(v), 1 ether);
        v.harvest();
        vm.warp(v.expiresAt(0));
        uint256 rem = v.remaining(0);
        uint256 supply = ebb.totalSupply();
        v.burnExpired(0, uint128(rem));
        assertEq(v.remaining(0), 0);
        assertLt(ebb.totalSupply(), supply);
        assertEq(usdg.balanceOf(address(v)), 0);
    }

    // ---------------------------------------------------------------------------------------------------------
    // USDG pairing
    // ---------------------------------------------------------------------------------------------------------

    function test_usdg_harvest_booksEscrowUsdgWithoutSwap() public {
        (EbbVault v, MockPonsCurve curve) = _ponsVault(address(usdg));
        usdg.mint(address(curve), 700e6); // pending creator fees on the curve
        usdg.mint(address(this), 300e6);
        usdg.approve(address(escrow), 300e6);
        escrow.creditToken(address(v), address(usdg), 300e6);

        vm.recordLogs();
        v.harvest();
        assertEq(curve.sweeps(), 1);
        assertEq(escrow.balanceOfToken(address(v), address(usdg)), 0);
        assertEq(usdg.balanceOf(treasury), 300e6);
        assertEq(v.totalOpen(), 700e6);
        (uint128 booked,,,,,) = v.epochs(0);
        assertEq(booked, 700e6);
        assertEq(usdg.balanceOf(address(v)), v.totalOpen());
    }

    function test_usdg_harvest_ignoresEthAndNeedsNoOracle() public {
        (EbbVault v,) = _ponsVault(address(usdg));
        oracle.setBroken(true); // no oracle use on the USDG harvest path
        usdg.mint(address(v), 100e6);
        v.harvest();
        assertEq(v.totalOpen(), 70e6);
    }

    function test_usdg_receive_rejectsEth() public {
        (EbbVault v,) = _ponsVault(address(usdg));
        vm.deal(address(this), 1 ether);
        (bool ok, bytes memory ret) = address(v).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(bytes4(ret), EbbVault.EthNotAccepted.selector);
    }

    function test_usdg_burn_directRouteAndBound() public {
        (EbbVault v,) = _ponsVault(address(usdg));
        usdg.mint(address(v), 1000e6);
        v.harvest();
        vm.warp(v.expiresAt(0));
        // 100 USDG - tip 0.25 at $0.01/EBB -> 9975 EBB at 0 slippage
        uint256 supply = ebb.totalSupply();
        v.burnExpired(0, 100e6);
        assertEq(supply - ebb.totalSupply(), 9975e18);
        assertEq(usdg.balanceOf(address(v)), v.totalOpen());

        adapter.setEnforceMinOut(false);
        adapter.setSlippageBps(301);
        vm.expectPartialRevert(EbbVault.SlippageExceeded.selector);
        v.burnExpired(0, 100e6);
    }

    // ---------------------------------------------------------------------------------------------------------
    // EbbLauncher access control (full launch is covered by the mainnet fork test)
    // ---------------------------------------------------------------------------------------------------------

    function test_launcher_onlyDeployer() public {
        EbbLauncher l = new EbbLauncher(IPonsFactory(makeAddr("factory")), address(vault), address(0), 200, 0, alice);
        assertEq(l.deployer(), address(this));
        PonsTokenParams memory p;
        vm.prank(alice);
        vm.expectRevert(EbbLauncher.NotDeployer.selector);
        l.launch(p, 0);
    }

    function test_launcher_rejectsWrongParams() public {
        EbbLauncher l = new EbbLauncher(IPonsFactory(makeAddr("factory")), address(vault), address(0), 200, 0, alice);
        PonsTokenParams memory p;
        p.creatorFeeRecipient = address(vault);
        p.creatorTaxBps = 100; // wrong tax
        p.expectedEconomics = bytes32(uint256(1));
        vm.expectRevert(EbbLauncher.BadParams.selector);
        l.launch(p, 0);
    }
}
