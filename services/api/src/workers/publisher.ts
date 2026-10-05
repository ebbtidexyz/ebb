// Publisher (SPEC.md §5.3): receipts are queries over epochs/grants/requests/settlements.
// The periodic tick only moves tides whose 7 days are up to status 'expired'.
import { EXPIRY_SECONDS, tierFor, type SoundingsResponse, type StatsResponse, type TideEntry } from "@ebb/shared";
import type { Ctx } from "../context.js";
import { isSandbox } from "../context.js";
import { formatToken, iso, microToDecimal } from "../money.js";

export function runPublisher(ctx: Ctx, now = ctx.now()): void {
  ctx.db.run(
    "UPDATE epochs SET status = 'expired' WHERE status IN ('committed', 'open') AND starts_at + ? <= ?",
    EXPIRY_SECONDS, now,
  );
}

interface EpochRow {
  n: bigint; starts_at: bigint; booked_micro: bigint; granted_micro: bigint; wallets: bigint; root: string | null;
  committed_tx: string | null; withdrawn_micro: bigint; burned_micro: bigint; ebb_burned: string; burn_tx: string | null; status: string;
}

function tideStatus(ctx: Ctx, e: EpochRow, now: number): TideEntry["status"] {
  if (e.status === "burned") return "burned";
  if (e.status === "expired" || Number(e.starts_at) + EXPIRY_SECONDS <= now) return "expired";
  if (e.status === "committed") return "committed";
  return "open"; // open | committing
}

function toEntry(ctx: Ctx, e: EpochRow, now: number): TideEntry {
  const n = Number(e.n);
  const used = ctx.db.getBig<{ v: bigint | null }>(
    "SELECT SUM(d.amount_micro) AS v FROM debits d JOIN requests r ON r.id = d.request_id WHERE d.epoch = ? AND r.status = 'ok'", n,
  )!.v ?? 0n;
  const status = tideStatus(ctx, e, now);
  const open = status === "committed"
    ? ctx.db.getBig<{ v: bigint | null }>("SELECT SUM(remaining_micro) AS v FROM grants WHERE epoch = ?", n)!.v ?? 0n
    : 0n;
  const burns = ctx.db.allBig<{ tx: string; usdg_in: bigint; ebb_burned: string; caller: string; tip_micro: bigint }>(
    "SELECT tx, usdg_in, ebb_burned, caller, tip_micro FROM burns WHERE epoch = ? ORDER BY ts, log_index", n,
  );
  let burn: TideEntry["burn"] = null;
  if (burns.length) {
    const last = burns[burns.length - 1];
    burn = {
      usdg_in: microToDecimal(burns.reduce((s, b) => s + b.usdg_in, 0n)),
      ebb_burned: formatToken(burns.reduce((s, b) => s + BigInt(b.ebb_burned), 0n)),
      tx: last.tx,
      caller: last.caller,
      tip: microToDecimal(burns.reduce((s, b) => s + b.tip_micro, 0n)),
    };
  }
  return {
    tide: n,
    starts_at: iso(Number(e.starts_at)),
    status,
    booked: microToDecimal(e.booked_micro),
    granted: microToDecimal(e.granted_micro),
    wallets: Number(e.wallets),
    used: microToDecimal(used),
    withdrawn: microToDecimal(e.withdrawn_micro),
    open: microToDecimal(open),
    grant_root: e.root,
    commit_tx: e.committed_tx,
    burn,
  };
}

export function tideEntry(ctx: Ctx, n: number, now = ctx.now()): TideEntry | null {
  const e = ctx.db.getBig<EpochRow>("SELECT * FROM epochs WHERE n = ?", n);
  if (e) return toEntry(ctx, e, now);
  // the running tide has no row until something flows in: show it as open and empty
  if (n === ctx.clock.epochAt(now)) {
    return {
      tide: n, starts_at: iso(ctx.clock.start(n)), status: "open", booked: "0.000000", granted: "0.000000", wallets: 0,
      used: "0.000000", withdrawn: "0.000000", open: "0.000000", grant_root: null, commit_tx: null, burn: null,
    };
  }
  return null;
}

export function logbook(ctx: Ctx, from: number | null, limit: number, now = ctx.now()): { entries: TideEntry[]; next_from: number | null } {
  const rows = ctx.db.allBig<EpochRow>(
    "SELECT * FROM epochs WHERE n <= ? ORDER BY n DESC LIMIT ?",
    from ?? Number.MAX_SAFE_INTEGER, limit + 1,
  );
  const page = rows.slice(0, limit);
  return {
    entries: page.map((e) => toEntry(ctx, e, now)),
    next_from: rows.length > limit ? Number(rows[limit].n) : null,
  };
}

const CSV_COLS = ["tide", "starts_at", "status", "booked", "granted", "wallets", "used", "withdrawn", "open", "grant_root", "commit_tx", "burn_usdg_in", "burn_ebb", "burn_tip", "burn_tx"] as const;
export function logbookCsv(entries: TideEntry[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLS.join(",")];
  for (const e of entries) {
    lines.push([
      e.tide, e.starts_at, e.status, e.booked, e.granted, e.wallets, e.used, e.withdrawn, e.open, e.grant_root, e.commit_tx,
      e.burn?.usdg_in, e.burn?.ebb_burned, e.burn?.tip, e.burn?.tx,
    ].map(esc).join(","));
  }
  return lines.join("\n") + "\n";
}

export function stats(ctx: Ctx, now = ctx.now()): StatsResponse {
  const { db, clock } = ctx;
  const raw = clock.epochAt(now);
  const cur = Math.max(0, raw); // before genesis: tide 0 is the next one, starting at genesis
  const since = now - 86_400;
  const window = (fromTs: number) => {
    const granted = db.getBig<{ v: bigint | null }>("SELECT SUM(granted_micro) AS v FROM epochs WHERE starts_at >= ?", fromTs)!.v ?? 0n;
    const used = db.getBig<{ v: bigint | null; n: bigint }>("SELECT SUM(cost_micro) AS v, COUNT(*) AS n FROM requests WHERE status = 'ok' AND created_at >= ?", fromTs)!;
    const expired = db.getBig<{ v: bigint | null }>("SELECT SUM(usdg_in) AS v FROM burns WHERE ts >= ?", fromTs)!.v ?? 0n;
    const wallets = db.get<{ n: number }>("SELECT COUNT(DISTINCT g.addr) AS n FROM grants g JOIN epochs e ON e.n = g.epoch WHERE e.starts_at >= ?", fromTs)!.n;
    return { granted: microToDecimal(granted), used: microToDecimal(used.v ?? 0n), expired: microToDecimal(expired), requests: Number(used.n), wallets };
  };
  const all = window(-1);
  const tides = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM epochs WHERE status != 'open'")!.n;
  const burns = db.allBig<{ ebb_burned: string; usdg_in: bigint }>("SELECT ebb_burned, usdg_in FROM burns");
  return {
    sandbox: isSandbox(ctx),
    tide: { current: cur, starts_at: iso(clock.start(cur)), next_at: iso(raw < 0 ? clock.start(0) : clock.end(cur)) },
    last_24h: window(since),
    all_time: {
      ...all,
      tides,
      burned_ebb: formatToken(burns.reduce((s, b) => s + BigInt(b.ebb_burned), 0n)),
      burned_usdg: microToDecimal(burns.reduce((s, b) => s + b.usdg_in, 0n)),
      burns: burns.length,
    },
    block: ctx.basin.headBlock(),
  };
}

/** Soundings: vault depth vs. what the logbook says should be there. */
export async function soundings(ctx: Ctx, now = ctx.now()): Promise<SoundingsResponse & {
  expected: string; ungranted: string; awaiting_burn: string; equation: string;
}> {
  const { db, clock } = ctx;
  const epochs = db.allBig<{ n: bigint; booked_micro: bigint; granted_micro: bigint; withdrawn_micro: bigint; burned_micro: bigint }>(
    "SELECT n, booked_micro, granted_micro, withdrawn_micro, burned_micro FROM epochs WHERE status != 'burned'",
  );
  const openBy = new Map<number, bigint>();
  for (const r of db.allBig<{ epoch: bigint; v: bigint }>(
    `SELECT g.epoch, SUM(g.remaining_micro) AS v FROM grants g JOIN epochs e ON e.n = g.epoch
      WHERE e.status = 'committed' AND g.expires_at > ? GROUP BY g.epoch`, now,
  )) openBy.set(Number(r.epoch), r.v);
  const unsettledBy = new Map<number, bigint>();
  for (const r of db.allBig<{ epoch: bigint; v: bigint }>(
    "SELECT d.epoch, SUM(d.amount_micro) AS v FROM debits d WHERE d.settlement_id IS NULL GROUP BY d.epoch",
  )) unsettledBy.set(Number(r.epoch), r.v);

  let expected = 0n, open = 0n, unsettled = 0n, ungranted = 0n, awaiting = 0n;
  for (const e of epochs) {
    const n = Number(e.n);
    const rem = e.booked_micro - e.withdrawn_micro - e.burned_micro;
    expected += rem;
    if (clock.isExpired(n, now)) {
      awaiting += rem;
      continue;
    }
    const o = openBy.get(n) ?? 0n;
    const u = unsettledBy.get(n) ?? 0n;
    open += o;
    unsettled += u;
    ungranted += rem - o - u;
  }
  const v = await ctx.basin.vaultUsdg().catch(() => null);
  const a = ctx.basin.addresses;
  return {
    sandbox: isSandbox(ctx),
    vault_usdg: v ? microToDecimal(v.value) : null,
    open_credits: microToDecimal(open),
    unsettled_used: microToDecimal(unsettled),
    difference: v ? microToDecimal(v.value - expected) : null,
    block: v?.block ?? ctx.basin.headBlock(),
    addresses: { vault: a.vault, token: a.token, usdg: a.usdg, treasury: a.treasury, settlement: a.settlement },
    expected: microToDecimal(expected),
    ungranted: microToDecimal(ungranted),
    awaiting_burn: microToDecimal(awaiting),
    equation: "vault_usdg = open_credits + unsettled_used + ungranted + awaiting_burn + difference",
  };
}

export function holders(ctx: Ctx, limit: number) {
  const rows = ctx.db.all<{ addr: string; balance: string }>(
    `SELECT bp.addr, bp.balance FROM balance_points bp
       JOIN (SELECT addr, MAX(block) AS b FROM balance_points GROUP BY addr) l ON l.addr = bp.addr AND l.b = bp.block`,
  );
  const list = rows
    .filter((r) => !ctx.excluded.has(r.addr))
    .map((r) => ({ addr: r.addr, balance: BigInt(r.balance) }))
    .filter((r) => r.balance > 0n)
    .sort((a, b) => (a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1));
  return {
    sandbox: isSandbox(ctx),
    total: list.length,
    holders: list.slice(0, limit).map((h, i) => {
      const t = tierFor(h.balance);
      return { rank: i + 1, addr: h.addr, balance: formatToken(h.balance), tier: t.id, tier_label: t.label };
    }),
  };
}

// ---- receipt card ---------------------------------------------------------------------------

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
const short = (h: string | null) => (h ? `${h.slice(0, 10)}…${h.slice(-8)}` : "—");

export function receiptSvg(t: TideEntry, sandbox: boolean): string {
  const navy = "#07131F", deep = "#0C2033", line = "#1F4562", foam = "#E9E4D6", mist = "#9FB3C2", brass = "#C9A24A", kelp = "#4FA38A", coral = "#E0694A";
  const rows: [string, string, string][] = [
    ["Booked (inflow)", `$${t.booked}`, foam],
    ["Granted", `$${t.granted}`, kelp],
    ["Wallets", String(t.wallets), foam],
    ["Spent on AI", `$${t.used}`, foam],
    ["Still in pools", `$${t.open}`, foam],
    ["Drawn into the Trench", t.burn ? `$${t.burn.usdg_in} → ${t.burn.ebb_burned} EBB` : "—", t.burn ? coral : mist],
  ];
  const date = t.starts_at.replace("T", " ").slice(0, 16) + " UTC";
  const contours = [0, 1, 2, 3, 4].map((i) => `<path d="M0 ${250 + i * 18} C 160 ${226 + i * 18}, 320 ${282 + i * 18}, 640 ${244 + i * 18}" fill="none" stroke="${line}" stroke-width="1" opacity="${0.6 - i * 0.1}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${xml(`Ebb logbook, tide ${t.tide}: granted $${t.granted} to ${t.wallets} wallets`)}">
  <rect width="640" height="360" fill="${navy}"/>
  ${contours}
  <rect x="16" y="16" width="608" height="328" fill="none" stroke="${brass}" stroke-width="1" opacity="0.7"/>
  <rect x="22" y="22" width="596" height="316" fill="none" stroke="${line}" stroke-width="1"/>
  <g font-family="Fraunces, Georgia, 'Times New Roman', serif" fill="${foam}">
    <text x="44" y="66" font-size="14" letter-spacing="3" fill="${brass}">EBB · THE LOGBOOK${sandbox ? " · SANDBOX" : ""}</text>
    <text x="44" y="110" font-size="40">Tide #${t.tide}</text>
    <text x="596" y="66" font-size="13" text-anchor="end" fill="${mist}" font-family="'JetBrains Mono', ui-monospace, monospace">${xml(date)}</text>
    <text x="596" y="110" font-size="15" text-anchor="end" fill="${t.status === "burned" ? coral : t.status === "committed" ? kelp : brass}" letter-spacing="2">${t.status.toUpperCase()}</text>
  </g>
  <line x1="44" y1="128" x2="596" y2="128" stroke="${brass}" stroke-width="1" opacity="0.6"/>
  <g font-family="'JetBrains Mono', ui-monospace, monospace" font-size="14">
    ${rows.map(([k, v, c], i) => `<text x="44" y="${158 + i * 25}" fill="${mist}">${xml(k)}</text><text x="596" y="${158 + i * 25}" fill="${c}" text-anchor="end">${xml(v)}</text>`).join("\n    ")}
  </g>
  <rect x="44" y="304" width="552" height="22" fill="${deep}"/>
  <text x="52" y="319" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="11" fill="${mist}">root ${xml(short(t.grant_root))}   commit ${xml(short(t.commit_tx))}</text>
</svg>`;
}
