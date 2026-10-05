// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {EbbMainnetBase} from "../../script/EbbMainnetBase.sol";
import {EbbVault} from "../../src/EbbVault.sol";
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

/// @dev pons v2 launch-and-buy router (what the Pons UI uses for a launch with an opening buy).
interface IPonsLaunchAndBuy {
    function launchAndBuy(
        PonsTokenParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        uint256 quoteIn,
        uint256 minTokensOut,
        address recipient,
        address[] calldata snipeTaxExemptions
    ) external payable returns (address token, address curve, uint256 tokensOut);
}

/// @notice "Launch via the Pons UI" flow on a Robinhood mainnet fork: the creator EOA launches with ITSELF as creator
///         fee recipient (ETH pair, 2% tax, buyback off, 0.1 ETH opening buy through the real launch-and-buy router),
///         we deploy the vault stack for the existing token (DeployForToken logic), and the creator hands the fees to
///         the vault with factory.transferCreatorFeeRecipient(token, vault).
///         Skipped unless FORK_URL is set (see PonsMainnet.fork.t.sol).
contract PonsUiFlowForkTest is Test, EbbMainnetBase {
    address internal constant LAUNCH_AND_BUY = 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;

    address internal creator = makeAddr("ebb-ui-creator");
    address internal deployer = makeAddr("ebb-ui-deployer");
    address internal operator = makeAddr("ebb-ui-operator");
    address internal guardian = makeAddr("ebb-ui-guardian");
    address internal treasury = makeAddr("ebb-ui-treasury");
    address internal settlement = makeAddr("ebb-ui-settlement");
    address internal keeper = makeAddr("ebb-ui-keeper");
    address internal t1 = makeAddr("ebb-ui-trader1");
    address internal t2 = makeAddr("ebb-ui-trader2");
    address internal whale = makeAddr("ebb-ui-whale");

    IPonsFactory internal f = IPonsFactory(PONS_FACTORY);
    IPonsFeeEscrow internal escrow = IPonsFeeEscrow(PONS_ESCROW);
    IERC20 internal usdg = IERC20(USDG);

    address internal token;
    IPonsCurve internal curve;
    Deployed internal d;

    function setUp() public {
        string memory url = vm.envOr("FORK_URL", string(""));
        if (bytes(url).length == 0) {
            vm.skip(true);
            return;
        }
        uint256 blk = vm.envOr("FORK_BLOCK", uint256(0));
        if (blk == 0) vm.createSelectFork(url);
        else vm.createSelectFork(url, blk);
        assertEq(block.chainid, 4663);
    }

    // ---- helpers --------------------------------------------------------------------------------------------

    /// @dev What the creator does in the Pons UI: ETH pair, 2% tax, buyback off, fee recipient = own wallet, 0.1 ETH buy.
    function _uiLaunch(bytes32 salt) internal returns (uint256 devTokens) {
        PonsTokenParams memory p = PonsTokenParams({
            name: "Ebb",
            symbol: "EBB",
            logo: "ipfs://ebb-logo",
            description: "Spend it, or the tide takes it.",
            socials: PonsSocials({
                twitter: "https://x.com/ebb",
                telegram: "https://t.me/ebb",
                discord: "",
                website: "https://ebb.example",
                farcaster: ""
            }),
            creatorFeeRecipient: creator,
            creatorTaxBps: 200,
            buybackEnabled: false,
            expectedEconomics: f.previewLaunchEconomics(0, address(0)),
            salt: salt
        });
        uint256 fee = f.launchFee();
        vm.deal(creator, 1 ether);
        vm.prank(creator, creator);
        (address tok, address cur, uint256 out) = IPonsLaunchAndBuy(LAUNCH_AND_BUY)
        .launchAndBuy{value: fee + 0.1 ether}(
            p, 0, address(0), 0.1 ether, 1, creator, new address[](0)
        );
        token = tok;
        curve = IPonsCurve(cur);
        devTokens = out;
        PonsLaunchedToken memory r = f.getLaunchedToken(token);
        assertEq(r.creatorFeeRecipient, creator);
        assertEq(r.deployer, creator, "router records the initiating wallet");
        console.log("UI launch: 0.1 ETH opening buy -> tokens (1e18)", out / 1e18);
        console.log("UI launch: % of supply x100", out * 10_000 / IERC20(token).totalSupply());
    }

    function _buy(address who, uint256 amt) internal returns (uint256 out) {
        vm.deal(who, who.balance + amt);
        vm.prank(who);
        out = curve.buy{value: amt}(amt, 0, who);
    }

    function _deployVault() internal {
        MainnetConfig memory c;
        c.deployer = deployer;
        c.operator = operator;
        c.guardian = guardian;
        c.treasury = treasury;
        c.settlement = settlement;
        c.pairToken = address(0);
        c.creatorTaxBps = 200;
        c.genesis = uint64((block.timestamp / 1800 + 1) * 1800);
        vm.startPrank(deployer, deployer);
        (d,) = _deployForToken(c, token);
        vm.stopPrank();
        assertEq(d.vault.token(), token);
        assertEq(d.vault.feeCurve(), address(curve));
        assertEq(d.vault.quote(), address(0));
    }

    /// @dev Creator sends exactly the call DeployForToken prints.
    function _transferToVault() internal {
        (address target, bytes memory data) = _transferCalldata(token, address(d.vault));
        console.log("transfer target", target);
        console.logBytes(data);
        vm.prank(creator, creator);
        (bool ok,) = target.call(data);
        assertTrue(ok, "transferCreatorFeeRecipient failed");
        assertEq(f.getLaunchedToken(token).creatorFeeRecipient, address(d.vault));
    }

    function _assertCreatorPowerless() internal {
        vm.startPrank(creator, creator);
        vm.expectRevert();
        f.transferCreatorFeeRecipient(token, creator);
        vm.expectRevert();
        f.setBuybackEnabled(token, true);
        vm.stopPrank();
        assertFalse(f.getLaunchedToken(token).buybackEnabled);
    }

    function _harvest() internal returns (uint256 toPool, uint256 usdgOut) {
        uint256 tb = usdg.balanceOf(treasury);
        uint256 open = d.vault.totalOpen();
        vm.prank(keeper);
        d.vault.harvest();
        toPool = d.vault.totalOpen() - open;
        usdgOut = toPool + usdg.balanceOf(treasury) - tb;
        assertEq(usdg.balanceOf(address(d.vault)), d.vault.totalOpen(), "I1");
        assertEq(address(d.vault).balance, 0, "ETH left");
    }

    function _creatorShareOfCurve() internal view returns (uint256) {
        uint256 fee = curve.quoteFeeBalance();
        return fee - fee * 3000 / 10_000 + curve.creatorTaxBalance();
    }

    // ---- token still on the curve ---------------------------------------------------------------------------

    function test_fork_ponsUi_transferWhileOnCurve() public {
        _uiLaunch(keccak256("ebb-ui-curve"));
        vm.warp(block.timestamp + 10);
        uint256 o1 = _buy(t1, 0.4 ether);
        _buy(t2, 0.3 ether);

        // (a) fees the creator sweeps BEFORE the transfer are credited to the creator in the escrow and stay theirs
        uint256 preShare = _creatorShareOfCurve();
        vm.prank(creator);
        curve.sweepFees(0);
        uint256 creatorEscrow = escrow.balanceOf(creator);
        assertEq(creatorEscrow, preShare);
        console.log("pre-transfer fees swept to creator's escrow (wei)", creatorEscrow);

        // (b) fees still PENDING on the curve at transfer time
        vm.startPrank(t1);
        IERC20(token).approve(address(curve), o1 / 2);
        curve.sell(o1 / 2, 0, t1);
        vm.stopPrank();
        uint256 pendingAtTransfer = _creatorShareOfCurve();

        _deployVault();
        // before the transfer the vault is not the creator: its curve sweep is refused (swallowed), nothing to book
        (uint256 p0,) = _harvest();
        assertEq(p0, 0);
        assertGt(curve.quoteFeeBalance(), 0, "vault must not be able to sweep before the transfer");

        _transferToVault();
        assertEq(curve.deployer(), address(d.vault), "curve pays the vault now");
        _assertCreatorPowerless();
        vm.prank(creator);
        vm.expectRevert();
        curve.sweepFees(0); // creator is no longer the curve's creator either

        // more trading after the transfer
        _buy(t2, 0.5 ether);
        uint256 shareAll = _creatorShareOfCurve();
        assertGt(shareAll, pendingAtTransfer);
        (uint256 toPool, uint256 usdgOut) = _harvest();
        uint256 fair = d.oracle.v3Quote(WETH, USDG, shareAll);
        console.log("harvest after transfer: creator ETH (wei) incl. fees pending at transfer", shareAll);
        console.log("  of which pending at transfer time (wei)", pendingAtTransfer);
        console.log("  USDG out / V3 TWAP fair (6dp)", usdgOut, fair);
        assertGe(usdgOut, fair * 9700 / 10_000);
        assertGt(toPool, 0);
        assertEq(escrow.balanceOf(creator), creatorEscrow, "creator's credited balance untouched");

        // (c) creator forwards its pre-transfer fees: claim from escrow, send plain ETH to the vault, next harvest books it
        uint256 balBefore = creator.balance;
        vm.prank(creator);
        escrow.claim();
        assertEq(creator.balance - balBefore, creatorEscrow);
        vm.prank(creator);
        (bool ok,) = address(d.vault).call{value: creatorEscrow}("");
        assertTrue(ok);
        (uint256 toPool2, uint256 usdgOut2) = _harvest();
        uint256 fair2 = d.oracle.v3Quote(WETH, USDG, creatorEscrow);
        console.log("forwarded pre-transfer ETH (wei)", creatorEscrow);
        console.log("  booked to pool / total USDG / fair", toPool2, usdgOut2, fair2);
        assertGe(usdgOut2, fair2 * 9700 / 10_000);
        assertEq(toPool2, usdgOut2 - usdgOut2 * 3000 / 10_000);
    }

    // ---- token already graduated ------------------------------------------------------------------------------

    function _hookCreator(bytes32 poolId) internal view returns (address creator_) {
        (bool ok, bytes memory ret) = PONS_HOOK.staticcall(abi.encodeCall(IPonsMemeHook.launches, (poolId)));
        require(ok, "launches");
        assembly ("memory-safe") {
            creator_ := mload(add(ret, add(32, mul(4, 32))))
        }
    }

    function test_fork_ponsUi_transferAfterGraduation() public {
        _uiLaunch(keccak256("ebb-ui-grad"));
        vm.warp(block.timestamp + 10);
        _buy(t1, 0.5 ether);
        _buy(whale, 6 ether); // completes the curve; graduation runs inside the buy
        if (f.getLaunchedToken(token).phase == 1) f.createGraduatedPool(token);
        assertEq(f.getLaunchedToken(token).phase, 2);
        // graduation swept every curve fee to the creator (still the EOA) — those stay the creator's
        uint256 creatorEscrow = escrow.balanceOf(creator);
        console.log("creator escrow at graduation (wei)", creatorEscrow);

        _deployVault(); // asserts the predicted poolId is registered on the hook
        assertEq(_hookCreator(d.poolId), creator);
        _transferToVault();
        assertEq(_hookCreator(d.poolId), address(d.vault), "hook pays the vault now");
        _assertCreatorPowerless();

        // v4 trading, pons operator sweep, vault harvest
        V4Trader trader = new V4Trader(IPoolManager(V4_POOL_MANAGER));
        PoolKey memory key = d.adapter.poolKey();
        vm.deal(t2, 3 ether);
        vm.prank(t2);
        uint256 bought = trader.swap{value: 1 ether}(key, true, 1 ether);
        vm.startPrank(t2);
        IERC20(token).approve(address(trader), bought / 2);
        trader.swap(key, false, bought / 2);
        vm.stopPrank();
        vm.prank(IPonsMemeHook(PONS_HOOK).feeSweepOperator());
        IPonsMemeHook(PONS_HOOK).sweepPoolFees(d.poolId, 1, 0);
        uint256 vaultEscrow = escrow.balanceOf(address(d.vault));
        assertGt(vaultEscrow, 0);
        assertEq(escrow.balanceOf(creator), creatorEscrow, "post-transfer pool fees did not go to the creator");
        uint256 tide = d.vault.currentEpoch();
        (uint256 toPool,) = _harvest();
        assertGt(toPool, 0);
        console.log("post-graduation creator ETH -> vault (wei)", vaultEscrow);
        console.log("  booked (USDG 6dp)", toPool);

        // burn after expiry through the v4 pool
        vm.warp(d.vault.expiresAt(tide) - 3 hours);
        d.twap.poke();
        uint256 end = block.timestamp + 3 hours;
        while (block.timestamp < end) {
            vm.warp(block.timestamp + 150);
            d.twap.poke();
        }
        uint256 supply = IERC20(token).totalSupply();
        vm.prank(keeper);
        d.vault.burnExpired(tide, 5e6);
        uint256 burned = supply - IERC20(token).totalSupply();
        assertGt(burned, 0);
        assertEq(usdg.balanceOf(address(d.vault)), d.vault.totalOpen(), "I1");
        console.log("burn 5 USDG -> EBB burned (1e18)", burned / 1e18);
    }
}
