// Config parsing for the Pons v2 / mainnet variables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { loadConfig, PONS_FACTORY_MAINNET } from "../src/config.js";
import { envFromDeployment } from "../scripts/mainnet-env-from-deployment.js";

const chain = {
  EBB_MODE: "chain",
  VAULT_ADDRESS: "0x2d7aA8AB158F46c2EA8FA344D05b60B216Bec293",
  TOKEN_ADDRESS: "0xB2744c634B30F43a69A292f2Bd6b09CE7c6aEe59",
  SESSION_SECRET: "x".repeat(64),
};

test("defaults: $50 burn slices, 155 s pokes, harvest at :05/:35, PONS_MODE auto, testnet RPC", () => {
  const c = loadConfig({});
  assert.equal(c.burnSliceMicro, 50_000_000n);
  assert.equal(c.burnMaxSlices, 10);
  assert.equal(c.pokeIntervalMs, 155_000);
  assert.equal(c.harvestOffsetS, 300);
  assert.equal(c.ponsMode, "auto");
  assert.equal(c.pokeTwap, undefined);
  assert.equal(c.chainId, 46630);
  assert.equal(c.rpcUrl, "https://robinhood-sepolia-rpc.publicnode.com");
  assert.equal(c.ponsFactory, undefined, "no pons factory off mainnet");
  assert.equal(c.monitorIntervalMs, 60_000);
});

test("mainnet: official RPC and pons factory by default; RPC_URL overrides", () => {
  const c = loadConfig({ ...chain, CHAIN_ID: "4663" });
  assert.equal(c.rpcUrl, "https://rpc.mainnet.chain.robinhood.com");
  assert.equal(c.ponsFactory, PONS_FACTORY_MAINNET);
  assert.equal(loadConfig({ ...chain, CHAIN_ID: "4663", RPC_URL: "https://robinhood-rpc.publicnode.com" }).rpcUrl, "https://robinhood-rpc.publicnode.com");
});

test("PONS_MODE / POKE_TWAP_ADDRESS / tuning parse", () => {
  assert.equal(loadConfig({ PONS_MODE: "true" }).ponsMode, true);
  assert.equal(loadConfig({ PONS_MODE: "FALSE" }).ponsMode, false);
  assert.equal(loadConfig({ PONS_MODE: "1" }).ponsMode, true);
  assert.equal(loadConfig({ PONS_MODE: "" }).ponsMode, "auto");
  assert.throws(() => loadConfig({ PONS_MODE: "maybe" }), /PONS_MODE/);
  const c = loadConfig({
    POKE_TWAP_ADDRESS: "0x853dba716093075b7ba9768ab5aea12267b1d5f3", POKE_INTERVAL_MS: "160000", HARVEST_OFFSET_S: "4000",
    BURN_SLICE_MICRO: "100000000", BURN_MAX_SLICES: "0", PONS_FACTORY_ADDRESS: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
  });
  assert.equal(c.pokeTwap, "0x853dbA716093075B7bA9768AB5aEA12267b1D5F3", "checksummed");
  assert.equal(c.pokeIntervalMs, 160_000);
  assert.equal(c.harvestOffsetS, 1_799, "clamped inside the tide");
  assert.equal(c.burnSliceMicro, 100_000_000n);
  assert.equal(c.burnMaxSlices, 1, "at least one slice");
  assert.equal(c.ponsFactory, PONS_FACTORY_MAINNET);
  assert.equal(loadConfig({ POKE_INTERVAL_MS: "1000" }).pokeIntervalMs, 30_000, "floor 30 s");
  assert.throws(() => loadConfig({ POKE_TWAP_ADDRESS: "0x1234" }), /POKE_TWAP_ADDRESS/);
  assert.throws(() => loadConfig({ BURN_SLICE_MICRO: "50.5" }), /BURN_SLICE_MICRO/);
  assert.throws(() => loadConfig({ ...chain, BURN_SLICE_MICRO: "0" }), /BURN_SLICE_MICRO must be > 0/);
});

test("mainnet-env-from-deployment prints every address and no secrets", () => {
  const dep = {
    chainId: 4663, deployBlock: 79000000, genesis: 1791212400, pair: "eth",
    deployer: "0x1111111111111111111111111111111111111111", launcher: "0x2222222222222222222222222222222222222222",
    spotSource: "0x3333333333333333333333333333333333333333", pokeTwap: "0x4444444444444444444444444444444444444444",
    oracle: "0x5555555555555555555555555555555555555555", swapAdapter: "0x6666666666666666666666666666666666666666",
    token: "0x7777777777777777777777777777777777777777", curve: "0x8888888888888888888888888888888888888888",
    poolId: "0x" + "ab".repeat(32), usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", feeSource: "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e",
    ponsFactory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e", ponsHook: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
    poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951", treasury: "0x9999999999999999999999999999999999999999",
    settlement: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa", operator: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
    guardian: "0xcCCCCCCCcccCCCCCCCCcCCcCcccCCCCCcCcCCCcC", devBuyRecipient: "0xdDdDddDdDdddDDddDDddDDDDdDdDDdDDdDDDDDDd",
    vault: "0xeEEEEEEeEEEeeEeEeEEEeEEeEEeeeeeeEEeEeeeE",
  };
  const out = envFromDeployment(dep);
  for (const k of ["CHAIN_ID=4663", `VAULT_ADDRESS=${getAddress(dep.vault.toLowerCase())}`, "TOKEN_ADDRESS=0x7777777777777777777777777777777777777777",
    "USDG_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "DEPLOY_BLOCK=79000000", "POKE_TWAP_ADDRESS=0x4444444444444444444444444444444444444444",
    "PONS_MODE=true", "PONS_FACTORY_ADDRESS=0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"]) {
    assert.ok(out.includes(k + "\n"), k);
  }
  const excl = /EXCLUDED_ADDRESSES=(.*)\n/.exec(out)![1].split(",");
  for (const a of [dep.vault, dep.launcher, dep.curve, dep.swapAdapter, dep.poolManager, "0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952", "0x42df2a798f82289E177311362e8f5ccC45c1219c", "0x000000000000000000000000000000000000dEaD"]) {
    assert.ok(excl.map((x) => x.toLowerCase()).includes(a.toLowerCase()), a);
  }
  assert.ok(!excl.map((x) => x.toLowerCase()).includes(dep.devBuyRecipient.toLowerCase()), "dev buy wallet is a holder, not excluded");
  assert.doesNotMatch(out, /PRIVATE_KEY=0x[0-9a-f]{64}/i);
  // the env it prints must load
  const env = Object.fromEntries(out.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const c = loadConfig({ ...env, SESSION_SECRET: "y".repeat(64), OPERATOR_PRIVATE_KEY: "", KEEPER_PRIVATE_KEY: "" });
  assert.equal(c.chainId, 4663);
  assert.equal(c.ponsMode, true);
  assert.equal(c.excluded.length, excl.length);
});
