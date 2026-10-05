// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {EbbVault} from "../src/EbbVault.sol";
import {EbbToken} from "../src/EbbToken.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {IFeeSource} from "../src/interfaces/IFeeSource.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockSwapAdapter} from "../src/mocks/MockSwapAdapter.sol";
import {MockFeeSource} from "../src/mocks/MockFeeSource.sol";

/// @title DeployTestnet — Robinhood Chain testnet (46630)
/// @notice Deploys EbbToken, MockUSDG, MockOracle, MockSwapAdapter (pre-funded with $EBB), MockFeeSource and an
///         EbbVault whose genesis is the next :00/:30 UTC boundary. Writes `deployments/<chainid>.json` when
///         broadcasting (`deployments/<chainid>.dryrun.json` on a dry run, so a simulation never looks like a deploy).
///
/// Env (all optional; addresses default to the deployer):
///   PRIVATE_KEY      deployer key (else use --account/--private-key/--sender on the CLI)
///   OPERATOR, GUARDIAN, TREASURY, SETTLEMENT
///   WETH             oracle key for ETH (default 0xEeeee…EEeE sentinel; mocks treat it as ETH)
///   ETH_USD_X18      default 2500e18        EBB_USD_X18  default 0.0001e18
///   ADAPTER_EBB      $EBB moved to the mock adapter for burn-path liquidity (default 300M)
///
/// Dry run:  forge script script/DeployTestnet.s.sol --rpc-url robinhood_testnet
contract DeployTestnet is Script {
    address internal constant ETH_SENTINEL = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    struct Deployed {
        EbbToken token;
        MockUSDG usdg;
        MockOracle oracle;
        MockSwapAdapter adapter;
        MockFeeSource feeSource;
        EbbVault vault;
        uint64 genesis;
        uint256 deployBlock;
    }

    function run() external returns (Deployed memory d) {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = pk != 0 ? vm.addr(pk) : msg.sender;

        address operator = vm.envOr("OPERATOR", deployer);
        address guardian = vm.envOr("GUARDIAN", deployer);
        address treasury = vm.envOr("TREASURY", deployer);
        address settlement = vm.envOr("SETTLEMENT", deployer);
        address weth = vm.envOr("WETH", ETH_SENTINEL);
        uint256 ethUsd = vm.envOr("ETH_USD_X18", uint256(2500e18));
        uint256 ebbUsd = vm.envOr("EBB_USD_X18", uint256(0.0001e18));
        uint256 adapterEbb = vm.envOr("ADAPTER_EBB", uint256(300_000_000e18));

        // next :00 / :30 UTC boundary (unix time multiples of 1800 are exactly :00/:30 UTC)
        d.genesis = uint64((block.timestamp / 1800 + 1) * 1800);
        d.deployBlock = _l2BlockNumber();

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();

        d.token = new EbbToken(deployer);
        d.usdg = new MockUSDG();
        d.oracle = new MockOracle(weth);
        d.oracle.setPrice(weth, ethUsd, 18);
        d.oracle.setPrice(address(d.usdg), 1e18, 6);
        d.oracle.setPrice(address(d.token), ebbUsd, 18);
        d.adapter = new MockSwapAdapter(d.oracle);
        d.feeSource = new MockFeeSource(d.usdg);
        d.vault = new EbbVault(
            EbbVault.Config({
                token: address(d.token),
                usdg: address(d.usdg),
                weth: weth,
                swapAdapter: ISwapAdapter(address(d.adapter)),
                oracle: IPriceOracle(address(d.oracle)),
                feeSource: IFeeSource(address(d.feeSource)),
                treasury: treasury,
                settlement: settlement,
                operator: operator,
                guardian: guardian,
                genesis: d.genesis,
                quote: address(0),
                feeCurve: address(0),
                feeHook: address(0),
                feePoolId: bytes32(0)
            })
        );
        // burn-path liquidity: the mock adapter pays $EBB out of inventory (USDG it can mint itself)
        d.token.transfer(address(d.adapter), adapterEbb);

        vm.stopBroadcast();

        _write(d, deployer, operator, guardian, treasury, settlement, weth);
    }

    function _write(
        Deployed memory d,
        address deployer,
        address operator,
        address guardian,
        address treasury,
        address settlement,
        address weth
    ) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", d.deployBlock);
        vm.serializeUint(k, "genesis", d.genesis);
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeAddress(k, "token", address(d.token));
        vm.serializeAddress(k, "usdg", address(d.usdg));
        vm.serializeAddress(k, "weth", weth);
        vm.serializeAddress(k, "oracle", address(d.oracle));
        vm.serializeAddress(k, "swapAdapter", address(d.adapter));
        vm.serializeAddress(k, "feeSource", address(d.feeSource));
        vm.serializeAddress(k, "treasury", treasury);
        vm.serializeAddress(k, "settlement", settlement);
        vm.serializeAddress(k, "operator", operator);
        vm.serializeAddress(k, "guardian", guardian);
        string memory json = vm.serializeAddress(k, "vault", address(d.vault));

        if (vm.isContext(VmSafe.ForgeContext.TestGroup)) return; // unit tests: no files
        bool broadcast = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        string memory path = string.concat(
            vm.projectRoot(), "/deployments/", vm.toString(block.chainid), broadcast ? ".json" : ".dryrun.json"
        );
        vm.writeJson(json, path);
        console.log("vault   ", address(d.vault));
        console.log("token   ", address(d.token));
        console.log("usdg    ", address(d.usdg));
        console.log("genesis ", d.genesis);
        console.log("written ", path);
    }

    /// @dev On Arbitrum-based chains (Robinhood Chain) `block.number` is the L1 block; indexers need the L2 one.
    function _l2BlockNumber() internal view returns (uint256) {
        (bool ok, bytes memory ret) = address(0x64).staticcall(abi.encodeWithSignature("arbBlockNumber()"));
        if (ok && ret.length == 32) return abi.decode(ret, (uint256));
        return block.number;
    }
}
