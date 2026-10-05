// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {EbbMainnetBase} from "./EbbMainnetBase.sol";
import {IPonsFactory, IPonsCurve, IPonsFeeEscrow} from "../src/interfaces/IPons.sol";

/// @title DeployForToken — vault stack for a token ALREADY launched on pons v2 (Pons-UI launch path)
/// @notice The creator launched $EBB through the Pons UI with creatorFeeRecipient = their own wallet. This script reads
///         the launch from the pons factory (curve, pair, creator tax, buyback flag, pool fee, tick spacing, phase),
///         asserts ETH pair / expected tax / buyback off, and deploys PonsSpotSource → PokeTwapOracle → PonsOracle →
///         PonsSwapAdapter → EbbVault (works on the curve or after graduation). It prints the exact call the creator
///         must then send from their wallet:  factory.transferCreatorFeeRecipient(token, vault).
///
/// Env:
///   PRIVATE_KEY                              deployer (any EOA; it gets no role)
///   TOKEN                                    the launched $EBB
///   OPERATOR GUARDIAN TREASURY SETTLEMENT    required
///   PAIR             eth | usdg (default eth)      CREATOR_TAX_BPS  default 200 (asserted against the launch)
///   GENESIS          default: next :00/:30 UTC boundary after the current block
///   DEPLOY_OUT       default deployments/4663.json on broadcast, deployments/4663.dryrun.json otherwise
///
/// Dry run:  forge script script/DeployForToken.s.sol --rpc-url robinhood --sender <deployer>
contract DeployForToken is Script, EbbMainnetBase {
    function run() external returns (Deployed memory d) {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = pk != 0 ? vm.addr(pk) : msg.sender;
        address token = vm.envAddress("TOKEN");
        MainnetConfig memory c = configFromEnv(deployer);
        uint256 deployBlock = _l2BlockNumber();

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast(deployer);
        ExistingLaunch memory e;
        (d, e) = _deployForToken(c, token);
        vm.stopBroadcast();

        _print(c, d, e);
        _write(c, d, e, deployBlock);
    }

    function configFromEnv(address deployer) public view returns (MainnetConfig memory c) {
        c.deployer = deployer;
        c.operator = vm.envAddress("OPERATOR");
        c.guardian = vm.envAddress("GUARDIAN");
        c.treasury = vm.envAddress("TREASURY");
        c.settlement = vm.envAddress("SETTLEMENT");
        string memory pair = vm.envOr("PAIR", string("eth"));
        if (keccak256(bytes(pair)) == keccak256("eth")) c.pairToken = address(0);
        else if (keccak256(bytes(pair)) == keccak256("usdg")) c.pairToken = USDG;
        else revert("PAIR must be eth or usdg");
        c.creatorTaxBps = uint16(vm.envOr("CREATOR_TAX_BPS", uint256(200)));
        c.genesis = uint64(vm.envOr("GENESIS", (block.timestamp / 1800 + 1) * 1800));
        require(c.operator != c.guardian, "operator == guardian");
        require(c.settlement != c.treasury, "settlement == treasury");
        require(c.genesis % 1800 == 0, "GENESIS not aligned to :00/:30");
    }

    function _print(MainnetConfig memory c, Deployed memory d, ExistingLaunch memory e) internal view {
        console.log("token             ", d.token);
        console.log("curve             ", d.curve);
        console.log("phase (0 curve, 2 v4 pool)", e.phase);
        console.log("current fee recipient", e.creatorFeeRecipient);
        console.log("genesis           ", c.genesis);
        console.log("spotSource        ", address(d.spot));
        console.log("pokeTwap          ", address(d.twap));
        console.log("oracle            ", address(d.oracle));
        console.log("swapAdapter       ", address(d.adapter));
        console.log("vault             ", address(d.vault));
        console.log("v4 poolId");
        console.logBytes32(d.poolId);
        (address target, bytes memory data) = _transferCalldata(d.token, address(d.vault));
        console.log("");
        console.log("=== the creator fee recipient (", e.creatorFeeRecipient, ") must now send ===");
        console.log("to   ", target);
        console.log("value 0");
        console.log("data");
        console.logBytes(data);
        console.log("(= transferCreatorFeeRecipient(token, vault) on the pons factory)");
        console.log("Fees still PENDING on the curve/hook at that moment go to the vault on its next harvest;");
        console.log(
            "fees already credited to the creator in the escrow stay theirs (claim, then send ETH to the vault)."
        );
        uint256 pendingCurve =
            e.phase == 0 ? IPonsCurve(d.curve).quoteFeeBalance() + IPonsCurve(d.curve).creatorTaxBalance() : 0;
        console.log("curve pending fee+tax now (gross, wei)", pendingCurve);
        console.log(
            "creator's escrow ETH balance now (wei)", IPonsFeeEscrow(PONS_ESCROW).balanceOf(e.creatorFeeRecipient)
        );
    }

    function _write(MainnetConfig memory c, Deployed memory d, ExistingLaunch memory e, uint256 deployBlock) internal {
        (address target, bytes memory data) = _transferCalldata(d.token, address(d.vault));
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", deployBlock);
        vm.serializeUint(k, "genesis", c.genesis);
        vm.serializeString(k, "pair", c.pairToken == address(0) ? "eth" : "usdg");
        vm.serializeUint(k, "creatorTaxBps", c.creatorTaxBps);
        vm.serializeString(k, "launchPath", "pons-ui");
        vm.serializeAddress(k, "deployer", c.deployer);
        vm.serializeAddress(k, "creatorAtDeploy", e.creatorFeeRecipient);
        vm.serializeAddress(k, "spotSource", address(d.spot));
        vm.serializeAddress(k, "pokeTwap", address(d.twap));
        vm.serializeAddress(k, "oracle", address(d.oracle));
        vm.serializeAddress(k, "swapAdapter", address(d.adapter));
        vm.serializeAddress(k, "token", d.token);
        vm.serializeAddress(k, "curve", d.curve);
        vm.serializeBytes32(k, "poolId", d.poolId);
        vm.serializeAddress(k, "transferTarget", target);
        vm.serializeBytes(k, "transferCalldata", data);
        vm.serializeAddress(k, "usdg", USDG);
        vm.serializeAddress(k, "weth", WETH);
        vm.serializeAddress(k, "feeSource", PONS_ESCROW);
        vm.serializeAddress(k, "ponsFactory", PONS_FACTORY);
        vm.serializeAddress(k, "ponsHook", PONS_HOOK);
        vm.serializeAddress(k, "poolManager", V4_POOL_MANAGER);
        vm.serializeAddress(k, "v3EthUsdgPool", V3_WETH_USDG);
        vm.serializeAddress(k, "treasury", c.treasury);
        vm.serializeAddress(k, "settlement", c.settlement);
        vm.serializeAddress(k, "operator", c.operator);
        vm.serializeAddress(k, "guardian", c.guardian);
        string memory json = vm.serializeAddress(k, "vault", address(d.vault));

        if (vm.isContext(VmSafe.ForgeContext.TestGroup)) return;
        bool broadcast = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        string memory def =
            string.concat("deployments/", vm.toString(block.chainid), broadcast ? ".json" : ".dryrun.json");
        string memory path = string.concat(vm.projectRoot(), "/", vm.envOr("DEPLOY_OUT", def));
        vm.writeJson(json, path);
        console.log("written           ", path);
    }
}
