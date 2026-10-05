// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

import {EbbVault} from "../../src/EbbVault.sol";
import {EbbToken} from "../../src/EbbToken.sol";
import {ISwapAdapter} from "../../src/interfaces/ISwapAdapter.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";
import {IFeeSource} from "../../src/interfaces/IFeeSource.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {MockOracle} from "../../src/mocks/MockOracle.sol";
import {MockSwapAdapter} from "../../src/mocks/MockSwapAdapter.sol";
import {MockFeeSource} from "../../src/mocks/MockFeeSource.sol";

/// @dev Shared fixture: mocks + token + vault, genesis at a :00 boundary, prices ETH $2500, USDG $1, EBB $0.01.
abstract contract Base is Test {
    uint64 internal constant GENESIS = 1_800_000_000; // 2027-01-15T08:00:00Z, multiple of 1800
    uint256 internal constant EPOCH = 1800;
    uint256 internal constant EXPIRY = 336 * 1800;

    uint256 internal constant ETH_USD = 2500e18;
    uint256 internal constant EBB_USD = 0.01e18;

    address internal weth = makeAddr("WETH");
    address internal treasury = makeAddr("treasury");
    address internal settlement = makeAddr("settlement");
    address internal operator = makeAddr("operator");
    address internal guardian = makeAddr("guardian");
    address internal keeper = makeAddr("keeper");
    address internal alice = makeAddr("alice");
    address internal deployer = makeAddr("deployer");

    MockUSDG internal usdg;
    EbbToken internal ebb;
    MockOracle internal oracle;
    MockSwapAdapter internal adapter;
    MockFeeSource internal feeSource;
    EbbVault internal vault;

    function setUp() public virtual {
        vm.warp(GENESIS);
        usdg = new MockUSDG();
        ebb = new EbbToken(deployer);
        oracle = new MockOracle(weth);
        oracle.setPrice(weth, ETH_USD, 18);
        oracle.setPrice(address(usdg), 1e18, 6);
        oracle.setPrice(address(ebb), EBB_USD, 18);
        adapter = new MockSwapAdapter(oracle);
        feeSource = new MockFeeSource(usdg);
        vault = new EbbVault(_config());

        // adapter inventory for the burn path
        vm.prank(deployer);
        ebb.transfer(address(adapter), 900_000_000e18);
        vm.deal(address(adapter), 10_000 ether);
    }

    function _config() internal view returns (EbbVault.Config memory c) {
        c = EbbVault.Config({
            token: address(ebb),
            usdg: address(usdg),
            weth: weth,
            swapAdapter: ISwapAdapter(address(adapter)),
            oracle: IPriceOracle(address(oracle)),
            feeSource: IFeeSource(address(feeSource)),
            treasury: treasury,
            settlement: settlement,
            operator: operator,
            guardian: guardian,
            genesis: GENESIS,
            quote: address(0),
            feeCurve: address(0),
            feeHook: address(0),
            feePoolId: bytes32(0)
        });
    }

    // ---- helpers ------------------------------------------------------------------------------------------------

    /// @dev Books exactly `toPool` USDG to the current tide (by donating 10/7 of it and harvesting).
    function _bookUsdg(uint256 usdgOut) internal returns (uint256 toPool) {
        usdg.mint(address(vault), usdgOut);
        vault.harvest();
        toPool = usdgOut - usdgOut * 3000 / 10_000;
    }

    function _harvestEth(uint256 ethAmount) internal {
        vm.deal(address(vault), address(vault).balance + ethAmount);
        vault.harvest();
    }

    function _warpToEpoch(uint256 e) internal {
        vm.warp(vault.epochStart(e));
    }

    function _commit(uint256 e, uint128 total) internal {
        vm.prank(operator);
        vault.commitGrants(e, keccak256(abi.encode("root", e)), total, 1);
    }

    function _leaf(uint256 e, address w, uint256 amt) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(e, w, amt))));
    }

    /// @dev Builds a commutative-keccak Merkle tree (OZ MerkleProof compatible) and returns root + proof for `index`.
    ///      Odd nodes are promoted unchanged.
    function _rootAndProof(bytes32[] memory leaves, uint256 index)
        internal
        pure
        returns (bytes32 root, bytes32[] memory proof)
    {
        bytes32[] memory tmp = new bytes32[](64);
        uint256 plen;
        bytes32[] memory level = leaves;
        uint256 idx = index;
        while (level.length > 1) {
            uint256 n = (level.length + 1) / 2;
            bytes32[] memory next = new bytes32[](n);
            for (uint256 i; i < n; ++i) {
                uint256 l = 2 * i;
                if (l + 1 < level.length) next[i] = Hashes.commutativeKeccak256(level[l], level[l + 1]);
                else next[i] = level[l];
            }
            uint256 sib = idx ^ 1;
            if (sib < level.length) tmp[plen++] = level[sib];
            idx /= 2;
            level = next;
        }
        root = level[0];
        proof = new bytes32[](plen);
        for (uint256 i; i < plen; ++i) {
            proof[i] = tmp[i];
        }
    }
}
