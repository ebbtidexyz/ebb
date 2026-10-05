// Regenerates packages/shared/src/abi/EbbVault.ts from the compiled artifact.
// Usage (from contracts/): forge build && node script/export-abi.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const artifact = resolve(here, "../out/EbbVault.sol/EbbVault.json");
const target = resolve(here, "../../packages/shared/src/abi/EbbVault.ts");

const { abi } = JSON.parse(readFileSync(artifact, "utf8"));
const body =
  "// GENERATED from contracts/out/EbbVault.sol/EbbVault.json — do not edit by hand.\n" +
  "// Regenerate: cd contracts && forge build && node script/export-abi.mjs\n" +
  `export const ebbVaultAbi = ${JSON.stringify(abi, null, 2)} as const;\n`;
writeFileSync(target, body);
console.log(`wrote ${abi.length} ABI items to ${target}`);
