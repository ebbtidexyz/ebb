import { test } from "node:test";
import assert from "node:assert/strict";
import { GRANT_FLOOR } from "@ebb/shared";
import { twab, twabAll } from "../src/core/twab.js";

const E18 = 10n ** 18n;
const start = 1_800_000_000;
const end = start + 1800;

test("a 5-minute hold at the end of a 30-minute tide counts 1/6", () => {
  const B = 600_000n * E18;
  const v = twab([{ ts: end - 300, balance: B }], start, end);
  assert.equal(v, B / 6n);
  assert.equal(v, GRANT_FLOOR); // 600k held for 5 min == the 100k floor exactly
});

test("holding through the whole tide counts in full; points before start set the opening balance", () => {
  const B = 123n * E18;
  assert.equal(twab([{ ts: start - 10_000, balance: 1n }, { ts: start - 5, balance: B }], start, end), B);
  assert.equal(twab([{ ts: start, balance: B }], start, end), B); // point exactly at start
});

test("selling half-way halves the TWAB; points at/after end are ignored", () => {
  const B = 1_000n * E18;
  const pts = [
    { ts: start - 60, balance: B },
    { ts: start + 900, balance: 0n },
    { ts: end, balance: 10n ** 30n },
    { ts: end + 50, balance: 10n ** 30n },
  ];
  assert.equal(twab(pts, start, end), B / 2n);
});

test("step function integrates piecewise with floor division", () => {
  // 0 for 600s, 3 for 600s, 7 for 600s → (0 + 1800 + 4200) / 1800 = 3.333.. → 3
  const v = twab([{ ts: start + 600, balance: 3n }, { ts: start + 1200, balance: 7n }], start, end);
  assert.equal(v, 3n);
});

test("no points means zero", () => {
  assert.equal(twab([], start, end), 0n);
});

test("twabAll groups by address (case-insensitive) and drops zeros", () => {
  const m = twabAll(
    [
      { addr: "0xAA", ts: start - 1, balance: 600n },
      { addr: "0xaa", ts: start + 900, balance: 0n },
      { addr: "0xbb", ts: end - 300, balance: 60n },
      { addr: "0xcc", ts: start - 1, balance: 0n },
    ],
    start,
    end,
  );
  assert.equal(m.get("0xaa"), 300n);
  assert.equal(m.get("0xbb"), 10n);
  assert.equal(m.has("0xcc"), false);
});

test("rejects an empty window", () => {
  assert.throws(() => twab([], start, start));
});
