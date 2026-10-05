// Prints the chain-derived API env lines for the Pons v2 mainnet deployment (no secrets).
// Usage (from services/api):
//   npx tsx scripts/mainnet-env-from-deployment.ts [../../contracts/deployments/4663.json] >> /opt/ebb/.env.api
// The json is what contracts/script/DeployMainnet.s.sol writes on --broadcast. Review the output before using it;
// secrets (SESSION_SECRET, OPERATOR_PRIVATE_KEY, KEEPER_PRIVATE_KEY) are printed as empty placeholders.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getAddress, isAddress } from "viem";

/** pons v2 contracts that hold $EBB but never belong to a holder (contracts/README.md, factory reads 2026-10-03) */
const PONS_LOCKER = "0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952";
const PONS_BUYBACK_VAULT = "0x42df2a798f82289E177311362e8f5ccC45c1219c";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const ZERO = "0x0000000000000000000000000000000000000000";

export interface Deployment4663 {
  chainId: number;
  deployBlock: number;
  genesis: number;
  pair?: string;
  [k: string]: unknown;
}

export function envFromDeployment(d: Deployment4663): string {
  const addr = (k: string, required = true): string | null => {
    const v = d[k];
    if (typeof v === "string" && isAddress(v, { strict: false })) return getAddress(v);
    if (required) throw new Error(`deployment json: missing/invalid address "${k}"`);
    return null;
  };
  if (d.chainId !== 4663) throw new Error(`deployment json is for chain ${d.chainId}, expected 4663`);
  const vault = addr("vault")!;
  const token = addr("token")!;
  // the allocator must never grant to contracts that hold $EBB for the market: the curve holds the whole unsold
  // supply before graduation, the v4 PoolManager holds the pool's $EBB after it. The API also adds the vault's
  // token/usdg/treasury/settlement and (in Pons mode) curve/hook/escrow/adapter/PoolManager/locker/buyback vault
  // itself; listing them here keeps the env explicit and auditable.
  const excluded = [
    vault, addr("launcher"), addr("curve"), addr("swapAdapter"), addr("poolManager"), PONS_LOCKER, PONS_BUYBACK_VAULT,
    addr("ponsHook", false), addr("feeSource", false), addr("ponsFactory", false), token, addr("treasury", false),
    addr("settlement", false), DEAD, ZERO,
  ].filter((x): x is string => !!x);
  const uniq = [...new Map(excluded.map((a) => [a.toLowerCase(), getAddress(a)])).values()];

  const lines = [
    `# --- generated from contracts/deployments/4663.json (pair=${d.pair ?? "?"}, genesis=${new Date(d.genesis * 1000).toISOString()}) ---`,
    "EBB_MODE=chain",
    "CHAIN_ID=4663",
    "RPC_URL=https://rpc.mainnet.chain.robinhood.com",
    `VAULT_ADDRESS=${vault}`,
    `TOKEN_ADDRESS=${token}`,
    `USDG_ADDRESS=${addr("usdg")}`,
    `DEPLOY_BLOCK=${d.deployBlock}`,
    "PONS_MODE=true",
    `POKE_TWAP_ADDRESS=${addr("pokeTwap")}`,
    `PONS_FACTORY_ADDRESS=${addr("ponsFactory", false) ?? "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"}`,
    `EXCLUDED_ADDRESSES=${uniq.join(",")}`,
    `# operator (must sign commitGrants/withdrawForUsage): ${addr("operator", false) ?? "?"}`,
    `# guardian: ${addr("guardian", false) ?? "?"}   treasury: ${addr("treasury", false) ?? "?"}   settlement: ${addr("settlement", false) ?? "?"}`,
    `# curve: ${addr("curve")}   poolId: ${String(d.poolId ?? "?")}   dev buy recipient (a holder, NOT excluded): ${addr("devBuyRecipient", false) ?? "?"}`,
    "# secrets: fill in by hand",
    "SESSION_SECRET=",
    "OPERATOR_PRIVATE_KEY=",
    "KEEPER_PRIVATE_KEY=",
  ];
  return lines.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(process.argv[2] ?? resolve(here, "../../../contracts/deployments/4663.json"));
  let json: Deployment4663;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`cannot read ${path}: ${e instanceof Error ? e.message : e}\n(run contracts/script/DeployMainnet.s.sol --broadcast first, or pass the dry-run json path)`);
    process.exit(1);
  }
  try {
    process.stdout.write(envFromDeployment(json));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
