// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {EbbMainnetBase} from "../../script/EbbMainnetBase.sol";
import {EbbVault} from "../../src/EbbVault.sol";
import {EbbLauncher} from "../../src/EbbLauncher.sol";
import {PoolKey, IPoolManager} from "../../src/adapters/UniswapV4Adapter.sol";
import {
    IPonsFactory,
    IPonsCurve,
    IPonsMemeHook,
    IPonsFeeEscrow,
    PonsTokenParams,
    PonsSocials,
    PonsLaunchedToken
} from "../../src/interfaces/IPons.sol";
import {V4Trader} from "../utils/V4Trader.sol";
import {PonsSwapAdapter} from "../../src/adapters/PonsSwapAdapter.sol";

/// @notice End-to-end against the REAL pons v2 contracts on Robinhood Chain mainnet (4663), on a fork.
///         Skipped unless FORK_URL is set:
///           FORK_URL=https://robinhood-rpc.publicnode.com forge test --match-path 'test/fork/*' -vv
///         (optionally FORK_BLOCK=<n>; publicnode only serves recent state).
contract PonsMainnetForkTest is Test, EbbMainnetBase {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address internal deployer = makeAddr("ebb-fork-deployer");
    address internal operator = makeAddr("ebb-fork-operator");
    address internal guardian = makeAddr("ebb-fork-guardian");
    address internal treasury = makeAddr("ebb-fork-treasury");
    address internal settlement = makeAddr("ebb-fork-settlement");
    address internal devWallet = makeAddr("ebb-fork-devWallet");
    address internal keeper = makeAddr("ebb-fork-keeper");
    address internal t1 = makeAddr("ebb-fork-trader1");
    address internal t2 = makeAddr("ebb-fork-trader2");
    address internal t3 = makeAddr("ebb-fork-trader3");
    address internal whale = makeAddr("ebb-fork-whale");

    IPonsFactory internal f = IPonsFactory(PONS_FACTORY);
    IERC20 internal usdg = IERC20(USDG);

    MainnetConfig internal cfg;
    Deployed internal d;
    IERC20 internal ebb;
    IPonsCurve internal curve;

    V4Trader internal trader;
    uint256 internal tideG;
    uint256 internal treasuryIn; // ghost: USDG sent to treasury
    uint256 internal tipsIn;

    function setUp() public {
        string memory url = vm.envOr("FORK_URL", string(""));
        if (bytes(url).length == 0) {
            vm.skip(true);
            return;
        }
        uint256 blk = vm.envOr("FORK_BLOCK", uint256(0));
        if (blk == 0) vm.createSelectFork(url);
        else vm.createSelectFork(url, blk);
        assertEq(block.chainid, 4663, "not Robinhood mainnet");
    }

    // =========================================================================================================
    // helpers
    // =========================================================================================================

    function _cfg(address pair, uint16 taxBps) internal view returns (MainnetConfig memory c) {
        c.deployer = deployer;
        c.operator = operator;
        c.guardian = guardian;
        c.treasury = treasury;
        c.settlement = settlement;
        c.pairToken = pair;
        c.creatorTaxBps = taxBps;
        c.launchConfigId = 0;
        c.devBuyRecipient = devWallet;
        c.genesis = uint64((block.timestamp / 1800 + 1) * 1800);
        c.params = PonsTokenParams({
            name: "Ebb",
            symbol: "EBB",
            logo: "ipfs://ebb-logo",
            description: "Spend it, or the tide takes it.",
            socials: PonsSocials({
                twitter: "https://x.com/ebb", telegram: "", discord: "", website: "https://ebb.example", farcaster: ""
            }),
            creatorFeeRecipient: address(0),
            creatorTaxBps: 0,
            buybackEnabled: false,
            expectedEconomics: bytes32(0),
            salt: keccak256("ebb-fork-salt")
        });
    }

    function _deployAndLaunch(address pair, uint16 taxBps, uint256 devBuy) internal returns (uint256 devTokens) {
        cfg = _cfg(pair, taxBps);
        vm.deal(deployer, 10 ether);
        vm.startPrank(deployer, deployer);
        d = _deployAll(cfg);
        vm.stopPrank();
        ebb = IERC20(d.token);
        curve = IPonsCurve(d.curve);

        // launch at genesis (as on launch day: genesis == go time)
        vm.warp(cfg.genesis);
        PonsTokenParams memory p = _launchParams(cfg, address(d.vault), d.economics);
        uint256 fee = f.launchFee();
        uint256 balBefore = deployer.balance;
        vm.recordLogs();
        vm.prank(deployer, deployer);
        (address token, address curve_, uint256 dt) =
            d.launcher.launch{value: pair == address(0) ? fee + devBuy : fee}(p, devBuy);
        devTokens = dt;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(d.launcher) && logs[i].topics[0] == EbbLauncher.Launched.selector) {
                (lastDevSpend,) = abi.decode(logs[i].data, (uint256, uint256));
            }
        }
        console.log("launch: dev buy quote spent", lastDevSpend);
        assertEq(token, d.token, "token != predicted");
        assertEq(curve_, d.curve, "curve != predicted");
        if (pair == address(0)) {
            uint256 spentTotal = balBefore - deployer.balance;
            console.log("launch: fee + dev buy spent (wei)", spentTotal);
            console.log("launch: refunded to deployer (wei)", fee + devBuy - spentTotal);
            assertEq(deployer.code.length, 0, "test deployer must be an EOA on the fork");
            assertEq(address(d.launcher).balance, 0, "launcher kept ETH");
            if (devBuy != 0) {
                assertEq(spentTotal, fee + d.launcher.devBuySpend(curve_, token, 0) + _lastDevSpend(), "refund");
            }
            console.log("launcher ETH left (wei)", address(d.launcher).balance);
            console.log("curve realQuoteReserve after dev buy (wei)", IPonsCurve(curve_).realQuoteReserve());
        }
    }

    uint256 internal lastDevSpend;

    function _lastDevSpend() internal view returns (uint256) {
        return lastDevSpend;
    }

    function _buyCurve(address who, uint256 amountEth) internal returns (uint256 out) {
        vm.deal(who, who.balance + amountEth);
        vm.prank(who);
        out = curve.buy{value: amountEth}(amountEth, 0, who);
    }

    function _harvest() internal returns (uint256 toPool, uint256 toTreasury) {
        uint256 tb = usdg.balanceOf(treasury);
        uint256 openBefore = d.vault.totalOpen();
        vm.prank(keeper);
        d.vault.harvest();
        toTreasury = usdg.balanceOf(treasury) - tb;
        toPool = d.vault.totalOpen() - openBefore;
        treasuryIn += toTreasury;
        _checkInvariants();
    }

    function _pokeFor(uint256 secs) internal {
        uint256 end = block.timestamp + secs;
        while (block.timestamp < end) {
            vm.warp(block.timestamp + 150);
            d.twap.poke();
        }
    }

    function _checkInvariants() internal view {
        // I1: vault USDG == Σ remaining == totalOpen (after every harvest/burn)
        assertEq(usdg.balanceOf(address(d.vault)), d.vault.totalOpen(), "I1");
        // I2 for the tides we touch
        for (uint256 e; e <= d.vault.currentEpoch() && e < 1000; e += 1) {
            (uint128 booked, uint128 withdrawn, uint128 burned,, uint128 granted,) = d.vault.epochs(e);
            assertLe(withdrawn, granted, "I2a");
            assertLe(granted, booked, "I2b");
            assertLe(uint256(withdrawn) + burned, booked, "I2c");
        }
    }

    function _burn(uint256 epoch, uint128 maxAmount) internal returns (uint256 ebbBurned, uint256 tip) {
        uint256 supplyBefore = ebb.totalSupply();
        uint256 deadBefore = ebb.balanceOf(DEAD);
        uint256 keeperBefore = usdg.balanceOf(keeper);
        (,, uint128 burnedBefore,,,) = d.vault.epochs(epoch);
        vm.recordLogs();
        vm.prank(keeper);
        d.vault.burnExpired(epoch, maxAmount);
        (,, uint128 burnedAfter,,,) = d.vault.epochs(epoch);
        tip = usdg.balanceOf(keeper) - keeperBefore;
        ebbBurned = supplyBefore - ebb.totalSupply();
        tipsIn += tip;
        // I7: totalSupply drops by exactly ebbBurned (token has ERC20Burnable.burn, so nothing goes to 0x…dEaD)
        assertGt(ebbBurned, 0, "nothing burned");
        assertEq(ebb.balanceOf(DEAD), deadBefore, "dead balance moved: burn() not used");
        assertEq(uint256(burnedAfter - burnedBefore), maxAmount, "slice");
        assertEq(ebb.balanceOf(address(d.vault)), 0, "vault kept EBB");
        _checkInvariants();
    }

    struct HookLaunch {
        bool registered;
        bool memecoinIsCurrency0;
        address memecoin;
        address quoteToken;
        address creator;
        address buybackCreatorRecipient;
        address protocolFeeRecipient;
        uint16 creatorTaxBps;
        uint16 protocolFeeShareBps;
        uint16 buybackBurnBps;
        uint16 hookFeeBps;
        uint16 maxInternalPriceImpactBps;
        bool buybackEnabled;
    }

    function _hookInfo(bytes32 poolId) internal view returns (HookLaunch memory info) {
        (bool ok, bytes memory ret) = PONS_HOOK.staticcall(abi.encodeCall(IPonsMemeHook.launches, (poolId)));
        require(ok, "launches()");
        info = abi.decode(ret, (HookLaunch));
    }

    function _poolKey() internal view returns (PoolKey memory) {
        return d.adapter.poolKey();
    }

    // =========================================================================================================
    // ETH pairing (the launch configuration): 2% creator tax, 0.1 ETH dev buy
    // =========================================================================================================

    function test_fork_ethPair_endToEnd() public {
        _ethLaunchAndControls();
        _ethCurveTradingAndHarvest();
        _ethGraduateAndPoolFees();
        _ethPostGraduationBurn();
    }

    function _ethLaunchAndControls() internal {
        uint256 devTokens = _deployAndLaunch(address(0), 200, 0.1 ether);
        uint256 supply = ebb.totalSupply();
        assertEq(supply, 1e27);

        // ---- launch record: who controls fees ---------------------------------------------------------------
        PonsLaunchedToken memory rec = f.getLaunchedToken(d.token);
        assertEq(rec.creatorFeeRecipient, address(d.vault), "creatorFeeRecipient");
        assertEq(rec.deployer, address(d.launcher), "initiator");
        assertEq(rec.pairToken, address(0));
        assertEq(rec.creatorTaxBps, 200);
        assertFalse(rec.buybackEnabled);
        assertEq(curve.deployer(), address(d.vault), "curve creator");
        assertEq(curve.creatorTaxBps(), 200);
        assertTrue(d.launcher.launched());

        // ---- dev buy: capped at 2% of supply, rest refunded -------------------------------------------------
        assertEq(ebb.balanceOf(devWallet), devTokens);
        assertLe(devTokens, supply * 200 / 10_000, "dev buy over 2%");
        console.log("dev buy tokens (1e18)", devTokens / 1e18);
        console.log("dev buy % of supply x100", devTokens * 10_000 / supply);
        // relaunching is impossible
        vm.prank(deployer, deployer);
        vm.expectRevert(EbbLauncher.AlreadyLaunched.selector);
        d.launcher.launch(_launchParams(cfg, address(d.vault), d.economics), 0);

        // ---- nobody we control can redirect fees -------------------------------------------------------------
        vm.prank(deployer);
        vm.expectRevert();
        f.transferCreatorFeeRecipient(d.token, deployer);
        vm.prank(address(d.launcher));
        vm.expectRevert();
        f.transferCreatorFeeRecipient(d.token, deployer);
        vm.prank(deployer);
        vm.expectRevert();
        f.setBuybackEnabled(d.token, true);
    }

    function _ethCurveTradingAndHarvest() internal {
        // ---- curve trading by several wallets (after the 3 s snipe window) ----------------------------------
        vm.warp(block.timestamp + 10);
        uint256 o1 = _buyCurve(t1, 0.3 ether);
        uint256 o2 = _buyCurve(t2, 0.5 ether);
        _buyCurve(t3, 0.2 ether);
        vm.startPrank(t1);
        ebb.approve(address(curve), o1 / 2);
        curve.sell(o1 / 2, 0, t1);
        vm.stopPrank();
        vm.startPrank(t2);
        ebb.approve(address(curve), o2 / 3);
        curve.sell(o2 / 3, 0, t2);
        vm.stopPrank();

        uint256 pendingFee = curve.quoteFeeBalance();
        uint256 pendingTax = curve.creatorTaxBalance();
        uint256 expectedCreator = pendingFee - pendingFee * 3000 / 10_000 + pendingTax;
        console.log("curve pending base fee (wei)", pendingFee);
        console.log("curve pending creator tax (wei)", pendingTax);

        // ---- harvest #1 (tide 0): vault sweeps the curve as creator, claims the escrow, swaps ETH->USDG on V3 --
        uint256 escrowBefore = IPonsFeeEscrow(PONS_ESCROW).balanceOf(address(d.vault));
        assertEq(escrowBefore, 0);
        vm.recordLogs();
        (uint256 toPool, uint256 toTreasury) = _harvest();
        assertEq(curve.quoteFeeBalance(), 0, "curve not swept");
        assertEq(IPonsFeeEscrow(PONS_ESCROW).balanceOf(address(d.vault)), 0, "escrow not claimed");
        assertEq(address(d.vault).balance, 0, "ETH left in vault");
        assertGt(toPool, 0);
        // I5: 70/30, rounding to the pool
        uint256 usdgOut = toPool + toTreasury;
        assertEq(toTreasury, usdgOut * 3000 / 10_000);
        uint256 fair = d.oracle.v3Quote(WETH, USDG, expectedCreator);
        console.log("harvest#1 creator ETH (wei)", expectedCreator);
        console.log("harvest#1 USDG out (6dp)", usdgOut);
        console.log("harvest#1 V3 TWAP fair USDG", fair);
        assertGe(usdgOut, fair * 9700 / 10_000, "I6 bound");

        // inject extra inflow so the burn tests have depth: 1 ETH of "fees" at tide 0
        vm.deal(address(d.vault), 1 ether);
        _harvest();
        (uint128 booked0,,,,,) = d.vault.epochs(0);
        console.log("tide 0 booked (USDG 6dp)", booked0);

        // ---- pre-graduation burn: expired tide 0, $EBB bought on the curve and burned ----------------------
        vm.warp(d.vault.expiresAt(0) - 40 minutes);
        d.twap.poke();
        _pokeFor(40 minutes);
        assertGe(block.timestamp, d.vault.expiresAt(0));
        assertEq(f.getLaunchedToken(d.token).phase, 0, "still on curve");
        (uint256 burned1, uint256 tip1) = _burn(0, 20e6);
        console.log("pre-grad burn: 20 USDG -> EBB burned (1e18)", burned1 / 1e18);
        console.log("pre-grad burn tip (6dp)", tip1);
        assertEq(tip1, 20e6 * 25 / 10_000);
    }

    function _ethGraduateAndPoolFees() internal {
        // ---- push the curve to graduation ------------------------------------------------------------------
        uint256 phantomLeft = curve.sellableTokens();
        assertGt(phantomLeft, 0);
        _buyCurve(whale, 6 ether); // clamped fill completes the curve; auto-graduation runs inside the buy
        PonsLaunchedToken memory rec2 = f.getLaunchedToken(d.token);
        if (rec2.phase == 1) f.createGraduatedPool(d.token);
        assertEq(f.getLaunchedToken(d.token).phase, 2, "not graduated");
        console.log("graduated; whale refund kept, ETH balance", whale.balance);
        HookLaunch memory info = _hookInfo(d.poolId);
        assertTrue(info.registered, "pool not registered at predicted poolId");
        assertEq(info.creator, address(d.vault), "hook creator");
        assertEq(info.creatorTaxBps, 200);
        assertFalse(info.buybackEnabled);
        console.log("hook fee bps", info.hookFeeBps);

        // graduation swept the curve's remaining fees to the vault's escrow balance
        uint256 escrowAfterGrad = IPonsFeeEscrow(PONS_ESCROW).balanceOf(address(d.vault));
        console.log("escrow ETH credited at graduation (wei)", escrowAfterGrad);

        // ---- v4 pool trading ----------------------------------------------------------------------------------
        trader = new V4Trader(IPoolManager(V4_POOL_MANAGER));
        PoolKey memory key = _poolKey();
        assertEq(key.currency0, address(0));
        vm.deal(t3, 2 ether);
        vm.prank(t3);
        uint256 bought = trader.swap{value: 1 ether}(key, true, 1 ether); // ETH -> EBB
        vm.startPrank(t3);
        ebb.approve(address(trader), bought / 2);
        trader.swap(key, false, bought / 2); // EBB -> ETH
        vm.stopPrank();
        uint256 pendEth = IPonsMemeHook(PONS_HOOK).pendingFees(d.poolId, address(0))
            + IPonsMemeHook(PONS_HOOK).pendingCreatorTax(d.poolId, address(0));
        uint256 pendEbb = IPonsMemeHook(PONS_HOOK).pendingFees(d.poolId, d.token)
            + IPonsMemeHook(PONS_HOOK).pendingCreatorTax(d.poolId, d.token);
        console.log("hook pending ETH fees (wei)", pendEth);
        console.log("hook pending EBB fees (1e18)", pendEbb / 1e18);

        // harvest at a later tide: hook sweep by the vault is refused while EBB fees await conversion
        // (InternalSwapRequiresOperator, swallowed), but the graduation credit is claimed and swapped
        tideG = d.vault.currentEpoch();
        _harvest();
        assertEq(IPonsFeeEscrow(PONS_ESCROW).balanceOf(address(d.vault)), 0);
        assertGt(IPonsMemeHook(PONS_HOOK).pendingFees(d.poolId, d.token), 0, "vault could not have swept EBB fees");

        // pons' sweep operator converts + distributes; the vault's next harvest collects its creator share
        address op = IPonsMemeHook(PONS_HOOK).feeSweepOperator();
        vm.prank(op);
        IPonsMemeHook(PONS_HOOK).sweepPoolFees(d.poolId, 1, 0);
        uint256 credited = IPonsFeeEscrow(PONS_ESCROW).balanceOf(address(d.vault));
        console.log("post-grad creator ETH credited by operator sweep (wei)", credited);
        assertGt(credited, 0);
        (uint256 toPool2,) = _harvest();
        assertGt(toPool2, 0);
        (uint128 bookedG,,,,,) = d.vault.epochs(tideG);
        console.log("tide", tideG);
        console.log("  booked (USDG 6dp)", bookedG);
    }

    function _ethPostGraduationBurn() internal {
        (uint128 bookedG,,,,,) = d.vault.epochs(tideG);
        // ---- operator flow on tide G (grants + usage) -------------------------------------------------------
        vm.warp(d.vault.epochStart(tideG + 1));
        vm.prank(operator);
        d.vault.commitGrants(tideG, keccak256("root"), bookedG / 2, 3);
        vm.prank(operator);
        d.vault.withdrawForUsage(tideG, bookedG / 4, keccak256("usage"));
        assertEq(usdg.balanceOf(settlement), bookedG / 4);
        _checkInvariants();

        // ---- post-graduation burn: tide G expired, USDG -> ETH (V3) -> EBB (v4 pool) -> burn() --------------
        vm.warp(d.vault.expiresAt(tideG) - 3 hours);
        _pokeFor(3 hours); // lets the clamped TWAP catch up with the post-graduation price
        uint256 supplyBefore = ebb.totalSupply();
        (uint256 burned2, uint256 tip2) = _burn(tideG, 10e6);
        console.log("post-grad burn: 10 USDG -> EBB burned (1e18)", burned2 / 1e18);
        assertEq(supplyBefore - ebb.totalSupply(), burned2, "I7");
        assertEq(tip2, 10e6 * 25 / 10_000);
        uint256 quoteFair = d.oracle.quote(WETH, d.token, d.oracle.quote(USDG, WETH, 10e6 - tip2));
        console.log("  oracle fair EBB out (net of pons fee, 1e18)", quoteFair / 1e18);

        // slicing: rest of the tide in slices
        (uint128 b, uint128 w, uint128 bu,,,) = d.vault.epochs(tideG);
        uint256 rem = uint256(b) - w - bu;
        console.log("  remaining in tide (6dp)", rem);

        // sandwich / manipulation: someone pumps the pool right before the burn -> the burn reverts
        // (fails closed against the TWAP) instead of buying at the pumped price
        uint256 snap = vm.snapshotState();
        vm.deal(whale, whale.balance + 3 ether);
        vm.prank(whale);
        trader.swap{value: 3 ether}(_poolKey(), true, 3 ether);
        vm.prank(keeper);
        vm.expectPartialRevert(PonsSwapAdapter.InsufficientOutput.selector); // adapter's own minOut check fires first
        d.vault.burnExpired(tideG, 10e6);
        vm.revertToState(snap);

        // the rest of the tide burns in one more call at the fair price
        (uint256 burned3,) = _burn(tideG, uint128(rem));
        console.log("  burned rest of tide, EBB (1e18)", burned3 / 1e18);
        assertEq(d.vault.remaining(tideG), 0);

        // I8-ish conservation: everything that left the vault went to treasury / settlement / tips / burn swaps
        console.log("treasury USDG total (6dp)", usdg.balanceOf(treasury));
        assertEq(usdg.balanceOf(treasury), treasuryIn);
        assertEq(usdg.balanceOf(keeper), tipsIn);
        assertEq(usdg.balanceOf(address(d.adapter)), 0);
        assertEq(address(d.adapter).balance, 0);
        assertEq(ebb.balanceOf(address(d.adapter)), 0);

        // guardian freeze still works on mainnet wiring
        vm.prank(guardian);
        d.vault.freezeOperator();
        assertTrue(d.vault.operatorFrozen());
    }

    // =========================================================================================================
    // USDG pairing (alternative): fees booked directly in USDG, burn USDG -> EBB directly
    // =========================================================================================================

    function _buyCurveUsdg(address who, uint256 amount) internal returns (uint256 out) {
        deal(USDG, who, usdg.balanceOf(who) + amount);
        vm.startPrank(who);
        usdg.approve(address(curve), amount);
        out = curve.buy(amount, 0, who);
        vm.stopPrank();
    }

    function test_fork_usdgPair_endToEnd() public {
        cfg = _cfg(USDG, 200);
        vm.deal(deployer, 1 ether);
        vm.startPrank(deployer, deployer);
        d = _deployAll(cfg);
        vm.stopPrank();
        ebb = IERC20(d.token);
        curve = IPonsCurve(d.curve);
        vm.warp(cfg.genesis);
        deal(USDG, deployer, 100e6);
        vm.startPrank(deployer, deployer);
        usdg.approve(address(d.launcher), 100e6);
        (,, uint256 devTokens) =
            d.launcher.launch{value: f.launchFee()}(_launchParams(cfg, address(d.vault), d.economics), 100e6);
        vm.stopPrank();
        assertLe(devTokens, 1e27 * 200 / 10_000);
        console.log("usdg pair: dev buy 100 USDG -> tokens (1e18)", devTokens / 1e18);
        assertEq(f.getLaunchedToken(d.token).pairToken, USDG);

        vm.warp(block.timestamp + 10);
        uint256 o1 = _buyCurveUsdg(t1, 1000e6);
        _buyCurveUsdg(t2, 500e6);
        vm.startPrank(t1);
        ebb.approve(address(curve), o1 / 2);
        curve.sell(o1 / 2, 0, t1);
        vm.stopPrank();

        uint256 fee = curve.quoteFeeBalance();
        uint256 tax = curve.creatorTaxBalance();
        uint256 creator = fee - fee * 3000 / 10_000 + tax;
        (uint256 toPool, uint256 toTreasury) = _harvest();
        assertEq(toPool + toTreasury, creator, "USDG harvest must equal creator share exactly (no swap)");
        console.log("usdg pair harvest booked (6dp)", toPool);

        deal(USDG, address(d.vault), usdg.balanceOf(address(d.vault)) + 1000e6);
        _harvest();

        // pre-graduation burn on the curve
        vm.warp(d.vault.expiresAt(0) - 40 minutes);
        d.twap.poke();
        _pokeFor(40 minutes);
        (uint256 burned1,) = _burn(0, 20e6);
        console.log("usdg pair pre-grad burn EBB (1e18)", burned1 / 1e18);

        // graduate (threshold 8090 USDG)
        _buyCurveUsdg(whale, 12_000e6);
        if (f.getLaunchedToken(d.token).phase == 1) f.createGraduatedPool(d.token);
        assertEq(f.getLaunchedToken(d.token).phase, 2, "not graduated");

        uint256 tideU = d.vault.currentEpoch();
        deal(USDG, address(d.vault), usdg.balanceOf(address(d.vault)) + 500e6);
        _harvest();
        vm.warp(d.vault.expiresAt(tideU) - 3 hours);
        _pokeFor(3 hours);
        (uint256 burned2,) = _burn(tideU, 10e6);
        console.log("usdg pair post-grad burn EBB (1e18)", burned2 / 1e18);
    }
}

