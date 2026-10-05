// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {EbbVault} from "../src/EbbVault.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {IFeeSource} from "../src/interfaces/IFeeSource.sol";

/// @title Deploy — Robinhood Chain mainnet (4663)
/// @notice Deploys only EbbVault. Every dependency comes from env; no mocks. Writes `deployments/<chainid>.json` on
///         broadcast (`.dryrun.json` otherwise).
///
/// Env (required): TOKEN, USDG, WETH, SWAP_ADAPTER, ORACLE, TREASURY, SETTLEMENT, OPERATOR, GUARDIAN
/// Env (optional): FEE_SOURCE (default 0 = none), GENESIS (default: next :00/:30 UTC), PRIVATE_KEY,
///                 ALLOW_ANY_CHAIN=true to run against something other than chain 4663 (e.g. a local fork).
///
/// Dry run:  forge script script/Deploy.s.sol --rpc-url robinhood
contract Deploy is Script {
    error WrongChain(uint256 chainId);
    error NoCode(string name, address at);
    error SameKey(string what);
    error BadGenesis(uint64 genesis);

    function run() external returns (EbbVault vault) {
        if (block.chainid != 4663 && !vm.envOr("ALLOW_ANY_CHAIN", false)) revert WrongChain(block.chainid);

        EbbVault.Config memory c = EbbVault.Config({
            token: vm.envAddress("TOKEN"),
            usdg: vm.envAddress("USDG"),
            weth: vm.envAddress("WETH"),
            swapAdapter: ISwapAdapter(vm.envAddress("SWAP_ADAPTER")),
            oracle: IPriceOracle(vm.envAddress("ORACLE")),
            feeSource: IFeeSource(vm.envOr("FEE_SOURCE", address(0))),
            treasury: vm.envAddress("TREASURY"),
            settlement: vm.envAddress("SETTLEMENT"),
            operator: vm.envAddress("OPERATOR"),
            guardian: vm.envAddress("GUARDIAN"),
            genesis: uint64(vm.envOr("GENESIS", (block.timestamp / 1800 + 1) * 1800)),
            quote: address(0),
            feeCurve: address(0),
            feeHook: address(0),
            feePoolId: bytes32(0)
        });

        // Everything is immutable: refuse obviously wrong configs before spending gas.
        _hasCode("TOKEN", c.token);
        _hasCode("USDG", c.usdg);
        _hasCode("SWAP_ADAPTER", address(c.swapAdapter));
        _hasCode("ORACLE", address(c.oracle));
        if (address(c.feeSource) != address(0)) _hasCode("FEE_SOURCE", address(c.feeSource));
        if (c.operator == c.guardian) revert SameKey("operator == guardian");
        if (c.settlement == c.treasury) revert SameKey("settlement == treasury");
        if (c.genesis % 1800 != 0 || c.genesis > block.timestamp + 1 days) revert BadGenesis(c.genesis);
        // the oracle must answer for both swap routes right now
        c.oracle.quote(c.weth, c.usdg, 1e18);
        c.oracle.quote(c.weth, c.token, c.oracle.quote(c.usdg, c.weth, 1e6));

        uint256 deployBlock = _l2BlockNumber();
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        vault = new EbbVault(c);
        vm.stopBroadcast();

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", deployBlock);
        vm.serializeUint(k, "genesis", c.genesis);
        vm.serializeAddress(k, "token", c.token);
        vm.serializeAddress(k, "usdg", c.usdg);
        vm.serializeAddress(k, "weth", c.weth);
        vm.serializeAddress(k, "oracle", address(c.oracle));
        vm.serializeAddress(k, "swapAdapter", address(c.swapAdapter));
        vm.serializeAddress(k, "feeSource", address(c.feeSource));
        vm.serializeAddress(k, "treasury", c.treasury);
        vm.serializeAddress(k, "settlement", c.settlement);
        vm.serializeAddress(k, "operator", c.operator);
        vm.serializeAddress(k, "guardian", c.guardian);
        string memory json = vm.serializeAddress(k, "vault", address(vault));
        if (vm.isContext(VmSafe.ForgeContext.TestGroup)) return vault; // unit tests: no files
        bool broadcast = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        string memory path = string.concat(
            vm.projectRoot(), "/deployments/", vm.toString(block.chainid), broadcast ? ".json" : ".dryrun.json"
        );
        vm.writeJson(json, path);
        console.log("vault  ", address(vault));
        console.log("genesis", c.genesis);
        console.log("written", path);
    }

    function _hasCode(string memory name, address a) internal view {
        if (a.code.length == 0) revert NoCode(name, a);
    }

    /// @dev On Arbitrum-based chains (Robinhood Chain) `block.number` is the L1 block; indexers need the L2 one.
    function _l2BlockNumber() internal view returns (uint256) {
        (bool ok, bytes memory ret) = address(0x64).staticcall(abi.encodeWithSignature("arbBlockNumber()"));
        if (ok && ret.length == 32) return abi.decode(ret, (uint256));
        return block.number;
    }
}
