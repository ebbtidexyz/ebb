// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Base} from "./utils/Base.sol";
import {
    NoBurnToken,
    FallbackToken,
    UnderSpendAdapter,
    RefundingAdapter,
    ReentrantAdapter,
    ReentrantFeeSource
} from "./utils/Adversarial.sol";

import {EbbVault} from "../src/EbbVault.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";
import {IFeeSource} from "../src/interfaces/IFeeSource.sol";
import {MockSwapAdapter} from "../src/mocks/MockSwapAdapter.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";

contract EbbVaultTest is Base {
    event Harvested(uint256 indexed epoch, uint256 ethIn, uint256 usdgOut, uint256 toPool, uint256 toTreasury);
    event GrantsCommitted(uint256 indexed epoch, bytes32 root, uint128 total, uint32 wallets);
    event UsageWithdrawn(uint256 indexed epoch, uint128 amount, bytes32 usageRoot);
    event Burned(uint256 indexed epoch, uint256 usdgIn, uint256 ebbBurned, address indexed caller, uint256 tip);
    event OperatorFrozen();

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // =========================================================================================================
    // constructor / config
    // =========================================================================================================

    function test_constructor_setsImmutables() public view {
        assertEq(vault.token(), address(ebb));
        assertEq(vault.usdg(), address(usdg));
        assertEq(vault.weth(), weth);
        assertEq(address(vault.swapAdapter()), address(adapter));
        assertEq(address(vault.oracle()), address(oracle));
        assertEq(address(vault.feeSource()), address(feeSource));
        assertEq(vault.treasury(), treasury);
        assertEq(vault.settlement(), settlement);
        assertEq(vault.operator(), operator);
        assertEq(vault.guardian(), guardian);
        assertEq(vault.genesis(), GENESIS);
        assertFalse(vault.operatorFrozen());
        assertEq(vault.totalOpen(), 0);
    }

    function test_constants_matchSpec() public view {
        assertEq(vault.EPOCH_SECONDS(), 1800);
        assertEq(vault.EXPIRY_EPOCHS(), 336);
        assertEq(vault.POOL_BPS(), 7000);
        assertEq(vault.TREASURY_BPS(), 3000);
        assertEq(vault.POOL_BPS() + vault.TREASURY_BPS(), 10_000);
        assertEq(vault.MAX_DEVIATION_BPS(), 300);
        assertEq(vault.CALLER_TIP_BPS(), 25);
        assertEq(vault.CALLER_TIP_CAP(), 2_000000);
        assertEq(vault.DEAD(), DEAD);
        assertEq(ebb.totalSupply(), 1_000_000_000e18);
        assertEq(ebb.decimals(), 18);
        assertEq(usdg.decimals(), 6);
    }

    function test_constructor_revertsOnZeroAddresses() public {
        for (uint256 i; i < 9; ++i) {
            EbbVault.Config memory c = _config();
            if (i == 0) c.token = address(0);
            if (i == 1) c.usdg = address(0);
            if (i == 2) c.weth = address(0);
            if (i == 3) c.swapAdapter = ISwapAdapter(address(0));
            if (i == 4) c.oracle = MockOracle(address(0));
            if (i == 5) c.treasury = address(0);
            if (i == 6) c.settlement = address(0);
            if (i == 7) c.operator = address(0);
            if (i == 8) c.guardian = address(0);
            vm.expectRevert(EbbVault.ZeroAddress.selector);
            new EbbVault(c);
        }
    }

    function test_constructor_allowsNoFeeSource() public {
        EbbVault.Config memory c = _config();
        c.feeSource = IFeeSource(address(0));
        EbbVault v = new EbbVault(c);
        assertEq(address(v.feeSource()), address(0));
        vm.deal(address(v), 1 ether);
        v.harvest();
        assertEq(v.totalOpen(), 1750e6);
    }

    function test_constructor_revertsOnUnalignedGenesis() public {
        EbbVault.Config memory c = _config();
        c.genesis = GENESIS + 900;
        vm.expectRevert(abi.encodeWithSelector(EbbVault.GenesisNotAligned.selector, GENESIS + 900));
        new EbbVault(c);
    }

    function test_constructor_revertsOnSameToken() public {
        EbbVault.Config memory c = _config();
        c.usdg = c.token;
        vm.expectRevert(EbbVault.SameToken.selector);
        new EbbVault(c);
    }

    function test_receive_acceptsEth() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, 1 ether);
    }

    // =========================================================================================================
    // epoch math
    // =========================================================================================================

    function test_epochMath_boundaries() public {
        vm.warp(GENESIS - 1);
        assertEq(vault.currentEpoch(), 0);
        vm.warp(GENESIS);
        assertEq(vault.currentEpoch(), 0);
        vm.warp(GENESIS + 1799);
        assertEq(vault.currentEpoch(), 0);
        vm.warp(GENESIS + 1800);
        assertEq(vault.currentEpoch(), 1);
        assertEq(vault.epochStart(0), GENESIS);
        assertEq(vault.epochStart(244), GENESIS + 244 * 1800);
        assertEq(vault.expiresAt(3), GENESIS + 3 * 1800 + 7 days);
        // :00 / :30 UTC alignment
        assertEq(vault.epochStart(17) % 1800, 0);
    }

    function testFuzz_epochMath(uint256 t) public {
        t = bound(t, GENESIS, GENESIS + 100 * 365 days);
        vm.warp(t);
        uint256 e = vault.currentEpoch();
        assertEq(e, (t - GENESIS) / 1800);
        assertLe(vault.epochStart(e), t);
        assertGt(vault.epochStart(e + 1), t);
        assertEq(vault.expiresAt(e) - vault.epochStart(e), 336 * 1800);
    }

    // =========================================================================================================
    // harvest
    // =========================================================================================================

    function test_harvest_noopWhenEmpty() public {
        vm.recordLogs();
        vault.harvest();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].emitter != address(vault), "vault emitted");
        }
        assertEq(vault.totalOpen(), 0);
        assertEq(feeSource.claims(), 1);
    }

    function test_harvest_swapsAndSplits() public {
        vm.deal(address(vault), 1 ether);
        vm.expectEmit(address(vault));
        emit Harvested(0, 1 ether, 2500e6, 1750e6, 750e6);
        vault.harvest();

        (uint128 booked,,,,,) = vault.epochs(0);
        assertEq(booked, 1750e6);
        assertEq(vault.remaining(0), 1750e6);
        assertEq(vault.totalOpen(), 1750e6);
        assertEq(usdg.balanceOf(treasury), 750e6);
        assertEq(usdg.balanceOf(address(vault)), 1750e6);
        assertEq(address(vault).balance, 0);
    }

    function test_harvest_claimsFeeSource() public {
        vm.deal(address(feeSource), 2 ether);
        vault.harvest();
        assertEq(address(feeSource).balance, 0);
        assertEq(vault.totalOpen(), 3500e6);
        assertEq(usdg.balanceOf(treasury), 1500e6);
    }

    function test_harvest_claimsFeeSourceUsdg() public {
        usdg.mint(address(feeSource), 100e6);
        vault.harvest();
        assertEq(vault.totalOpen(), 70e6);
        assertEq(usdg.balanceOf(treasury), 30e6);
    }

    function test_harvest_survivesRevertingFeeSource() public {
        feeSource.setShouldRevert(true);
        vm.deal(address(feeSource), 5 ether);
        vm.deal(address(vault), 1 ether);
        vault.harvest();
        assertEq(vault.totalOpen(), 1750e6);
        assertEq(address(feeSource).balance, 5 ether);
    }

    function test_harvest_survivesReentrantFeeSource() public {
        ReentrantFeeSource fs = new ReentrantFeeSource();
        EbbVault.Config memory c = _config();
        c.feeSource = IFeeSource(address(fs));
        EbbVault v = new EbbVault(c);
        fs.setVault(v);
        vm.deal(address(v), 1 ether);
        v.harvest(); // inner harvest reverts (reentrancy guard), caught
        assertEq(v.totalOpen(), 1750e6);
    }

    function test_harvest_booksDirectUsdgDonations() public {
        usdg.mint(address(vault), 1000e6);
        vm.expectEmit(address(vault));
        emit Harvested(0, 0, 1000e6, 700e6, 300e6);
        vault.harvest();
        assertEq(vault.totalOpen(), 700e6);
        assertEq(usdg.balanceOf(address(vault)), 700e6);
    }

    function test_harvest_ethAndDonationTogether() public {
        usdg.mint(address(vault), 500e6);
        vm.deal(address(vault), 1 ether);
        vm.expectEmit(address(vault));
        emit Harvested(0, 1 ether, 3000e6, 2100e6, 900e6);
        vault.harvest();
    }

    function test_harvest_booksToCurrentEpoch() public {
        _warpToEpoch(5);
        _harvestEth(1 ether);
        vm.warp(block.timestamp + 1799);
        _harvestEth(1 ether);
        (uint128 b5,,,,,) = vault.epochs(5);
        assertEq(b5, 3500e6);
        vm.warp(block.timestamp + 1);
        _harvestEth(1 ether);
        (uint128 b6,,,,,) = vault.epochs(6);
        assertEq(b6, 1750e6);
        assertEq(vault.totalOpen(), 5250e6);
    }

    function test_harvest_beforeGenesisBooksToEpoch0() public {
        vm.warp(GENESIS - 3 days);
        _harvestEth(1 ether);
        (uint128 b0,,,,,) = vault.epochs(0);
        assertEq(b0, 1750e6);
    }

    function test_harvest_acceptsSlippageWithinBound() public {
        adapter.setSlippageBps(300);
        _harvestEth(1 ether);
        assertEq(vault.totalOpen() + usdg.balanceOf(treasury), 2425e6);
    }

    function test_harvest_revertsBeyondBound_adapterCheck() public {
        adapter.setSlippageBps(301);
        vm.deal(address(vault), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(MockSwapAdapter.InsufficientOutput.selector, 2424_750000, 2425_000000));
        vault.harvest();
    }

    function test_harvest_revertsBeyondBound_vaultCheck() public {
        adapter.setSlippageBps(301);
        adapter.setEnforceMinOut(false);
        vm.deal(address(vault), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.SlippageExceeded.selector, 2424_750000, 2425_000000));
        vault.harvest();
    }

    function test_harvest_revertsWhenOracleBroken() public {
        oracle.setBroken(true);
        vm.deal(address(vault), 1 ether);
        vm.expectRevert(MockOracle.OracleBroken.selector);
        vault.harvest();
    }

    function test_harvest_reentrancyViaAdapterBlocked() public {
        ReentrantAdapter ra = new ReentrantAdapter(adapter);
        EbbVault.Config memory c = _config();
        c.swapAdapter = ISwapAdapter(address(ra));
        EbbVault v = new EbbVault(c);
        usdg.mint(address(ra), 10_000e6);
        ra.arm(address(v), abi.encodeCall(EbbVault.harvest, ()));
        vm.deal(address(v), 1 ether);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        v.harvest();
    }

    function testFuzz_harvest_split(uint256 usdgOut) public {
        usdgOut = bound(usdgOut, 1, 1e30);
        usdg.mint(address(vault), usdgOut);
        vault.harvest();
        uint256 toPool = vault.totalOpen();
        uint256 toTreasury = usdg.balanceOf(treasury);
        assertEq(toPool + toTreasury, usdgOut, "conservation");
        assertEq(toTreasury, usdgOut * 3000 / 10_000, "treasury rounds down");
        // I5: toPool*3000 == toTreasury*7000 up to < 1 wei of treasury share, always in the pool's favour
        assertGe(toPool * 3000, toTreasury * 7000);
        assertLt(toPool * 3000 - toTreasury * 7000, 10_000);
    }

    function testFuzz_harvest_ethSwapBound(uint256 ethIn, uint256 slip) public {
        ethIn = bound(ethIn, 1, 1_000_000 ether);
        slip = bound(slip, 0, 1000);
        adapter.setSlippageBps(slip);
        adapter.setEnforceMinOut(false);
        vm.deal(address(vault), ethIn);
        uint256 q = oracle.quote(weth, address(usdg), ethIn);
        uint256 minOut = q * 9700 / 10_000;
        uint256 out = q * (10_000 - slip) / 10_000;
        if (out < minOut) {
            vm.expectRevert(abi.encodeWithSelector(EbbVault.SlippageExceeded.selector, out, minOut));
            vault.harvest();
        } else {
            vault.harvest();
            assertEq(vault.totalOpen() + usdg.balanceOf(treasury), out);
        }
    }

    // =========================================================================================================
    // commitGrants
    // =========================================================================================================

    function test_commit_happyPath() public {
        _bookUsdg(1000e6); // 700e6 to epoch 0
        _warpToEpoch(1);
        bytes32 root = keccak256("r");
        vm.expectEmit(address(vault));
        emit GrantsCommitted(0, root, 699_999_999, 42);
        vm.prank(operator);
        vault.commitGrants(0, root, 699_999_999, 42);

        (uint128 booked, uint128 withdrawn, uint128 burned, bytes32 r, uint128 granted, bool closed) = vault.epochs(0);
        assertEq(booked, 700e6);
        assertEq(withdrawn, 0);
        assertEq(burned, 0);
        assertEq(r, root);
        assertEq(granted, 699_999_999);
        assertTrue(closed);
        assertEq(vault.remaining(0), 700e6); // committing moves nothing
    }

    function test_commit_atExactBoundary() public {
        _bookUsdg(1000e6);
        vm.warp(GENESIS + 1799);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.EpochNotEnded.selector, 0));
        vault.commitGrants(0, bytes32("r"), 1, 1);
        vm.warp(GENESIS + 1800);
        _commit(0, 700e6);
    }

    function test_commit_revertsForCurrentOrFutureEpoch() public {
        _warpToEpoch(3);
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.EpochNotEnded.selector, 3));
        vault.commitGrants(3, bytes32("r"), 0, 0);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.EpochNotEnded.selector, 99));
        vault.commitGrants(99, bytes32("r"), 0, 0);
        vm.stopPrank();
    }

    function test_commit_revertsBeforeGenesisEnds() public {
        vm.warp(GENESIS - 100);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.EpochNotEnded.selector, 0));
        vault.commitGrants(0, bytes32("r"), 0, 0);
    }

    function test_commit_onlyOperator() public {
        _warpToEpoch(1);
        vm.prank(alice);
        vm.expectRevert(EbbVault.NotOperator.selector);
        vault.commitGrants(0, bytes32("r"), 0, 0);
        vm.prank(guardian);
        vm.expectRevert(EbbVault.NotOperator.selector);
        vault.commitGrants(0, bytes32("r"), 0, 0);
    }

    function test_commit_onlyOnce() public {
        _bookUsdg(1000e6);
        _warpToEpoch(1);
        _commit(0, 100e6);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.AlreadyCommitted.selector, 0));
        vault.commitGrants(0, bytes32("other"), 200e6, 1);
        // even an empty (0-total) commit closes the tide
        _warpToEpoch(2);
        _commit(1, 0);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.AlreadyCommitted.selector, 1));
        vault.commitGrants(1, bytes32("r"), 0, 0);
    }

    function test_commit_revertsAboveBooked() public {
        _bookUsdg(1000e6);
        _warpToEpoch(1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.GrantsExceedBooked.selector, 700e6 + 1, 700e6));
        vault.commitGrants(0, bytes32("r"), 700e6 + 1, 1);
        _commit(0, 700e6); // exactly booked is fine
    }

    function test_commit_revertsOnEmptyRootWithTotal() public {
        _bookUsdg(1000e6);
        _warpToEpoch(1);
        vm.prank(operator);
        vm.expectRevert(EbbVault.EmptyRoot.selector);
        vault.commitGrants(0, bytes32(0), 1, 1);
        vm.prank(operator);
        vault.commitGrants(0, bytes32(0), 0, 0); // nothing granted: allowed
        (,,,,, bool closed) = vault.epochs(0);
        assertTrue(closed);
    }

    function test_commit_revertsWhenExpired() public {
        _bookUsdg(1000e6);
        vm.warp(vault.expiresAt(0));
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.EpochExpired.selector, 0));
        vault.commitGrants(0, bytes32("r"), 1, 1);
        vm.warp(vault.expiresAt(0) - 1);
        _commit(0, 1);
    }

    function test_commit_revertsWhenFrozen() public {
        _warpToEpoch(1);
        vm.prank(guardian);
        vault.freezeOperator();
        vm.prank(operator);
        vm.expectRevert(EbbVault.OperatorIsFrozen.selector);
        vault.commitGrants(0, bytes32("r"), 0, 0);
    }

    // =========================================================================================================
    // verifyGrant (Merkle)
    // =========================================================================================================

    /// @dev Vector generated with @openzeppelin/merkle-tree StandardMerkleTree.of(values, ["uint256","address","uint256"])
    function test_verifyGrant_ozStandardMerkleTreeVector() public {
        bytes32 root = 0xb469b4f4385733dc39ac8da4a69cbd025278968888d6cb791907876d6e091f58;
        uint128 total = 950_000_000;
        _warpToEpoch(7);
        _bookUsdg(2000e6); // 1400e6 booked to tide 7
        _warpToEpoch(8);
        vm.prank(operator);
        vault.commitGrants(7, root, total, 5);

        bytes32[] memory p1 = new bytes32[](3);
        p1[0] = 0x2df9498ec3cc1661924c126837165b6a331b8649b367edcfbaddd3e3c1c548d9;
        p1[1] = 0xb87084448e99f8426260641dcd89848f07323cb8969fad124a767465a8cf5617;
        p1[2] = 0x351ee3a88911bf6747712e54a359ef15de4ed02b6ab785dbfd29f4d07d55dd6b;
        assertTrue(vault.verifyGrant(7, 0x1111111111111111111111111111111111111111, 500_000_000, p1));

        bytes32[] memory p2 = new bytes32[](2);
        p2[0] = 0xae663539acada591a976fc1029c442dda6841fbe5a76e17fe37edefef409762a;
        p2[1] = 0xa1bebe30eef41bd3b34f0cdf7598edb78143474502503127195f667d50ed20f6;
        assertTrue(vault.verifyGrant(7, 0x2222222222222222222222222222222222222222, 250_000_000, p2));

        bytes32[] memory p3 = new bytes32[](2);
        p3[0] = 0xa07b91f106e71865d54705b45bb7031e7b2e8906fb0783a54a9842706c0459dd;
        p3[1] = 0x351ee3a88911bf6747712e54a359ef15de4ed02b6ab785dbfd29f4d07d55dd6b;
        assertTrue(vault.verifyGrant(7, 0x3333333333333333333333333333333333333333, 123_456_789, p3));

        bytes32[] memory p4 = new bytes32[](3);
        p4[0] = 0x63750b96626744fbdb86ffdabfeb0bdfcc97f8b0a178c253b92ace9b3cb6db17;
        p4[1] = 0xb87084448e99f8426260641dcd89848f07323cb8969fad124a767465a8cf5617;
        p4[2] = 0x351ee3a88911bf6747712e54a359ef15de4ed02b6ab785dbfd29f4d07d55dd6b;
        assertTrue(vault.verifyGrant(7, 0x4444444444444444444444444444444444444444, 1, p4));

        bytes32[] memory p5 = new bytes32[](2);
        p5[0] = 0xa04636a7bbd8eb02679c0e70d99682df553212349cc47a7195f3ba7803191aaa;
        p5[1] = 0xa1bebe30eef41bd3b34f0cdf7598edb78143474502503127195f667d50ed20f6;
        assertTrue(vault.verifyGrant(7, 0x5555555555555555555555555555555555555555, 76_543_210, p5));

        // wrong amount / wallet / epoch / proof
        assertFalse(vault.verifyGrant(7, 0x1111111111111111111111111111111111111111, 500_000_001, p1));
        assertFalse(vault.verifyGrant(7, 0x2222222222222222222222222222222222222222, 500_000_000, p1));
        assertFalse(vault.verifyGrant(8, 0x1111111111111111111111111111111111111111, 500_000_000, p1));
        assertFalse(vault.verifyGrant(7, 0x1111111111111111111111111111111111111111, 500_000_000, p2));
    }

    function test_verifyGrant_falseWhenNotCommitted() public view {
        bytes32[] memory proof = new bytes32[](0);
        assertFalse(vault.verifyGrant(0, alice, 1, proof));
    }

    function test_verifyGrant_singleLeafTree() public {
        _bookUsdg(1000e6);
        _warpToEpoch(1);
        bytes32 leaf = vault.grantLeaf(0, alice, 700e6);
        assertEq(leaf, _leaf(0, alice, 700e6));
        vm.prank(operator);
        vault.commitGrants(0, leaf, 700e6, 1);
        assertTrue(vault.verifyGrant(0, alice, 700e6, new bytes32[](0)));
    }

    function testFuzz_verifyGrant_builtTree(uint8 n, uint256 pick, uint256 seed) public {
        n = uint8(bound(n, 1, 40));
        pick = bound(pick, 0, n - 1);
        uint256 e = 3;
        bytes32[] memory leaves = new bytes32[](n);
        address[] memory wallets = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        uint256 total;
        for (uint256 i; i < n; ++i) {
            wallets[i] = address(uint160(uint256(keccak256(abi.encode(seed, i)))));
            amounts[i] = uint256(keccak256(abi.encode(seed, i, "a"))) % 1e9 + 1;
            total += amounts[i];
            leaves[i] = _leaf(e, wallets[i], amounts[i]);
        }
        (bytes32 root, bytes32[] memory proof) = _rootAndProof(leaves, pick);
        _warpToEpoch(e);
        _bookUsdg(total * 2);
        _warpToEpoch(e + 1);
        vm.prank(operator);
        vault.commitGrants(e, root, uint128(total), uint32(n));
        assertTrue(vault.verifyGrant(e, wallets[pick], amounts[pick], proof));
        assertFalse(vault.verifyGrant(e, wallets[pick], amounts[pick] + 1, proof));
        assertFalse(vault.verifyGrant(e + 1, wallets[pick], amounts[pick], proof));
    }

    // =========================================================================================================
    // withdrawForUsage
    // =========================================================================================================

    function _setupGranted() internal {
        _bookUsdg(1000e6); // 700e6 booked to tide 0
        _warpToEpoch(1);
        _commit(0, 600e6);
    }

    function test_withdraw_happyPath() public {
        _setupGranted();
        bytes32 usageRoot = keccak256("usage");
        vm.expectEmit(address(vault));
        emit UsageWithdrawn(0, 250e6, usageRoot);
        vm.prank(operator);
        vault.withdrawForUsage(0, 250e6, usageRoot);
        assertEq(usdg.balanceOf(settlement), 250e6);
        assertEq(vault.remaining(0), 450e6);
        assertEq(vault.totalOpen(), 450e6);
        (, uint128 withdrawn,,,,) = vault.epochs(0);
        assertEq(withdrawn, 250e6);
    }

    function test_withdraw_cumulativeBoundByGranted() public {
        _setupGranted();
        vm.startPrank(operator);
        vault.withdrawForUsage(0, 400e6, 0);
        vault.withdrawForUsage(0, 200e6, 0);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.ExceedsGranted.selector, 1, 0));
        vault.withdrawForUsage(0, 1, 0);
        vm.stopPrank();
        assertEq(vault.remaining(0), 100e6); // dust (booked - granted) stays for the Trench
    }

    function test_withdraw_revertsAboveGranted() public {
        _setupGranted();
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.ExceedsGranted.selector, 600e6 + 1, 600e6));
        vault.withdrawForUsage(0, 600e6 + 1, 0);
    }

    function test_withdraw_revertsWhenNotCommitted() public {
        _bookUsdg(1000e6);
        _warpToEpoch(1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.ExceedsGranted.selector, 1, 0));
        vault.withdrawForUsage(0, 1, 0);
        // nor from the running tide
        _bookUsdg(1000e6);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.ExceedsGranted.selector, 1, 0));
        vault.withdrawForUsage(1, 1, 0);
    }

    function test_withdraw_onlyOperator() public {
        _setupGranted();
        vm.prank(alice);
        vm.expectRevert(EbbVault.NotOperator.selector);
        vault.withdrawForUsage(0, 1, 0);
        vm.prank(settlement);
        vm.expectRevert(EbbVault.NotOperator.selector);
        vault.withdrawForUsage(0, 1, 0);
    }

    function test_withdraw_revertsOnZero() public {
        _setupGranted();
        vm.prank(operator);
        vm.expectRevert(EbbVault.ZeroAmount.selector);
        vault.withdrawForUsage(0, 0, 0);
    }

    function test_withdraw_expiryBoundary() public {
        _setupGranted();
        vm.warp(vault.expiresAt(0) - 1);
        vm.prank(operator);
        vault.withdrawForUsage(0, 1, 0);
        vm.warp(vault.expiresAt(0));
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.EpochExpired.selector, 0));
        vault.withdrawForUsage(0, 1, 0);
    }

    function test_withdraw_revertsWhenFrozen() public {
        _setupGranted();
        vm.prank(guardian);
        vault.freezeOperator();
        vm.prank(operator);
        vm.expectRevert(EbbVault.OperatorIsFrozen.selector);
        vault.withdrawForUsage(0, 1, 0);
    }

    // =========================================================================================================
    // burnExpired
    // =========================================================================================================

    function test_burn_revertsBeforeExpiry() public {
        _bookUsdg(1000e6);
        uint256 exp = vault.expiresAt(0);
        vm.warp(exp - 1);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.EpochNotExpired.selector, 0, exp));
        vault.burnExpired(0, type(uint128).max);
    }

    function test_burn_happyPath() public {
        _bookUsdg(1000e6); // 700e6
        vm.warp(vault.expiresAt(0));
        uint256 supplyBefore = ebb.totalSupply();

        vm.expectEmit(address(vault));
        emit Burned(0, 700e6, 69_825e18, keeper, 1_750000);
        vm.prank(keeper);
        vault.burnExpired(0, type(uint128).max);

        assertEq(ebb.totalSupply(), supplyBefore - 69_825e18, "I7");
        assertEq(ebb.balanceOf(address(vault)), 0);
        assertEq(usdg.balanceOf(keeper), 1_750000);
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertEq(usdg.balanceOf(address(adapter)), 698_250000);
        assertEq(vault.remaining(0), 0);
        assertEq(vault.totalOpen(), 0);
        (,, uint128 burned,,,) = vault.epochs(0);
        assertEq(burned, 700e6);
        assertEq(usdg.allowance(address(vault), address(adapter)), 0);
    }

    function test_burn_includesGrantedButUnspent() public {
        _setupGranted(); // 700 booked, 600 granted
        vm.prank(operator);
        vault.withdrawForUsage(0, 100e6, 0);
        vm.warp(vault.expiresAt(0));
        vault.burnExpired(0, type(uint128).max);
        (,, uint128 burned,,,) = vault.epochs(0);
        assertEq(burned, 600e6);
        assertEq(vault.remaining(0), 0);
    }

    function test_burn_slices() public {
        _bookUsdg(1000e6);
        vm.warp(vault.expiresAt(0));
        vm.prank(keeper);
        vault.burnExpired(0, 200e6);
        assertEq(vault.remaining(0), 500e6);
        assertEq(usdg.balanceOf(keeper), 200e6 * 25 / 10_000);
        vm.prank(keeper);
        vault.burnExpired(0, 200e6);
        vm.prank(keeper);
        vault.burnExpired(0, 200e6);
        vm.prank(keeper);
        vault.burnExpired(0, 200e6); // only 100e6 left
        assertEq(vault.remaining(0), 0);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.NothingToBurn.selector, 0));
        vault.burnExpired(0, 200e6);
    }

    function test_burn_tipCappedAtTwoDollars() public {
        _bookUsdg(100_000e6); // 70_000e6 booked
        vm.warp(vault.expiresAt(0));
        vm.expectEmit(address(vault));
        emit Burned(0, 70_000e6, (70_000e6 - 2e6) * 1e12 * 100, keeper, 2e6);
        vm.prank(keeper);
        vault.burnExpired(0, type(uint128).max);
        assertEq(usdg.balanceOf(keeper), 2e6);
    }

    function test_burn_revertsOnZeroMax() public {
        _bookUsdg(1000e6);
        vm.warp(vault.expiresAt(0));
        vm.expectRevert(abi.encodeWithSelector(EbbVault.NothingToBurn.selector, 0));
        vault.burnExpired(0, 0);
    }

    function test_burn_revertsOnEmptyEpoch() public {
        vm.warp(vault.expiresAt(5));
        vm.expectRevert(abi.encodeWithSelector(EbbVault.NothingToBurn.selector, 5));
        vault.burnExpired(5, 1);
    }

    function test_burn_thenWithdrawReverts_I4() public {
        _setupGranted();
        vm.warp(vault.expiresAt(0));
        vault.burnExpired(0, type(uint128).max);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EbbVault.EpochExpired.selector, 0));
        vault.withdrawForUsage(0, 1, 0);
    }

    function test_burn_tinyAmount() public {
        _bookUsdg(2); // 2 - 0 = 2 booked (treasury share rounds to 0)
        assertEq(vault.remaining(0), 2);
        vm.warp(vault.expiresAt(0));
        vault.burnExpired(0, type(uint128).max); // tip 0, swap 2 units
        assertEq(vault.remaining(0), 0);
    }

    function test_burn_slippageWithinBound() public {
        _bookUsdg(1000e6);
        adapter.setSlippageBps(300);
        vm.warp(vault.expiresAt(0));
        vault.burnExpired(0, type(uint128).max);
        assertEq(vault.remaining(0), 0);
    }

    function test_burn_revertsBeyondBound_vaultCheck() public {
        _bookUsdg(1000e6);
        adapter.setSlippageBps(301);
        adapter.setEnforceMinOut(false);
        vm.warp(vault.expiresAt(0));
        uint256 minOut = 69_825e18 * 9700 / 10_000;
        uint256 out = 69_825e18 * 9699 / 10_000;
        vm.expectRevert(abi.encodeWithSelector(EbbVault.SlippageExceeded.selector, out, minOut));
        vault.burnExpired(0, type(uint128).max);
    }

    function test_burn_revertsBeyondBound_adapterCheck() public {
        _bookUsdg(1000e6);
        adapter.setSlippageBps(500);
        vm.warp(vault.expiresAt(0));
        vm.expectRevert(); // MockSwapAdapter.InsufficientOutput
        vault.burnExpired(0, type(uint128).max);
        assertEq(vault.remaining(0), 700e6); // nothing changed
    }

    function test_burn_tokenWithoutBurnGoesToDead() public {
        NoBurnToken nb = new NoBurnToken(address(this));
        _burnWithToken(address(nb));
        assertEq(nb.balanceOf(DEAD), 69_825e18);
        assertEq(nb.totalSupply(), 1_000_000_000e18);
    }

    function test_burn_tokenWithSilentFallbackGoesToDead() public {
        FallbackToken fb = new FallbackToken(address(this));
        _burnWithToken(address(fb));
        assertEq(fb.balanceOf(DEAD), 69_825e18);
    }

    function _burnWithToken(address t) internal {
        oracle.setPrice(t, EBB_USD, 18);
        EbbVault.Config memory c = _config();
        c.token = t;
        EbbVault v = new EbbVault(c);
        // inventory for the adapter
        (bool ok,) = t.call(abi.encodeWithSignature("transfer(address,uint256)", address(adapter), 100_000_000e18));
        assertTrue(ok);
        usdg.mint(address(v), 1000e6);
        v.harvest();
        vm.warp(v.expiresAt(0));
        v.burnExpired(0, type(uint128).max);
        assertEq(v.remaining(0), 0);
        (, bytes memory ret) = t.staticcall(abi.encodeWithSignature("balanceOf(address)", address(v)));
        assertEq(abi.decode(ret, (uint256)), 0);
    }

    function test_burn_adapterUnderSpendReverts() public {
        UnderSpendAdapter bad = new UnderSpendAdapter(adapter);
        vm.prank(deployer);
        ebb.transfer(address(bad), 1_000_000e18);
        EbbVault v = _vaultWithAdapter(ISwapAdapter(address(bad)));
        vm.warp(v.expiresAt(0));
        vm.expectRevert(abi.encodeWithSelector(EbbVault.AdapterSpendMismatch.selector, 349_125000, 698_250000));
        v.burnExpired(0, type(uint128).max);
    }

    function test_burn_adapterRefundReverts() public {
        RefundingAdapter bad = new RefundingAdapter(adapter);
        vm.prank(deployer);
        ebb.transfer(address(bad), 1_000_000e18);
        EbbVault v = _vaultWithAdapter(ISwapAdapter(address(bad)));
        vm.warp(v.expiresAt(0));
        vm.expectRevert(abi.encodeWithSelector(EbbVault.AdapterSpendMismatch.selector, 0, 698_250000));
        v.burnExpired(0, type(uint128).max);
    }

    function test_burn_reentrancyViaAdapterBlocked() public {
        ReentrantAdapter ra = new ReentrantAdapter(adapter);
        vm.prank(deployer);
        ebb.transfer(address(ra), 1_000_000e18);
        EbbVault v = _vaultWithAdapter(ISwapAdapter(address(ra)));
        vm.warp(v.expiresAt(0));
        bytes[3] memory calls = [
            abi.encodeCall(EbbVault.burnExpired, (0, type(uint128).max)),
            abi.encodeCall(EbbVault.harvest, ()),
            abi.encodeCall(EbbVault.withdrawForUsage, (0, 1, bytes32(0)))
        ];
        for (uint256 i; i < calls.length; ++i) {
            ra.arm(address(v), calls[i]);
            vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
            v.burnExpired(0, 100e6);
        }
        ra.arm(address(0), "");
        v.burnExpired(0, type(uint128).max); // unarmed adapter works
        assertEq(v.remaining(0), 0);
    }

    function _vaultWithAdapter(ISwapAdapter a) internal returns (EbbVault v) {
        EbbVault.Config memory c = _config();
        c.swapAdapter = a;
        v = new EbbVault(c);
        usdg.mint(address(v), 1000e6);
        v.harvest(); // 700e6 to tide 0, no ETH so the adapter is not used
    }

    function testFuzz_burn_tipAndSlice(uint256 booked, uint256 maxAmount) public {
        booked = bound(booked, 1, 10_000_000e6);
        maxAmount = bound(maxAmount, 1, type(uint128).max);
        // book exactly `booked`: donate x with x - floor(0.3x) == booked is not always solvable; use the result
        usdg.mint(address(vault), booked);
        vault.harvest();
        uint256 rem = vault.remaining(0);
        vm.warp(vault.expiresAt(0));
        uint256 supply0 = ebb.totalSupply();
        uint256 keeper0 = usdg.balanceOf(keeper);

        uint256 amount = rem < maxAmount ? rem : maxAmount;
        uint256 tip = amount * 25 / 10_000;
        if (tip > 2e6) tip = 2e6;

        vm.recordLogs();
        vm.prank(keeper);
        vault.burnExpired(0, uint128(maxAmount));

        assertEq(usdg.balanceOf(keeper) - keeper0, tip, "tip");
        assertLt(tip, amount);
        assertLe(tip, 2e6);
        assertEq(vault.remaining(0), rem - amount, "slice");
        uint256 ebbBurned = _lastBurnedEbb();
        assertEq(supply0 - ebb.totalSupply(), ebbBurned, "I7");
        uint256 q = oracle.quote(weth, address(ebb), oracle.quote(address(usdg), weth, amount - tip));
        assertGe(ebbBurned, q * 9700 / 10_000, "I6");
    }

    function _lastBurnedEbb() internal view returns (uint256 ebbBurned) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("Burned(uint256,uint256,uint256,address,uint256)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vault) && logs[i].topics[0] == sig) {
                (, ebbBurned,) = abi.decode(logs[i].data, (uint256, uint256, uint256));
            }
        }
    }

    // =========================================================================================================
    // pro-rata: floor(booked * w / Σw) never over-grants, dust stays and burns
    // =========================================================================================================

    function testFuzz_proRata_dustStaysAndBurns(uint256 inflow, uint256 seed, uint8 n) public {
        inflow = bound(inflow, 1, 1_000_000e6);
        n = uint8(bound(n, 1, 50));
        usdg.mint(address(vault), inflow);
        vault.harvest();
        (uint128 booked,,,,,) = vault.epochs(0);

        uint256[] memory twab = new uint256[](n);
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            twab[i] = uint256(keccak256(abi.encode(seed, i))) % 1e30 + 100_000e18; // >= GRANT_FLOOR
            sum += twab[i];
        }
        uint256 total;
        for (uint256 i; i < n; ++i) {
            total += uint256(booked) * twab[i] / sum;
        }
        assertLe(total, booked, "pro-rata never exceeds booked");
        assertLt(booked - total, n, "dust < number of wallets");

        _warpToEpoch(1);
        _commit(0, uint128(total));
        if (total > 0) {
            vm.prank(operator);
            vault.withdrawForUsage(0, uint128(total), 0);
        }
        assertEq(vault.remaining(0), booked - total);

        vm.warp(vault.expiresAt(0));
        if (booked - total > 0) {
            vault.burnExpired(0, type(uint128).max);
        }
        assertEq(vault.remaining(0), 0);
        assertEq(usdg.balanceOf(address(vault)), 0);
    }

    // =========================================================================================================
    // freezeOperator
    // =========================================================================================================

    function test_freeze_onlyGuardian() public {
        vm.prank(operator);
        vm.expectRevert(EbbVault.NotGuardian.selector);
        vault.freezeOperator();
        vm.prank(alice);
        vm.expectRevert(EbbVault.NotGuardian.selector);
        vault.freezeOperator();
    }

    function test_freeze_oneWay() public {
        vm.expectEmit(address(vault));
        emit OperatorFrozen();
        vm.prank(guardian);
        vault.freezeOperator();
        assertTrue(vault.operatorFrozen());
        vm.prank(guardian);
        vm.expectRevert(EbbVault.OperatorIsFrozen.selector);
        vault.freezeOperator();
    }

    function test_freeze_everythingStillBurns() public {
        _setupGranted();
        vm.prank(operator);
        vault.withdrawForUsage(0, 100e6, 0);
        vm.prank(guardian);
        vault.freezeOperator();
        // inflow keeps flowing, nothing can be withdrawn, all of it burns at expiry
        _harvestEth(1 ether);
        vm.warp(vault.expiresAt(1));
        vault.burnExpired(0, type(uint128).max);
        vault.burnExpired(1, type(uint128).max);
        assertEq(vault.totalOpen(), 0);
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertEq(usdg.balanceOf(settlement), 100e6);
    }

    // =========================================================================================================
    // views
    // =========================================================================================================

    function test_views_totalOpenTracksAllEpochs() public {
        _bookUsdg(1000e6);
        _warpToEpoch(1);
        _bookUsdg(2000e6);
        _warpToEpoch(2);
        _commit(0, 700e6);
        vm.prank(operator);
        vault.withdrawForUsage(0, 300e6, 0);
        assertEq(vault.remaining(0), 400e6);
        assertEq(vault.remaining(1), 1400e6);
        assertEq(vault.totalOpen(), 1800e6);
        assertEq(usdg.balanceOf(address(vault)), vault.totalOpen());
    }
}
