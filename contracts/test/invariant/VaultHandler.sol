// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {EbbVault} from "../../src/EbbVault.sol";
import {EbbToken} from "../../src/EbbToken.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {MockSwapAdapter} from "../../src/mocks/MockSwapAdapter.sol";
import {MockOracle} from "../../src/mocks/MockOracle.sol";

/// @dev Drives EbbVault through harvest / commit / withdraw / burn / warp (+ negative probes) and keeps ghost
///      accounting that the invariant suite compares against on-chain state.
contract VaultHandler is Test {
    EbbVault public immutable vault;
    MockUSDG public immutable usdg;
    EbbToken public immutable ebb;
    MockSwapAdapter public immutable adapter;
    MockOracle public immutable oracle;
    address public immutable operator;
    address public immutable guardian;

    bytes32 internal constant HARVESTED = keccak256("Harvested(uint256,uint256,uint256,uint256,uint256)");
    bytes32 internal constant BURNED = keccak256("Burned(uint256,uint256,uint256,address,uint256)");

    // epochs that ever received a booking
    uint256[] public touched;
    mapping(uint256 => bool) public isTouched;

    address[] public callers;

    // ghosts
    uint256 public ghostDonatedPending; // USDG sent directly to the vault and not yet harvested
    uint256 public ghostDonatedTotal;
    uint256 public ghostToTreasury;
    uint256 public ghostToSettlement;
    uint256 public ghostTips;
    uint256 public ghostBurnSwapIn;
    uint256 public ghostEbbBurned;

    // violation flags (must stay false)
    bool public splitViolated; // I5
    bool public burnBeforeExpirySucceeded; // I3
    bool public withdrawAfterBurnSucceeded; // I4
    bool public badSlippageSwapSucceeded; // I6
    bool public supplyMismatch; // I7
    bool public commitTwiceSucceeded;
    bool public commitUnendedSucceeded;
    bool public withdrawOverGrantSucceeded;

    mapping(bytes32 => uint256) public calls;
    // effective (state-changing) actions, to check the campaign reaches deep states
    uint256 public nHarvests;
    uint256 public nCommits;
    uint256 public nWithdraws;
    uint256 public nBurns;

    constructor(
        EbbVault vault_,
        MockUSDG usdg_,
        EbbToken ebb_,
        MockSwapAdapter adapter_,
        MockOracle oracle_,
        address operator_,
        address guardian_
    ) {
        vault = vault_;
        usdg = usdg_;
        ebb = ebb_;
        adapter = adapter_;
        oracle = oracle_;
        operator = operator_;
        guardian = guardian_;
        for (uint256 i; i < 3; ++i) {
            callers.push(makeAddr(string(abi.encodePacked("caller", vm.toString(i)))));
        }
    }

    function touchedLength() external view returns (uint256) {
        return touched.length;
    }

    function callersLength() external view returns (uint256) {
        return callers.length;
    }

    // ------------------------------------------------------------------------------------------------------------
    // actions
    // ------------------------------------------------------------------------------------------------------------

    function harvest(uint256 ethIn, uint256 donation, uint256 slip) external {
        calls["harvest"]++;
        ethIn = bound(ethIn, 0, 5 ether);
        donation = bound(donation, 0, 2_000e6);
        if (donation % 3 == 0) donation = 0;
        slip = bound(slip, 0, 300);
        adapter.setSlippageBps(slip);

        if (ethIn != 0) vm.deal(address(vault), address(vault).balance + ethIn);
        if (donation != 0) {
            usdg.mint(address(vault), donation);
            ghostDonatedPending += donation;
            ghostDonatedTotal += donation;
        }

        uint256 e = vault.currentEpoch();
        vm.recordLogs();
        vault.harvest();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(vault) || logs[i].topics[0] != HARVESTED) continue;
            (, uint256 usdgOut, uint256 toPool, uint256 toTreasury) =
                abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
            ghostToTreasury += toTreasury;
            nHarvests++;
            ghostDonatedPending = 0;
            if (toPool + toTreasury != usdgOut) splitViolated = true;
            // I5: toPool*3000 == toTreasury*7000, rounding (< 1 wei of treasury share) only in the pool's favour
            if (toPool * 3000 < toTreasury * 7000 || toPool * 3000 - toTreasury * 7000 >= 10_000) {
                splitViolated = true;
            }
            if (!isTouched[e]) {
                isTouched[e] = true;
                touched.push(e);
            }
        }
        adapter.setSlippageBps(0);
    }

    function commit(uint256 seed, uint256 fracBps) external {
        calls["commit"]++;
        if (vault.operatorFrozen()) return;
        (bool found, uint256 e) = _pick(seed, _committable);
        if (!found) return;
        (uint128 booked,,,,,) = vault.epochs(e);
        uint128 total = uint128(uint256(booked) * bound(fracBps, 0, 10_000) / 10_000);
        vm.prank(operator);
        vault.commitGrants(e, total == 0 ? bytes32(0) : keccak256(abi.encode(e, total)), total, 1);
        nCommits++;

        // probe: second commit must fail
        vm.prank(operator);
        try vault.commitGrants(e, bytes32("x"), 0, 0) {
            commitTwiceSucceeded = true;
        } catch {}
    }

    function withdraw(uint256 seed, uint256 amount) external {
        calls["withdraw"]++;
        if (vault.operatorFrozen()) return;
        (bool found, uint256 e) = _pick(seed, _withdrawable);
        if (!found) return;
        (, uint128 withdrawn,,, uint128 granted,) = vault.epochs(e);
        uint256 avail = granted - withdrawn;
        amount = bound(amount, 1, avail);
        vm.prank(operator);
        vault.withdrawForUsage(e, uint128(amount), keccak256(abi.encode(e, amount)));
        ghostToSettlement += amount;
        nWithdraws++;

        // probe: one more than what is left must fail
        vm.prank(operator);
        try vault.withdrawForUsage(e, uint128(avail - amount + 1), 0) {
            withdrawOverGrantSucceeded = true;
        } catch {}
    }

    function burn(uint256 seed, uint256 maxAmount, uint256 callerSeed, uint256 slip) external {
        calls["burn"]++;
        (bool found, uint256 e) = _pick(seed, _burnable);
        if (!found) return;
        maxAmount = bound(maxAmount, 1, 20_000e6);
        if (maxAmount % 4 == 0) maxAmount = type(uint128).max; // often burn everything
        address caller = callers[callerSeed % callers.length];
        adapter.setSlippageBps(bound(slip, 0, 300));

        uint256 supply0 = ebb.totalSupply();
        uint256 adapterIn0 = adapter.totalIn(address(usdg));
        vm.recordLogs();
        vm.prank(caller);
        vault.burnExpired(e, uint128(maxAmount));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(vault) || logs[i].topics[0] != BURNED) continue;
            (uint256 usdgIn, uint256 ebbBurned, uint256 tip) = abi.decode(logs[i].data, (uint256, uint256, uint256));
            ghostTips += tip;
            nBurns++;
            ghostEbbBurned += ebbBurned;
            ghostBurnSwapIn += usdgIn - tip;
            if (supply0 - ebb.totalSupply() != ebbBurned) supplyMismatch = true; // I7
            if (adapter.totalIn(address(usdg)) - adapterIn0 != usdgIn - tip) supplyMismatch = true;
        }
        adapter.setSlippageBps(0);

        // probe I4: a fully burned tide can never be withdrawn from again
        if (vault.remaining(e) == 0 && !vault.operatorFrozen()) {
            vm.prank(operator);
            try vault.withdrawForUsage(e, 1, 0) {
                withdrawAfterBurnSucceeded = true;
            } catch {}
        }
    }

    function warp(uint256 secs) external {
        calls["warp"]++;
        // mostly short hops across tide boundaries, sometimes a jump past the 7-day expiry
        secs = secs % 6 == 0 ? bound(secs, 6 days, 8 days) : bound(secs, 1, 2 hours);
        vm.warp(block.timestamp + secs);
    }

    function freeze(uint256 seed) external {
        calls["freeze"]++;
        if (seed % 64 != 37 || vault.operatorFrozen()) return; // rare (fuzzer likes 0)
        vm.prank(guardian);
        vault.freezeOperator();
    }

    // ---- negative probes ---------------------------------------------------------------------------------------

    /// I3: burnExpired reverts for any tide that is not 7 days old yet.
    function probeBurnEarly(uint256 seed) external {
        calls["probeBurnEarly"]++;
        uint256 cur = vault.currentEpoch();
        uint256 lo = cur >= 335 ? cur - 335 : 0;
        uint256 e = bound(seed, lo, cur + 5);
        if (block.timestamp >= vault.expiresAt(e)) return;
        try vault.burnExpired(e, type(uint128).max) {
            burnBeforeExpirySucceeded = true;
        } catch {}
    }

    /// I6: swaps that deliver < 97% of the oracle quote revert (vault-side check, adapter check disabled).
    function probeBadSlippage(uint256 ethIn, uint256 slip, uint256 seed) external {
        calls["probeBadSlippage"]++;
        slip = bound(slip, 301, 10_000);
        adapter.setEnforceMinOut(false);
        adapter.setSlippageBps(slip);

        // harvest path
        ethIn = bound(ethIn, 0.01 ether, 5 ether);
        uint256 bal0 = address(vault).balance;
        vm.deal(address(vault), bal0 + ethIn);
        try vault.harvest() {
            badSlippageSwapSucceeded = true;
        } catch {}
        vm.deal(address(vault), bal0);

        // burn path
        (bool found, uint256 e) = _pick(seed, _burnable);
        if (found && vault.remaining(e) >= 1e6) {
            try vault.burnExpired(e, type(uint128).max) {
                badSlippageSwapSucceeded = true;
            } catch {}
        }

        adapter.setSlippageBps(0);
        adapter.setEnforceMinOut(true);
    }

    /// commitGrants for a tide that has not ended must revert.
    function probeCommitUnended(uint256 seed) external {
        calls["probeCommitUnended"]++;
        uint256 e = vault.currentEpoch() + bound(seed, 0, 3);
        vm.prank(operator);
        try vault.commitGrants(e, bytes32("x"), 0, 0) {
            commitUnendedSucceeded = true;
        } catch {}
    }

    // ------------------------------------------------------------------------------------------------------------
    // selection helpers
    // ------------------------------------------------------------------------------------------------------------

    function _pick(uint256 seed, function(uint256) internal view returns (bool) ok)
        internal
        view
        returns (bool, uint256)
    {
        uint256 n = touched.length;
        if (n == 0) return (false, 0);
        uint256 start = seed % n;
        for (uint256 i; i < n; ++i) {
            uint256 e = touched[(start + i) % n];
            if (ok(e)) return (true, e);
        }
        return (false, 0);
    }

    function _committable(uint256 e) internal view returns (bool) {
        (,,,,, bool closed) = vault.epochs(e);
        return !closed && e < vault.currentEpoch() && block.timestamp < vault.expiresAt(e);
    }

    function _withdrawable(uint256 e) internal view returns (bool) {
        (, uint128 withdrawn,,, uint128 granted,) = vault.epochs(e);
        return granted > withdrawn && block.timestamp < vault.expiresAt(e);
    }

    function _burnable(uint256 e) internal view returns (bool) {
        return block.timestamp >= vault.expiresAt(e) && vault.remaining(e) > 0;
    }
}
