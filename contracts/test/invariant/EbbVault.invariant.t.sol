// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {console} from "forge-std/console.sol";
import {Base} from "../utils/Base.sol";
import {VaultHandler} from "./VaultHandler.sol";

/// @title EbbVault invariants I1–I8 (SPEC §4.2)
contract EbbVaultInvariantTest is StdInvariant, Base {
    VaultHandler internal handler;
    uint256 internal initialSupply;

    function setUp() public override {
        super.setUp();
        handler = new VaultHandler(vault, usdg, ebb, adapter, oracle, operator, guardian);
        initialSupply = ebb.totalSupply();

        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = VaultHandler.harvest.selector;
        selectors[1] = VaultHandler.commit.selector;
        selectors[2] = VaultHandler.withdraw.selector;
        selectors[3] = VaultHandler.burn.selector;
        selectors[4] = VaultHandler.warp.selector;
        selectors[5] = VaultHandler.freeze.selector;
        selectors[6] = VaultHandler.probeBurnEarly.selector;
        selectors[7] = VaultHandler.probeBadSlippage.selector;
        selectors[8] = VaultHandler.probeCommitUnended.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function _sumRemaining() internal view returns (uint256 sum) {
        uint256 n = handler.touchedLength();
        for (uint256 i; i < n; ++i) {
            sum += vault.remaining(handler.touched(i));
        }
    }

    /// I1: the vault holds exactly Σ remaining(e) (plus USDG donated since the last harvest, which the next harvest
    ///     books). `totalOpen` is that same sum.
    function invariant_I1_balanceEqualsOpenCredits() public view {
        uint256 sum = _sumRemaining();
        assertEq(vault.totalOpen(), sum, "totalOpen != sum remaining");
        assertEq(usdg.balanceOf(address(vault)), sum + handler.ghostDonatedPending(), "I1");
    }

    /// I2: withdrawn <= granted <= booked for every tide.
    function invariant_I2_withdrawnLeGrantedLeBooked() public view {
        uint256 n = handler.touchedLength();
        for (uint256 i; i < n; ++i) {
            (uint128 booked, uint128 withdrawn, uint128 burned,, uint128 granted,) = vault.epochs(handler.touched(i));
            assertLe(withdrawn, granted, "withdrawn > granted");
            assertLe(granted, booked, "granted > booked");
            assertLe(uint256(withdrawn) + burned, booked, "over-spent");
        }
    }

    /// I3: burnExpired never succeeds before epochStart + 7d.
    function invariant_I3_noEarlyBurn() public view {
        assertFalse(handler.burnBeforeExpirySucceeded(), "I3");
    }

    /// I4: once a tide is fully burned, withdrawForUsage on it reverts.
    function invariant_I4_noWithdrawAfterBurn() public view {
        assertFalse(handler.withdrawAfterBurnSucceeded(), "I4");
    }

    /// I5: every harvest splits toPool*3000 == toTreasury*7000 (rounding to the pool).
    function invariant_I5_split() public view {
        assertFalse(handler.splitViolated(), "I5");
    }

    /// I6: swaps outside 3% of the oracle quote revert.
    function invariant_I6_oracleBound() public view {
        assertFalse(handler.badSlippageSwapSucceeded(), "I6");
    }

    /// I7: totalSupply drops by exactly ebbBurned per burn.
    function invariant_I7_supplyDropsByBurned() public view {
        assertFalse(handler.supplyMismatch(), "I7 per-burn");
        assertEq(ebb.totalSupply(), initialSupply - handler.ghostEbbBurned(), "I7 cumulative");
    }

    /// I8: USDG only ever leaves to settlement, treasury, the burn swap or a caller tip — and every unit is
    ///     accounted for.
    function invariant_I8_usdgOnlyToAllowedSinks() public view {
        assertEq(usdg.balanceOf(treasury), handler.ghostToTreasury(), "treasury");
        assertEq(usdg.balanceOf(settlement), handler.ghostToSettlement(), "settlement");
        uint256 tips;
        for (uint256 i; i < handler.callersLength(); ++i) {
            tips += usdg.balanceOf(handler.callers(i));
        }
        assertEq(tips, handler.ghostTips(), "tips");
        assertEq(adapter.totalIn(address(usdg)), handler.ghostBurnSwapIn(), "burn path");

        uint256 inflow = adapter.totalOut(address(usdg)) + handler.ghostDonatedTotal();
        uint256 outflow = usdg.balanceOf(address(vault)) + usdg.balanceOf(treasury) + usdg.balanceOf(settlement) + tips
            + adapter.totalIn(address(usdg));
        assertEq(inflow, outflow, "USDG conservation");
    }

    /// Operator safety probes.
    function invariant_operatorBounds() public view {
        assertFalse(handler.commitTwiceSucceeded(), "commit twice");
        assertFalse(handler.commitUnendedSucceeded(), "commit unended");
        assertFalse(handler.withdrawOverGrantSucceeded(), "withdraw > granted");
    }

    /// @dev Accumulates effective-action counts across runs (printed with -vv) so coverage can be checked.
    function afterInvariant() external view {
        console.log("harvests", handler.nHarvests(), "commits", handler.nCommits());
        console.log("withdraws", handler.nWithdraws(), "burns", handler.nBurns());
    }
}
