import { test } from "node:test";
import assert from "node:assert/strict";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, keccak256, encodeAbiParameters, type Hex } from "viem";
import { buildGrantTree, contractGrantLeaf, grantProof, loadGrantTree, processProof, usageRoot } from "../src/core/merkle.js";

const wallets = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01",
  "0x00000000000000000000000000000000000000ff",
  "0x9999999999999999999999999999999999999999",
];

test("grant proofs verify against the contract's leaf = keccak256(bytes.concat(keccak256(abi.encode(epoch, wallet, amount))))", () => {
  const epoch = 244;
  const grants = wallets.map((w, i) => ({ addr: w, amount: BigInt(1_000_000 * (i + 1) + i) }));
  const tree = buildGrantTree(epoch, grants);
  for (const g of grants) {
    const p = grantProof(tree, g.addr.toLowerCase());
    assert.ok(p);
    assert.equal(p.amount, g.amount);
    const leaf = contractGrantLeaf(BigInt(epoch), getAddress(g.addr), g.amount);
    // independent recomputation of the leaf by hand
    const manual = keccak256(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [244n, getAddress(g.addr), g.amount])));
    assert.equal(leaf, manual);
    assert.equal(p.leaf, leaf, "OZ leaf hash == contract leaf hash");
    assert.equal(processProof(leaf, p.proof), tree.root, "OZ MerkleProof.verify semantics");
  }
  // a wrong amount, epoch or wallet does not verify
  const p0 = grantProof(tree, wallets[0])!;
  assert.notEqual(processProof(contractGrantLeaf(244n, getAddress(wallets[0]), p0.amount + 1n), p0.proof), tree.root);
  assert.notEqual(processProof(contractGrantLeaf(245n, getAddress(wallets[0]), p0.amount), p0.proof), tree.root);
  assert.notEqual(processProof(contractGrantLeaf(244n, getAddress(wallets[1]), p0.amount), p0.proof), tree.root);
  assert.equal(grantProof(tree, "0x3333333333333333333333333333333333333333"), null);
});

test("tree dump/load roundtrip keeps root and proofs", () => {
  const tree = buildGrantTree(7, wallets.slice(0, 3).map((w, i) => ({ addr: w, amount: BigInt(i + 1) })));
  const again = loadGrantTree(JSON.stringify(tree.dump()));
  assert.equal(again.root, tree.root);
  const p = grantProof(again, wallets[2])!;
  assert.equal(processProof(contractGrantLeaf(7n, getAddress(wallets[2]), 3n), p.proof), tree.root);
  assert.ok(StandardMerkleTree.verify(tree.root, ["uint256", "address", "uint256"], ["7", getAddress(wallets[2]), "3"], p.proof));
});

test("single-grant tree: empty proof, root == leaf", () => {
  const tree = buildGrantTree(1, [{ addr: wallets[0], amount: 5n }]);
  const p = grantProof(tree, wallets[0])!;
  assert.deepEqual(p.proof, []);
  assert.equal(tree.root as Hex, contractGrantLeaf(1n, getAddress(wallets[0]), 5n));
});

test("usage root is order-independent and zero for no leaves", () => {
  const a = usageRoot([{ requestId: "req_a", amount: 1n }, { requestId: "req_b", amount: 2n }]);
  const b = usageRoot([{ requestId: "req_b", amount: 2n }, { requestId: "req_a", amount: 1n }]);
  assert.equal(a, b);
  assert.match(usageRoot([]), /^0x0{64}$/);
});
