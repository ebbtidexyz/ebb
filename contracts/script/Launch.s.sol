// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {EbbMainnetBase} from "./EbbMainnetBase.sol";
import {EbbLauncher} from "../src/EbbLauncher.sol";
import {EbbVault} from "../src/EbbVault.sol";
import {IPonsFactory, PonsTokenParams, PonsLaunchedToken} from "../src/interfaces/IPons.sol";

/// @title Launch — step 2 of 2: `EbbLauncher.launch` at go time (2026-10-05 15:00 UTC)
/// @notice Reads the step-1 deployment json, rebuilds the exact token params, checks on-chain BEFORE sending that
///         pons would still deploy the token/curve the vault was built for (same metadata, salt, economics pin, fee
///         policy), then calls `launch` with the launch fee + dev buy as value. The dev buy is clamped by the
///         launcher at 2% of supply; whatever is not spent is refunded in the same transaction.
///
/// Env:
///   PRIVATE_KEY      the SAME deployer EOA as step 1 (the launcher only accepts it)
///   NAME SYMBOL LOGO DESCRIPTION X TELEGRAM WEBSITE SALT   byte-identical to step 1
///   DEV_BUY_WEI      ETH pairing: dev buy in wei (default 0)       DEV_BUY_USDG  USDG pairing: 6-dp amount
///   DEPLOYMENT       json from step 1 (default deployments/4663.json)
///
/// Dry run:  forge script script/Launch.s.sol --rpc-url robinhood --sender <deployer>
contract Launch is Script, EbbMainnetBase {
    struct Plan {
        EbbLauncher launcher;
        EbbVault vault;
        address sender;
        uint256 pk;
        address pair;
        uint256 devBuy;
        uint256 value;
    }

    function run() external returns (address token, address curve, uint256 devTokens) {
        (Plan memory pl, PonsTokenParams memory p) = _plan();
        if (pl.pk != 0) vm.startBroadcast(pl.pk);
        else vm.startBroadcast(pl.sender);
        if (pl.pair != address(0) && pl.devBuy != 0) IERC20(pl.pair).approve(address(pl.launcher), pl.devBuy);
        (token, curve, devTokens) = pl.launcher.launch{value: pl.value}(p, pl.devBuy);
        vm.stopBroadcast();
        _report(pl, token, curve, devTokens);
    }

    function _plan() internal view returns (Plan memory pl, PonsTokenParams memory p) {
        string memory path =
            string.concat(vm.projectRoot(), "/", vm.envOr("DEPLOYMENT", string("deployments/4663.json")));
        string memory json = vm.readFile(path);
        pl.launcher = EbbLauncher(payable(vm.parseJsonAddress(json, ".launcher")));
        pl.vault = EbbVault(payable(vm.parseJsonAddress(json, ".vault")));
        bytes32 pin = vm.parseJsonBytes32(json, ".economics");

        pl.pk = vm.envOr("PRIVATE_KEY", uint256(0));
        pl.sender = pl.pk != 0 ? vm.addr(pl.pk) : msg.sender;
        require(pl.sender == pl.launcher.deployer(), "sender is not the launcher's deployer");
        require(!pl.launcher.launched(), "already launched");

        IPonsFactory f = IPonsFactory(PONS_FACTORY);
        pl.pair = pl.launcher.pairToken();
        require(
            f.previewLaunchEconomics(pl.launcher.launchConfigId(), pl.pair) == pin,
            "pons economics changed since step 1"
        );
        require(f.canLaunch(address(pl.launcher)), "pons launch gate closed for the launcher");

        p = _paramsFromEnv();
        p.creatorFeeRecipient = address(pl.vault);
        p.creatorTaxBps = pl.launcher.creatorTaxBps();
        p.buybackEnabled = false;
        p.expectedEconomics = pin;
        (address pt, address pc) = pl.launcher.predict(p);
        require(pt == pl.vault.token() && pc == pl.vault.feeCurve(), "params do not reproduce the vault's token/curve");
        require(pt.code.length == 0, "token address already used");

        uint256 fee = f.launchFee();
        pl.devBuy = pl.pair == address(0) ? vm.envOr("DEV_BUY_WEI", uint256(0)) : vm.envOr("DEV_BUY_USDG", uint256(0));
        pl.value = pl.pair == address(0) ? fee + pl.devBuy : fee;
        console.log("launch fee (wei)     ", fee);
        console.log("dev buy requested    ", pl.devBuy);
        console.log("msg.value (wei)      ", pl.value);
        console.log("block.timestamp      ", block.timestamp);
        console.log("vault genesis        ", pl.vault.genesis());
    }

    function _report(Plan memory pl, address token, address curve, uint256 devTokens) internal view {
        PonsLaunchedToken memory rec = IPonsFactory(PONS_FACTORY).getLaunchedToken(token);
        require(rec.creatorFeeRecipient == address(pl.vault) && rec.deployer == address(pl.launcher), "launch record");
        console.log("token                ", token);
        console.log("curve                ", curve);
        console.log("dev buy tokens       ", devTokens);
        console.log("dev buy % x100       ", devTokens * 10_000 / IERC20(token).totalSupply());
        console.log("launch L2 block      ", _l2BlockNumber());
    }
}
