import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

// ---- Pons v2 mainnet (subset; see contracts/src/interfaces/IPons.sol, contracts/src/oracle/*) ----------------

/** contracts/src/oracle/PokeTwapOracle.sol */
export const pokeTwapAbi = parseAbi([
  "struct Observation { uint64 timestamp; uint256 cumulative; uint256 price; }",
  "function poke()",
  "function assets() view returns (address[])",
  "function minInterval() view returns (uint256)",
  "function window() view returns (uint256)",
  "function feeds(address asset) view returns (uint16 index, uint16 count, bool tracked)",
  "function latest(address asset) view returns (Observation)",
  "function twap(address asset) view returns (uint256)",
]);

/** contracts/src/oracle/PonsOracle.sol (only to discover the poke TWAP when POKE_TWAP_ADDRESS is unset) */
export const ponsOracleAbi = parseAbi(["function tokenTwap() view returns (address)"]);

/**
 * pons v2 factory. The fee-recipient events are not in IPons.sol; their signatures were matched against the
 * factory's deployed bytecode (topic0 present as PUSH32) and their topic order checked against real mainnet logs
 * (a proposal's `currentRecipient` equals the later `CreatorFeeRecipientUpdated.oldRecipient`):
 *   CreatorFeeRecipientChangeProposed  0x7f119e44c84a715429bee60d30ad2e14afdef6c60bb1a7eaa01290ecf6d1b2e5
 *   CreatorFeeRecipientUpdated         0x308c390ed1ab5873392818e036cabdf408bc8ad042fbaead3108954ff75ba980
 *   CreatorFeeRecipientChangeCancelled 0xbe2de91c1cbef653c760573fff8355c0c851d35ed2a898342b4db556301cccf4
 * `executableAt` = proposal + 3 days, `expiresAt` = proposal + 6 days. No cancellation has ever been emitted on
 * mainnet, so its argument names / indexing are assumed (the token is matched on topic1 or in data).
 */
export const ponsFactoryAbi = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
  "event CreatorFeeRecipientChangeProposed(address indexed token, address indexed currentRecipient, address indexed newRecipient, uint256 executableAt, uint256 expiresAt)",
  "event CreatorFeeRecipientUpdated(address indexed token, address indexed oldRecipient, address indexed newRecipient)",
  "event CreatorFeeRecipientChangeCancelled(address indexed token, address indexed recipient)",
]);

export const ponsCurveAbi = parseAbi([
  "function realQuoteReserve() view returns (uint256)",
  "function quoteFeeBalance() view returns (uint256)",
  "function creatorTaxBalance() view returns (uint256)",
  "function graduated() view returns (bool)",
]);

export const ponsHookAbi = parseAbi([
  "function pendingFees(bytes32 poolId, address currency) view returns (uint256)",
  "function pendingCreatorTax(bytes32 poolId, address currency) view returns (uint256)",
]);

export const ponsEscrowAbi = parseAbi([
  "function balanceOf(address recipient) view returns (uint256)",
  "function balanceOfToken(address recipient, address token) view returns (uint256)",
]);
