// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CommonBase} from "forge-std/Base.sol";

import {EbbVault} from "../src/EbbVault.sol";
import {EbbLauncher} from "../src/EbbLauncher.sol";
import {PonsSpotSource} from "../src/oracle/PonsSpotSource.sol";
import {PokeTwapOracle} from "../src/oracle/PokeTwapOracle.sol";
import {PonsOracle, IUniswapV3PoolOracle} from "../src/oracle/PonsOracle.sol";
import {PonsSwapAdapter} from "../src/adapters/PonsSwapAdapter.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {ISpotSource} from "../src/interfaces/ISpotSource.sol";
import {IFeeSource} from "../src/interfaces/IFeeSource.sol";
import {
    IPonsFactory,
    IPonsCurve,
    PonsTokenParams,
    PonsSocials,
    PonsLaunchConfig,
    PonsLaunchedToken
} from "../src/interfaces/IPons.sol";

/// @title EbbMainnetBase
/// @notice Shared by `DeployMainnet.s.sol`, `Launch.s.sol` and the mainnet fork tests: Robinhood Chain (4663)
///         addresses and the deterministic deploy sequence launcher → spot source → poke TWAP → oracle → adapter →
///         vault (six CREATEs from one EOA; the vault address is predicted from the deployer nonce because the
///         launch token's CREATE2 address depends on it as creator fee recipient).
abstract contract EbbMainnetBase is CommonBase {
    // ---- Robinhood Chain mainnet (4663) -------------------------------------------------------------------------
    address internal constant PONS_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address internal constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address internal constant PONS_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address internal constant V4_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    /// @dev Uniswap V3 WETH/USDG fee-100 pool (deepest; observation cardinality 10809 on 2026-10-03)
    address internal constant V3_WETH_USDG = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;

    uint32 internal constant TWAP_WINDOW = 1800;
    uint256 internal constant POKE_MAX_STEP_BPS = 500;
    /// @dev 2026-10-05 15:00:00 UTC (1791212400 % 1800 == 0)
    uint64 internal constant LAUNCH_GENESIS = 1791212400;

    struct MainnetConfig {
        address deployer;
        address operator;
        address guardian;
        address treasury;
        address settlement;
        address pairToken; // address(0) = native ETH, or USDG
        uint16 creatorTaxBps;
        uint256 launchConfigId;
        address devBuyRecipient;
        uint64 genesis;
        PonsTokenParams params; // creatorFeeRecipient / creatorTaxBps / buyback / pin are filled in by _deployAll
    }

    struct Deployed {
        EbbLauncher launcher;
        PonsSpotSource spot;
        PokeTwapOracle twap;
        PonsOracle oracle;
        PonsSwapAdapter adapter;
        EbbVault vault;
        address token; // predicted (no code until launch)
        address curve; // predicted
        bytes32 poolId;
        bytes32 economics;
    }

    /// @dev Must run with `deployer` as the sender of every CREATE (broadcast or prank), no other tx in between.
    function _deployAll(MainnetConfig memory c) internal returns (Deployed memory d) {
        IPonsFactory f = IPonsFactory(PONS_FACTORY);
        require(f.poolManager() == V4_POOL_MANAGER && f.memeHook() == PONS_HOOK, "pons wiring changed");
        require(f.feeEscrow() == PONS_ESCROW, "pons escrow changed");
        require(c.creatorTaxBps <= f.maxCreatorTaxBps(), "creator tax over pons cap");
        require(c.pairToken == address(0) || c.pairToken == USDG, "pair must be ETH or USDG");
        require(c.genesis % 1800 == 0, "genesis not aligned");

        uint256 n = vm.getNonce(c.deployer);
        address vaultAddr = vm.computeCreateAddress(c.deployer, n + 5);

        c.params.creatorFeeRecipient = vaultAddr;
        c.params.creatorTaxBps = c.creatorTaxBps;
        c.params.buybackEnabled = false;
        d.economics = f.previewLaunchEconomics(c.launchConfigId, c.pairToken);
        c.params.expectedEconomics = d.economics;

        d.launcher = new EbbLauncher(f, vaultAddr, c.pairToken, c.creatorTaxBps, c.launchConfigId, c.devBuyRecipient);
        (d.token, d.curve) = d.launcher.predict(c.params);
        require(d.token.code.length == 0 && d.curve.code.length == 0, "launch addresses taken (salt used?)");

        PonsLaunchConfig memory lc = f.getLaunchConfig(c.launchConfigId);
        require(lc.enabled, "launch config disabled");
        _deployStack(c, d, lc.tickSpacing, lc.poolFee);
        require(address(d.vault) == vaultAddr, "vault address != predicted (nonce moved)");
    }

    /// @dev spot source -> poke TWAP -> oracle -> adapter -> vault (5 CREATEs) for `d.token`/`d.curve`.
    function _deployStack(MainnetConfig memory c, Deployed memory d, int24 tickSpacing, uint24 poolFee) internal {
        IPonsFactory f = IPonsFactory(PONS_FACTORY);
        d.spot = new PonsSpotSource(f, d.token, d.curve, c.pairToken, WETH, tickSpacing, poolFee);
        d.poolId = d.spot.poolId();

        address[] memory assets = new address[](1);
        assets[0] = d.token;
        d.twap = new PokeTwapOracle(
            ISpotSource(address(d.spot)), d.spot.quoteBase(), assets, TWAP_WINDOW, POKE_MAX_STEP_BPS
        );

        address v3 = c.pairToken == address(0) ? V3_WETH_USDG : address(0);
        d.oracle = new PonsOracle(IUniswapV3PoolOracle(v3), WETH, USDG, d.twap, d.spot, TWAP_WINDOW);

        d.adapter = new PonsSwapAdapter(
            PonsSwapAdapter.Params({
                factory: f,
                token: d.token,
                curve: d.curve,
                pairToken: c.pairToken,
                usdg: USDG,
                weth: WETH,
                v3Pool: v3,
                tickSpacing: tickSpacing,
                poolFee: poolFee
            })
        );

        d.vault = new EbbVault(
            EbbVault.Config({
                token: d.token,
                usdg: USDG,
                weth: WETH,
                swapAdapter: ISwapAdapter(address(d.adapter)),
                oracle: IPriceOracle(address(d.oracle)),
                feeSource: IFeeSource(PONS_ESCROW),
                treasury: c.treasury,
                settlement: c.settlement,
                operator: c.operator,
                guardian: c.guardian,
                genesis: c.genesis,
                quote: c.pairToken,
                feeCurve: d.curve,
                feeHook: PONS_HOOK,
                feePoolId: d.poolId
            })
        );
        if (v3 != address(0)) d.oracle.v3Quote(WETH, USDG, 1 ether); // reverts if the V3 TWAP is not available
    }

    /// @notice Settings of an EXISTING pons launch that the vault stack is built from (Pons-UI launch path).
    struct ExistingLaunch {
        address token;
        address curve;
        address creatorFeeRecipient;
        address pairToken;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint8 phase;
        int24 tickSpacing;
        uint24 poolFee;
    }

    function _readLaunch(address token) internal view returns (ExistingLaunch memory e) {
        PonsLaunchedToken memory r = IPonsFactory(PONS_FACTORY).getLaunchedToken(token);
        require(r.exists && r.token == token, "not a pons v2 launch of this factory");
        e = ExistingLaunch({
            token: token,
            curve: r.curve,
            creatorFeeRecipient: r.creatorFeeRecipient,
            pairToken: r.pairToken,
            creatorTaxBps: r.creatorTaxBps,
            buybackEnabled: r.buybackEnabled,
            phase: r.phase,
            tickSpacing: r.tickSpacing,
            poolFee: r.poolFee
        });
    }

    /// @dev Deploys the vault stack (5 CREATEs, no launcher) for a token that is already launched on pons v2, on its
    ///      curve or already graduated. `c.pairToken` / `c.creatorTaxBps` are the EXPECTED values and must match.
    function _deployForToken(MainnetConfig memory c, address token)
        internal
        returns (Deployed memory d, ExistingLaunch memory e)
    {
        IPonsFactory f = IPonsFactory(PONS_FACTORY);
        require(f.poolManager() == V4_POOL_MANAGER && f.memeHook() == PONS_HOOK, "pons wiring changed");
        require(f.feeEscrow() == PONS_ESCROW, "pons escrow changed");
        require(c.genesis % 1800 == 0, "genesis not aligned");
        e = _readLaunch(token);
        require(e.pairToken == c.pairToken, "pair token differs from PAIR");
        require(e.creatorTaxBps == c.creatorTaxBps, "creator tax differs from CREATOR_TAX_BPS");
        require(!e.buybackEnabled, "buyback must be off");
        require(e.phase == 0 || e.phase == 2, "launch is Swept/Rescued: no venue");
        require(IPonsCurve(e.curve).token() == token && IPonsCurve(e.curve).pairToken() == e.pairToken, "curve");
        d.token = token;
        d.curve = e.curve;
        _deployStack(c, d, e.tickSpacing, e.poolFee);
        if (e.phase == 2) {
            (bool ok, bytes memory ret) = PONS_HOOK.staticcall(abi.encodeWithSignature("launches(bytes32)", d.poolId));
            require(ok && ret.length >= 32 && abi.decode(ret, (bool)), "predicted poolId not registered on the hook");
        }
    }

    /// @notice The call the current creator fee recipient must send to hand all future creator fees to the vault.
    function _transferCalldata(address token, address vault) internal pure returns (address target, bytes memory data) {
        target = PONS_FACTORY;
        data = abi.encodeCall(IPonsFactory.transferCreatorFeeRecipient, (token, vault));
    }

    /// @dev Token params as pons sees them for this vault (what `launch()` must be called with).
    function _launchParams(MainnetConfig memory c, address vault, bytes32 economics)
        internal
        pure
        returns (PonsTokenParams memory p)
    {
        p = c.params;
        p.creatorFeeRecipient = vault;
        p.creatorTaxBps = c.creatorTaxBps;
        p.buybackEnabled = false;
        p.expectedEconomics = economics;
    }

    /// @dev Metadata from env (NAME, SYMBOL, LOGO, DESCRIPTION, X, TELEGRAM, WEBSITE, SALT).
    function _paramsFromEnv() internal view returns (PonsTokenParams memory p) {
        p.name = vm.envString("NAME");
        p.symbol = vm.envString("SYMBOL");
        p.logo = vm.envOr("LOGO", string(""));
        p.description = vm.envOr("DESCRIPTION", string(""));
        p.socials = PonsSocials({
            twitter: vm.envOr("X", string("")),
            telegram: vm.envOr("TELEGRAM", string("")),
            discord: "",
            website: vm.envOr("WEBSITE", string("")),
            farcaster: ""
        });
        p.salt = vm.envBytes32("SALT");
    }

    /// @dev Arbitrum-style L2 block number (ArbSys 0x64); falls back to block.number off Arbitrum chains.
    function _l2BlockNumber() internal view returns (uint256) {
        (bool ok, bytes memory ret) = address(0x64).staticcall(abi.encodeWithSignature("arbBlockNumber()"));
        if (ok && ret.length == 32) return abi.decode(ret, (uint256));
        return block.number;
    }
}
