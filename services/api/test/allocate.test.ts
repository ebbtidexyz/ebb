import { test } from "node:test";
import assert from "node:assert/strict";
import { GRANT_FLOOR } from "@ebb/shared";
import { allocate } from "../src/core/allocate.js";

const E18 = 10n ** 18n;
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
const D = "0x00000000000000000000000000000000000000d4";

test("pro-rata with floor division; dust stays unallocated", () => {
  const twabs = new Map([
    [A, 100_000n * E18],
    [B, 200_000n * E18],
    [C, 400_000n * E18],
  ]);
  const booked = 1_000_000n; // $1.00 split 1:2:4
  const r = allocate(booked, twabs, { floor: GRANT_FLOOR, excluded: [] });
  const by = Object.fromEntries(r.grants.map((g) => [g.addr.toLowerCase(), g.amount]));
  assert.equal(by[A], 142_857n); // floor(1e6 * 1/7)
  assert.equal(by[B], 285_714n); // floor(1e6 * 2/7)
  assert.equal(by[C], 571_428n); // floor(1e6 * 4/7)
  assert.equal(r.total, 999_999n);
  assert.equal(r.dust, 1n);
  assert.equal(r.total + r.dust, booked);
  assert.equal(r.eligibleTwab, 700_000n * E18);
});

test("below the floor and excluded addresses get nothing and do not dilute", () => {
  const twabs = new Map([
    [A, GRANT_FLOOR], // exactly the floor: eligible
    [B, GRANT_FLOOR - 1n], // just below
    [C, 10n * GRANT_FLOOR], // excluded (e.g. the AMM pool)
  ]);
  const r = allocate(5_000_000n, twabs, { floor: GRANT_FLOOR, excluded: [C.toUpperCase().replace("0X", "0x")] });
  assert.equal(r.grants.length, 1);
  assert.equal(r.grants[0].addr.toLowerCase(), A);
  assert.equal(r.grants[0].amount, 5_000_000n);
  assert.equal(r.dust, 0n);
});

test("nobody eligible → everything is dust", () => {
  const r = allocate(42n, new Map([[A, 1n]]), { floor: GRANT_FLOOR, excluded: [] });
  assert.equal(r.grants.length, 0);
  assert.equal(r.dust, 42n);
});

test("zero-amount grants are dropped (tiny booked, many holders)", () => {
  const twabs = new Map([
    [A, 1_000_000n * E18],
    [B, 100_000n * E18],
    [D, 100_000n * E18],
  ]);
  const r = allocate(3n, twabs, { floor: GRANT_FLOOR, excluded: [] });
  // floor(3*10/12)=2, floor(3*1/12)=0, floor(3*1/12)=0
  assert.deepEqual(r.grants.map((g) => [g.addr.toLowerCase(), g.amount]), [[A, 2n]]);
  assert.equal(r.dust, 1n);
});

test("output is sorted by address and deterministic", () => {
  const twabs = new Map([
    [D, GRANT_FLOOR],
    [A, GRANT_FLOOR],
    [C, GRANT_FLOOR],
  ]);
  const r1 = allocate(999n, twabs, { floor: GRANT_FLOOR, excluded: [] });
  const r2 = allocate(999n, new Map([...twabs].reverse()), { floor: GRANT_FLOOR, excluded: [] });
  assert.deepEqual(r1, r2);
  assert.deepEqual(r1.grants.map((g) => g.addr.toLowerCase()), [A, C, D]);
});
