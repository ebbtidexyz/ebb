// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {
    IPonsFactory,
    IPonsCurve,
    IPonsMemeHook,
    IPonsLaunchDeployer,
    PonsTokenParams,
    PonsLaunchConfig,
    PonsLaunchDeployment,
    PonsLaunchedToken
} from "./interfaces/IPons.sol";

interface IEbbVaultLaunchView {
    function token() external view returns (address);
    function feeCurve() external view returns (address);
    function quote() external view returns (address);
}

/// @title EbbLauncher
/// @notice Single-use contract that performs the $EBB launch on pons v2, so that the launch's initiator is a contract
///         that can do nothing else afterwards, and the creator fee recipient is the immutable EbbVault.
///
///         Who controls what on pons v2 (from the verified factory/curve/hook source):
///         - `creatorFeeRecipient` is the ONLY launch-level role with powers: `transferCreatorFeeRecipient` (redirect
///           future creator fees), `setBuybackEnabled(true)`, and sweeping the curve / no-swap hook fees. It is set to
///           the vault, which has no code path that calls any of those, so nobody can redirect fees.
///         - the initiator (`originalDeployer` = this contract) is only recorded (`LaunchedToken.deployer`, the token's
///           informational `deployer`) and exempted from the snipe tax; it has no privileged function anywhere.
///         - pons' owner keeps protocol powers: a creator-fee-recipient override (`setCreatorFeeRecipient`, public
///           proposal, executable after a 3-day timelock within a further 3 days, cancellable by the owner), disabling
///           (never enabling) buyback, rescue paths, and config changes for future launches.
///
///         `launch()` can be called once, by the EOA that deployed this contract. It launches through
///         `factory.launchToken(..., snipeTaxExemptions)` with `creatorFeeRecipient = vault`, the fixed creator tax,
///         buyback off and a non-zero economics pin, asserts the token and curve are exactly the addresses the vault
///         was deployed with, then (optionally) buys from the curve in the same transaction for `devBuyRecipient`,
///         capped at `DEV_BUY_MAX_BPS` (2%) of supply. Whatever is not spent is refunded to the deployer.
contract EbbLauncher {
    using SafeERC20 for IERC20;

    /// @notice Dev buy ceiling: 2% of supply (SPEC). A larger requested buy is clamped and the rest refunded.
    uint256 public constant DEV_BUY_MAX_BPS = 200;
    uint256 private constant BPS = 10_000;

    /// @notice EOA allowed to call `launch()` once.
    address public immutable deployer;
    IPonsFactory public immutable factory;
    /// @notice EbbVault (creator fee recipient). Must already be deployed when `launch()` runs.
    address public immutable vault;
    /// @notice Quote asset of the launch (`address(0)` native ETH, or USDG).
    address public immutable pairToken;
    /// @notice Creator tax (bps) the launch must use.
    uint16 public immutable creatorTaxBps;
    /// @notice pons launch config id.
    uint256 public immutable launchConfigId;
    /// @notice Receives the dev buy (exempted from the snipe tax at launch).
    address public immutable devBuyRecipient;

    bool public launched;
    address public launchedToken;
    address public launchedCurve;

    event Launched(address indexed token, address indexed curve, uint256 devBuyQuoteSpent, uint256 devBuyTokens);

    error NotDeployer();
    error AlreadyLaunched();
    error ZeroAddress();
    error BadParams();
    error VaultNotDeployed();
    error WrongLaunchAddresses(address token, address curve);
    error WrongLaunchRecord();
    error BadValue(uint256 value, uint256 expected);
    error DevBuyOverCap(uint256 tokensOut, uint256 cap);
    error RefundFailed();

    constructor(
        IPonsFactory factory_,
        address vault_,
        address pairToken_,
        uint16 creatorTaxBps_,
        uint256 launchConfigId_,
        address devBuyRecipient_
    ) {
        if (address(factory_) == address(0) || vault_ == address(0) || devBuyRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        deployer = msg.sender;
        factory = factory_;
        vault = vault_;
        pairToken = pairToken_;
        creatorTaxBps = creatorTaxBps_;
        launchConfigId = launchConfigId_;
        devBuyRecipient = devBuyRecipient_;
    }

    /// @notice Refunds from the curve (clamped buys) land here and are forwarded to the deployer.
    receive() external payable {}

    /// @notice The token/curve pons would deploy right now for `p` (initiator = this contract), from live factory
    ///         state. Off-chain helper for the deploy scripts; `launch()` asserts the result on-chain.
    function predict(PonsTokenParams calldata p) external view returns (address token, address curve) {
        PonsLaunchConfig memory c = factory.getLaunchConfig(launchConfigId);
        (uint256 phantom, uint256 threshold) = (c.phantomQuote, c.graduationThreshold);
        if (pairToken != address(0)) (phantom, threshold,) = factory.pairTokenEconomics(pairToken);
        address hook = factory.memeHook();
        address creatorFeeRecipient = p.creatorFeeRecipient == address(0) ? address(this) : p.creatorFeeRecipient;
        PonsLaunchDeployment memory d = PonsLaunchDeployment({
            pairToken: pairToken,
            creatorFeeRecipient: creatorFeeRecipient,
            originalDeployer: address(this),
            feePolicy: hook,
            policy: IPonsMemeHook(hook).currentFeePolicy(),
            feeEscrow: factory.feeEscrow(),
            buybackVault: factory.buybackVault(),
            phantomQuote: phantom,
            curveFeeBps: c.curveFeeBps,
            creatorTaxBps: p.creatorTaxBps,
            buybackEnabled: p.buybackEnabled,
            graduationThreshold: threshold,
            supply: c.supply,
            salt: p.salt,
            name: p.name,
            symbol: p.symbol,
            logo: p.logo,
            description: p.description,
            socials: p.socials
        });
        return IPonsLaunchDeployer(factory.launchDeployer()).predictLaunchAddresses(d);
    }

    /// @notice Quote spent / tokens received by a dev buy of `quoteIn` right now on `curve` (capped at 2% of supply).
    function devBuySpend(address curve, address token, uint256 quoteIn) public view returns (uint256 spend) {
        if (quoteIn == 0) return 0;
        IPonsCurve c = IPonsCurve(curve);
        (uint256 q, uint256 t) = c.getReserves();
        uint256 feeBps = c.feeBps() + c.creatorTaxBps();
        uint256 snipe = c.currentSnipeTaxBps(devBuyRecipient);
        if (snipe != 0) {
            uint256 maxSnipe = BPS - feeBps - 100;
            feeBps += snipe > maxSnipe ? maxSnipe : snipe;
        }
        uint256 capTokens = IERC20(token).totalSupply() * DEV_BUY_MAX_BPS / BPS;
        // largest net input that buys <= capTokens on the constant product, grossed up for the fee legs (rounded
        // down, minus a few wei for the per-leg fee rounding); the post-buy check below is the hard guarantee
        uint256 netMax = Math.mulDiv(capTokens, q, t - capTokens);
        uint256 grossMax = Math.mulDiv(netMax, BPS, BPS - feeBps);
        grossMax = grossMax > 3 ? grossMax - 3 : 0;
        spend = quoteIn < grossMax ? quoteIn : grossMax;
    }

    /// @notice Launch $EBB. Once, deployer only.
    /// @param p          token params; must name the vault as creator fee recipient, the fixed creator tax, buyback
    ///                   off, a non-zero `expectedEconomics` pin (from `previewLaunchEconomics`) and the same
    ///                   metadata + salt the vault's token address was predicted from
    /// @param devBuyQuoteIn quote asset to spend on the dev buy (ETH: sent as part of msg.value; USDG: pulled from the
    ///                   deployer, approve first). 0 = no dev buy.
    function launch(PonsTokenParams calldata p, uint256 devBuyQuoteIn)
        external
        payable
        returns (address token, address curve, uint256 devTokens)
    {
        if (msg.sender != deployer) revert NotDeployer();
        if (launched) revert AlreadyLaunched();
        launched = true;
        if (vault.code.length == 0) revert VaultNotDeployed();
        if (
            p.creatorFeeRecipient != vault || p.creatorTaxBps != creatorTaxBps || p.buybackEnabled
                || p.expectedEconomics == bytes32(0)
        ) revert BadParams();

        uint256 fee = factory.launchFee();
        bool native = pairToken == address(0);
        uint256 expectedValue = native ? fee + devBuyQuoteIn : fee;
        if (msg.value != expectedValue) revert BadValue(msg.value, expectedValue);

        address[] memory exemptions = new address[](1);
        exemptions[0] = devBuyRecipient;
        (token, curve) = factory.launchToken{value: fee}(p, launchConfigId, pairToken, exemptions);

        // the launch must be exactly the one the vault was deployed for
        IEbbVaultLaunchView v = IEbbVaultLaunchView(vault);
        if (token != v.token() || curve != v.feeCurve() || v.quote() != pairToken) {
            revert WrongLaunchAddresses(token, curve);
        }
        PonsLaunchedToken memory rec = factory.getLaunchedToken(token);
        if (
            rec.creatorFeeRecipient != vault || rec.deployer != address(this) || rec.pairToken != pairToken
                || rec.buybackEnabled || rec.creatorTaxBps != creatorTaxBps || rec.curve != curve
                || IPonsCurve(curve).deployer() != vault
        ) revert WrongLaunchRecord();

        launchedToken = token;
        launchedCurve = curve;

        uint256 spend = devBuySpend(curve, token, devBuyQuoteIn);
        if (spend != 0) {
            if (native) {
                devTokens = IPonsCurve(curve).buy{value: spend}(spend, 1, devBuyRecipient);
            } else {
                IERC20(pairToken).safeTransferFrom(msg.sender, address(this), spend);
                IERC20(pairToken).forceApprove(curve, spend);
                devTokens = IPonsCurve(curve).buy(spend, 1, devBuyRecipient);
                IERC20(pairToken).forceApprove(curve, 0);
            }
            uint256 cap = IERC20(token).totalSupply() * DEV_BUY_MAX_BPS / BPS;
            if (devTokens > cap) revert DevBuyOverCap(devTokens, cap);
        }

        // refund everything not spent (unspent dev-buy ETH, curve refunds)
        if (native && address(this).balance != 0) {
            (bool ok,) = msg.sender.call{value: address(this).balance}("");
            if (!ok) revert RefundFailed();
        } else if (!native) {
            uint256 bal = IERC20(pairToken).balanceOf(address(this));
            if (bal != 0) IERC20(pairToken).safeTransfer(msg.sender, bal);
        }
        emit Launched(token, curve, spend, devTokens);
    }
}
