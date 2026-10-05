// Testnet only: simulates launchpad trading fees so tides keep flowing. Mints a random
// $5–$60 of MockUSDG (its mint is open) into the vault, then calls harvest().
// Run from a timer: KEEPER_PRIVATE_KEY, RPC_URL, VAULT_ADDRESS, USDG_ADDRESS from the API env.
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ebbVaultAbi } from "@ebb/shared";

if (Number(process.env.CHAIN_ID) !== 46630) throw new Error("testnet-inflow refuses to run outside chain 46630");

const transport = http(process.env.RPC_URL);
const account = privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY as `0x${string}`);
const pub = createPublicClient({ transport });
const wallet = createWalletClient({ account, transport });
const vault = process.env.VAULT_ADDRESS as `0x${string}`;
const usdg = process.env.USDG_ADDRESS as `0x${string}`;

const amount = BigInt(5_000_000 + Math.floor(Math.random() * 55_000_000));
const mint = await wallet.writeContract({ chain: null, address: usdg, abi: parseAbi(["function mint(address,uint256)"]), functionName: "mint", args: [vault, amount] });
await pub.waitForTransactionReceipt({ hash: mint });
const harvest = await wallet.writeContract({ chain: null, address: vault, abi: ebbVaultAbi, functionName: "harvest" });
const receipt = await pub.waitForTransactionReceipt({ hash: harvest });
console.log(JSON.stringify({ inflow_micro: amount.toString(), harvest: harvest, status: receipt.status }));
