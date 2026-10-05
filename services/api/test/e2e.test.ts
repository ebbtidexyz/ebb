// In-process end-to-end: sandbox world → allocator → SIWE → key → streamed completion → usage → settlement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { createApp } from "../src/app.js";
import { runAllocator } from "../src/workers/allocator.js";
import { runSettlement } from "../src/workers/settlement.js";
import { setSettlementHalted } from "../src/context.js";
import { processProof, contractGrantLeaf } from "../src/core/merkle.js";
import { testCtx } from "./helpers.js";

test("sandbox end-to-end through the HTTP app", async () => {
  const t = testCtx();
  const { ctx, clock, world, setNow } = t;
  await world.seedHistory(ctx, ctx.now(), 3);
  const app = createApp(ctx);
  const origin = "http://localhost:3000";

  // sign in
  const account = privateKeyToAccount(generatePrivateKey());
  const n = await (await app.request("/api/auth/nonce")).json() as { nonce: string; domain: string };
  const message = createSiweMessage({ address: account.address, chainId: 46630, domain: n.domain, nonce: n.nonce, uri: origin, version: "1", issuedAt: new Date(ctx.now() * 1000) });
  const signature = await account.signMessage({ message });
  const v = await app.request("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ message, signature }) });
  assert.equal(v.status, 200, await v.clone().text());
  const cookie = v.headers.get("set-cookie")!.split(";")[0];
  assert.match(v.headers.get("set-cookie")!, /HttpOnly/i);
  assert.equal(v.headers.get("access-control-allow-credentials"), "true");

  const me = await (await app.request("/api/me", { headers: { cookie } })).json() as { tier: string; credit: string; pools: unknown[] };
  assert.equal(me.tier, "reef");
  assert.equal(me.credit, "2.000000");

  // key
  const k = await app.request("/api/keys", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ label: "e2e" }) });
  assert.equal(k.status, 201);
  const { key } = await k.json() as { key: string };
  assert.match(key, /^sk-ebb-/);
  const bad = await app.request("/api/keys", { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
  assert.equal(bad.status, 403);

  // stream
  const auth = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  const res = await app.request("/v1/chat/completions", {
    method: "POST", headers: auth,
    body: JSON.stringify({ model: "ebb-mock", stream: true, messages: [{ role: "user", content: "Say something about tides." }] }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-ebb-balance"), "2.000000");
  assert.match(res.headers.get("x-ebb-request-id")!, /^req_/);
  const text = await res.text();
  assert.match(text, /"delta":\{"content":/);
  assert.match(text, /data: \[DONE\]\n\n$/);
  const ebbChunk = text.split("\n").filter((l) => l.includes('"ebb"')).map((l) => JSON.parse(l.slice(6)))[0];
  assert.ok(ebbChunk, "final chunk carries the real cost");
  const cost = Number(ebbChunk.ebb.cost);
  assert.ok(cost > 0);

  const keyInfo = await (await app.request("/v1/key", { headers: auth })).json() as { balance: string; key: { spent: string } };
  assert.equal(Number(keyInfo.balance).toFixed(6), (2 - cost).toFixed(6));
  assert.equal(keyInfo.key.spent, ebbChunk.ebb.cost);

  // non-streaming
  const ns = await app.request("/v1/chat/completions", { method: "POST", headers: auth, body: JSON.stringify({ model: "ebb-mock", messages: [{ role: "user", content: "hi" }], max_tokens: 8 }) });
  assert.equal(ns.status, 200);
  assert.ok(Number(ns.headers.get("x-ebb-cost")) > 0);

  const usage = await (await app.request("/v1/usage", { headers: auth })).json() as { data: { status: string; cost: string; pools: unknown[] }[] };
  assert.equal(usage.data.length, 2);
  assert.ok(usage.data.every((u) => u.status === "ok" && u.pools.length >= 1));

  // errors
  assert.equal((await app.request("/v1/chat/completions", { method: "POST", headers: { ...auth, authorization: "Bearer sk-ebb-nope" }, body: "{}" })).status, 401);
  assert.equal((await app.request("/v1/chat/completions", { method: "POST", headers: auth, body: JSON.stringify({ model: "nope", messages: [{ role: "user", content: "x" }] }) })).status, 404);
  const capped = await (await app.request("/api/keys", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ label: "tiny", spend_cap: "0.000010" }) })).json() as { key: string };
  const capRes = await app.request("/v1/chat/completions", { method: "POST", headers: { ...auth, authorization: `Bearer ${capped.key}` }, body: JSON.stringify({ model: "ebb-mock", messages: [{ role: "user", content: "x" }], max_tokens: 64 }) });
  assert.equal(capRes.status, 402);
  assert.equal(((await capRes.json()) as { error: { type: string } }).error.type, "spend_cap_exceeded");
  const addr = account.address.toLowerCase();
  const saved = ctx.db.all<{ epoch: number; remaining_micro: number }>("SELECT epoch, remaining_micro FROM grants WHERE addr = ?", addr);
  ctx.db.run("UPDATE grants SET remaining_micro = 0 WHERE addr = ?", addr);
  const broke = await app.request("/v1/chat/completions", { method: "POST", headers: auth, body: JSON.stringify({ model: "ebb-mock", messages: [{ role: "user", content: "x" }] }) });
  assert.equal(broke.status, 402);
  assert.equal(((await broke.json()) as { error: { type: string } }).error.type, "insufficient_credit");
  for (const r of saved) ctx.db.run("UPDATE grants SET remaining_micro = ? WHERE addr = ? AND epoch = ?", r.remaining_micro, addr, r.epoch);
  setSettlementHalted(ctx, "test");
  assert.equal((await app.request("/v1/chat/completions", { method: "POST", headers: auth, body: JSON.stringify({ model: "ebb-mock", messages: [{ role: "user", content: "x" }] }) })).status, 503);
  setSettlementHalted(ctx, null);

  // the signed-in wallet floods at the next tide (Reef balance backdated to tide start)
  const cur = clock.epochAt(ctx.now());
  setNow(clock.end(cur) + 61);
  world.catchUpInflow(cur, ctx.now());
  await runAllocator(ctx);
  const g = await app.request(`/api/grants/${account.address}/${cur}`);
  assert.equal(g.status, 200);
  const grant = await g.json() as { amount_micro: string; proof: `0x${string}`[]; root: string };
  assert.equal(processProof(contractGrantLeaf(BigInt(cur), account.address, BigInt(grant.amount_micro)), grant.proof), grant.root);

  // settlement withdraws spent credit
  const s = await runSettlement(ctx, ctx.now());
  assert.ok(s.settled >= 1);
  const sound = await (await app.request("/api/soundings")).json() as { difference: string };
  assert.equal(sound.difference, "0.000000");

  // public endpoints
  for (const p of ["/v1/models", "/api/stats", "/api/logbook", "/api/holders?limit=5", "/api/health", `/api/tides/${cur}`, `/api/receipts/${cur}.svg`]) {
    const r = await app.request(p);
    assert.equal(r.status, 200, p);
  }
  const csv = await (await app.request("/api/logbook?format=csv")).text();
  assert.match(csv.split("\n")[0], /^tide,starts_at,status,/);
});
