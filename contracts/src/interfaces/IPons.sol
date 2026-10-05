// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal, ABI-compatible subset of the pons v2 launchpad on Robinhood Chain (4663), taken from the
///         source verified on robin.etherscan.io (factory 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e, exact match).
///         Only what Ebb calls or reads is declared here.

/// @dev Frozen per launch at creation (factory reads it from the meme hook's `currentFeePolicy()`).
struct PonsFeePolicySnapshot {
    address protocolFeeRecipient;
    uint16 protocolFeeShareBps;
    uint16 buybackBurnBps;
    uint16 hookFeeBps;
    uint16 maxInternalPriceImpactBps;
}

struct PonsSocials {
    string twitter;
    string telegram;
    string discord;
    string website;
    string farcaster;
}

struct PonsTokenParams {
    string name;
    string symbol;
    string logo;
    string description;
    PonsSocials socials;
    address creatorFeeRecipient;
    uint16 creatorTaxBps;
    bool buybackEnabled;
    bytes32 expectedEconomics;
    bytes32 salt;
}

struct PonsLaunchConfig {
    uint256 supply;
    uint256 curveFeeBps;
    uint256 phantomQuote;
    uint256 graduationThreshold;
    uint24 poolFee;
    int24 tickSpacing;
    bool enabled;
}

/// @dev phase: 0 NotGraduated (curve), 1 Swept, 2 PoolCreated (Uniswap v4), 3 Rescued
struct PonsLaunchedToken {
    address token;
    address curve;
    address deployer;
    address creatorFeeRecipient;
    address pairToken;
    uint256 graduationThreshold;
    uint24 poolFee;
    int24 tickSpacing;
    uint16 creatorTaxBps;
    bool buybackEnabled;
    uint8 phase;
    uint256 sweptQuote;
    uint256 sweptTokens;
    uint256 sweptAt;
    bool exists;
}

/// @dev Argument of PonsV2LaunchDeployer.predictLaunchAddresses (same layout as its `LaunchDeployment`).
struct PonsLaunchDeployment {
    address pairToken;
    address creatorFeeRecipient;
    address originalDeployer;
    address feePolicy; // the meme hook
    PonsFeePolicySnapshot policy;
    address feeEscrow;
    address buybackVault;
    uint256 phantomQuote;
    uint256 curveFeeBps;
    uint256 creatorTaxBps;
    bool buybackEnabled;
    uint256 graduationThreshold;
    uint256 supply;
    bytes32 salt;
    string name;
    string symbol;
    string logo;
    string description;
    PonsSocials socials;
}

uint8 constant PONS_PHASE_NOT_GRADUATED = 0;
uint8 constant PONS_PHASE_POOL_CREATED = 2;

interface IPonsFactory {
    function launchToken(
        PonsTokenParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        address[] calldata snipeTaxExemptions
    ) external payable returns (address token, address curve);
    function previewLaunchEconomics(uint256 launchConfigId, address pairToken) external view returns (bytes32);
    function getLaunchConfig(uint256 id) external view returns (PonsLaunchConfig memory);
    function pairTokenEconomics(address pairToken)
        external
        view
        returns (uint256 phantomQuote, uint256 graduationThreshold, uint8 decimals);
    function getLaunchedToken(address token) external view returns (PonsLaunchedToken memory);
    function launchFee() external view returns (uint256);
    function canLaunch(address launcher) external view returns (bool);
    function maxCreatorTaxBps() external view returns (uint256);
    function poolManager() external view returns (address);
    function memeHook() external view returns (address);
    function feeEscrow() external view returns (address);
    function buybackVault() external view returns (address);
    function launchDeployer() external view returns (address);
    function owner() external view returns (address);
    function createGraduatedPool(address token) external returns (uint256 positionId);
    function graduate(address token) external;
    function transferCreatorFeeRecipient(address token, address newRecipient) external;
    function setBuybackEnabled(address token, bool enabled) external;
    function setCreatorFeeRecipient(address token, address newRecipient) external;
    function executeCreatorFeeRecipientChange(address token) external;
}

interface IPonsLaunchDeployer {
    function predictLaunchAddresses(PonsLaunchDeployment calldata params)
        external
        view
        returns (address token, address curve);
}

interface IPonsCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256);
    function sweepFees(uint256 minBuybackTokensOut) external;
    function getReserves() external view returns (uint256 quoteReserve, uint256 tokenReserve);
    function sellableTokens() external view returns (uint256);
    function reservedTokens() external view returns (uint256);
    function feeBps() external view returns (uint256);
    function creatorTaxBps() external view returns (uint256);
    function currentSnipeTaxBps(address recipient) external view returns (uint256);
    function graduated() external view returns (bool);
    function readyToGraduate() external view returns (bool);
    function deployer() external view returns (address);
    function pairToken() external view returns (address);
    function token() external view returns (address);
    function quoteFeeBalance() external view returns (uint256);
    function creatorTaxBalance() external view returns (uint256);
    function buybackEnabled() external view returns (bool);
    function realQuoteReserve() external view returns (uint256);
}

interface IPonsMemeHook {
    function launches(bytes32 poolId)
        external
        view
        returns (
            bool registered,
            bool memecoinIsCurrency0,
            address memecoin,
            address quoteToken,
            address creator,
            address buybackCreatorRecipient,
            address protocolFeeRecipient,
            uint16 creatorTaxBps,
            uint16 protocolFeeShareBps,
            uint16 buybackBurnBps,
            uint16 hookFeeBps,
            uint16 maxInternalPriceImpactBps,
            bool buybackEnabled
        );
    function sweepPoolFees(bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut) external;
    function pendingFees(bytes32 poolId, address currency) external view returns (uint256);
    function pendingCreatorTax(bytes32 poolId, address currency) external view returns (uint256);
    function currentFeePolicy() external view returns (PonsFeePolicySnapshot memory);
    function feeSweepOperator() external view returns (address);
}

/// @dev Fee escrow: every balance is claimable only by its recipient (`msg.sender`).
interface IPonsFeeEscrow {
    function claim() external returns (uint256 amount);
    function claimToken(address token) external returns (uint256 amount);
    function balanceOf(address recipient) external view returns (uint256);
    function balanceOfToken(address recipient, address token) external view returns (uint256);
}
