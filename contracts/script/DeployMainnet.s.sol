// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {EbbMainnetBase} from "./EbbMainnetBase.sol";
import {PonsTokenParams} from "../src/interfaces/IPons.sol";

/// @title DeployMainnet — step 1 of 2 for the pons v2 launch on Robinhood Chain (4663)
/// @notice Deploys, from ONE fresh-ish EOA with no other transaction in between (six CREATEs, the vault address is
///         predicted from the nonce): EbbLauncher → PonsSpotSource → PokeTwapOracle → PonsOracle → PonsSwapAdapter
///         → EbbVault. The launch token and curve do not exist yet; their CREATE2 addresses are predicted by pons'
///         launch deployer (initiator = the launcher, creator fee recipient = the vault) and baked into the vault,
///         adapter and oracle. Step 2 is `Launch.s.sol` at go time.
///
/// Env:
///   PRIVATE_KEY            deployer key (or --account/--sender on the CLI); the same EOA must run Launch.s.sol
///   OPERATOR GUARDIAN TREASURY SETTLEMENT   required, distinct where it matters
///   PAIR                   eth | usdg                     (default eth)
///   CREATOR_TAX_BPS        default 200
///   DEV_BUY_RECIPIENT      wallet that receives the dev buy (snipe-tax exempt)
///   NAME SYMBOL LOGO DESCRIPTION X TELEGRAM WEBSITE SALT   token metadata + CREATE2 salt — FROZEN from here on:
///                          Launch.s.sol must be run with byte-identical values or the token address changes
///   GENESIS                default 1791212400 (2026-10-05 15:00 UTC)
///   LAUNCH_CONFIG_ID       default 0
///   DEPLOY_OUT             output json (default deployments/4663.json on broadcast, 4663.dryrun.json otherwise)
///
/// Dry run:  forge script script/DeployMainnet.s.sol --rpc-url robinhood --sender <deployer>
contract DeployMainnet is Script, EbbMainnetBase {
    function run() external returns (Deployed memory d) {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        MainnetConfig memory c = configFromEnv(pk != 0 ? vm.addr(pk) : msg.sender);
        uint256 deployBlock = _l2BlockNumber();

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast(c.deployer);
        d = _deployAll(c);
        vm.stopBroadcast();

        _print(c, d);
        _write(c, d, deployBlock);
    }

    function configFromEnv(address deployer) public view returns (MainnetConfig memory c) {
        c.deployer = deployer;
        c.operator = vm.envAddress("OPERATOR");
        c.guardian = vm.envAddress("GUARDIAN");
        c.treasury = vm.envAddress("TREASURY");
        c.settlement = vm.envAddress("SETTLEMENT");
        c.devBuyRecipient = vm.envAddress("DEV_BUY_RECIPIENT");
        string memory pair = vm.envOr("PAIR", string("eth"));
        if (keccak256(bytes(pair)) == keccak256("eth")) c.pairToken = address(0);
        else if (keccak256(bytes(pair)) == keccak256("usdg")) c.pairToken = USDG;
        else revert("PAIR must be eth or usdg");
        c.creatorTaxBps = uint16(vm.envOr("CREATOR_TAX_BPS", uint256(200)));
        c.launchConfigId = vm.envOr("LAUNCH_CONFIG_ID", uint256(0));
        c.genesis = uint64(vm.envOr("GENESIS", uint256(LAUNCH_GENESIS)));
        c.params = _paramsFromEnv();

        require(c.operator != c.guardian, "operator == guardian");
        require(c.settlement != c.treasury, "settlement == treasury");
        require(c.operator != deployer && c.guardian != deployer, "deployer must not be operator/guardian");
        require(c.genesis % 1800 == 0, "GENESIS not aligned to :00/:30");
    }

    function _print(MainnetConfig memory c, Deployed memory d) internal pure {
        console.log("pair (0 = ETH)    ", c.pairToken);
        console.log("creatorTaxBps     ", c.creatorTaxBps);
        console.log("genesis           ", c.genesis);
        console.log("launcher          ", address(d.launcher));
        console.log("spotSource        ", address(d.spot));
        console.log("pokeTwap          ", address(d.twap));
        console.log("oracle            ", address(d.oracle));
        console.log("swapAdapter       ", address(d.adapter));
        console.log("vault             ", address(d.vault));
        console.log("token (predicted) ", d.token);
        console.log("curve (predicted) ", d.curve);
        console.log("v4 poolId");
        console.logBytes32(d.poolId);
        console.log("economics pin");
        console.logBytes32(d.economics);
    }

    function _write(MainnetConfig memory c, Deployed memory d, uint256 deployBlock) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", deployBlock);
        vm.serializeUint(k, "genesis", c.genesis);
        vm.serializeString(k, "pair", c.pairToken == address(0) ? "eth" : "usdg");
        vm.serializeUint(k, "creatorTaxBps", c.creatorTaxBps);
        vm.serializeUint(k, "launchConfigId", c.launchConfigId);
        vm.serializeAddress(k, "deployer", c.deployer);
        vm.serializeAddress(k, "launcher", address(d.launcher));
        vm.serializeAddress(k, "spotSource", address(d.spot));
        vm.serializeAddress(k, "pokeTwap", address(d.twap));
        vm.serializeAddress(k, "oracle", address(d.oracle));
        vm.serializeAddress(k, "swapAdapter", address(d.adapter));
        vm.serializeAddress(k, "token", d.token);
        vm.serializeAddress(k, "curve", d.curve);
        vm.serializeBytes32(k, "poolId", d.poolId);
        vm.serializeBytes32(k, "economics", d.economics);
        vm.serializeBytes32(k, "salt", c.params.salt);
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
        vm.serializeAddress(k, "devBuyRecipient", c.devBuyRecipient);
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
