// Grant + usage Merkle trees (OpenZeppelin StandardMerkleTree).
// Grant leaf = keccak256(bytes.concat(keccak256(abi.encode(uint256 epoch, address wallet, uint256 amount))))
// which is exactly what EbbVault.verifyGrant checks.
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { encodeAbiParameters, getAddress, keccak256, concat, zeroHash, type Address, type Hex } from "viem";

export const GRANT_LEAF_TYPES = ["uint256", "address", "uint256"] as const;
export type GrantLeaf = [string, string, string]; // [epoch, wallet, amount] as decimal strings / address

export function buildGrantTree(epoch: number, grants: readonly { addr: string; amount: bigint }[]) {
  if (grants.length === 0) throw new Error("buildGrantTree: no grants");
  const values: GrantLeaf[] = grants.map((g) => [String(epoch), getAddress(g.addr), g.amount.toString()]);
  return StandardMerkleTree.of(values, [...GRANT_LEAF_TYPES]);
}

export function loadGrantTree(dump: string) {
  return StandardMerkleTree.load<GrantLeaf>(JSON.parse(dump));
}

export function grantProof(tree: StandardMerkleTree<GrantLeaf>, wallet: string): { amount: bigint; proof: Hex[]; leaf: Hex } | null {
  const w = wallet.toLowerCase();
  for (const [i, v] of tree.entries()) {
    if (String(v[1]).toLowerCase() === w) {
      return { amount: BigInt(v[2]), proof: tree.getProof(i) as Hex[], leaf: tree.leafHash(v) as Hex };
    }
  }
  return null;
}

/** The contract's leaf hash, computed independently with viem. */
export function contractGrantLeaf(epoch: bigint, wallet: Address, amount: bigint): Hex {
  return keccak256(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [epoch, wallet, amount])));
}

/** OZ MerkleProof.processProof (commutative keccak of sorted pairs). */
export function processProof(leaf: Hex, proof: readonly Hex[]): Hex {
  let h = leaf;
  for (const p of proof) h = BigInt(h) < BigInt(p) ? keccak256(concat([h, p])) : keccak256(concat([p, h]));
  return h;
}

// Usage tree for withdrawForUsage: leaves (request_id, amount_micro debited from this epoch).
export const USAGE_LEAF_TYPES = ["string", "uint256"] as const;
export function usageRoot(leaves: readonly { requestId: string; amount: bigint }[]): Hex {
  if (leaves.length === 0) return zeroHash;
  const tree = StandardMerkleTree.of(
    leaves.map((l) => [l.requestId, l.amount.toString()] as [string, string]),
    [...USAGE_LEAF_TYPES],
  );
  return tree.root as Hex;
}
