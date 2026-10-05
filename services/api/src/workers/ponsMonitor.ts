// Pons monitor (mainnet, every MONITOR_INTERVAL_MS): scans the pons factory for creator-fee-recipient events about
// our token and cross-checks the factory record, then raises alerts (ERROR log + /api/health + /api/soundings).
import type { Ctx } from "../context.js";
import type { PonsChain } from "../chain/pons.js";
import { activeAlerts, applyFeeRecipientEvents, applyRecipientCheck, loadAlerts, saveAlerts, type FeeAlert } from "../core/feeAlerts.js";
import { errMsg, logger } from "../log.js";

const log = logger("pons-monitor");
export const MONITOR_CURSOR = "pons_monitor_block";
const REMIND_S = 1_800;
const lastLogged = new Map<string, number>();

function shout(a: FeeAlert, now: number, first: boolean) {
  lastLogged.set(a.id, now);
  log.error(`${first ? "ALERT" : "ALERT (still active)"}: ${a.message}`, { kind: a.kind, tx: a.tx, block: a.block });
}

export async function runPonsMonitor(ctx: Ctx, pons: PonsChain, now = ctx.now()): Promise<void> {
  const vault = pons.addresses.vault;
  const token = pons.addresses.token;
  let alerts = loadAlerts(ctx.db);
  const raised: FeeAlert[] = [];

  // 1) factory logs since the cursor (needs an RPC that serves eth_getLogs back to DEPLOY_BLOCK: the official
  //    RPC does; publicnode refuses "archive" ranges older than ~1 day)
  let scanError: unknown = null;
  if (pons.addresses.factory) try {
    const head = await pons.pub.getBlockNumber();
    const safe = head - BigInt(ctx.cfg.indexerLagBlocks);
    const cur = ctx.db.getCursor(MONITOR_CURSOR);
    let from = cur !== undefined ? BigInt(cur) : ctx.cfg.deployBlock ?? (safe > 50_000n ? safe - 50_000n : 0n);
    const batch = BigInt(ctx.cfg.monitorBatchBlocks);
    for (let i = 0; from <= safe && i < 20; i++) {
      const to = from + batch - 1n < safe ? from + batch - 1n : safe;
      const events = await pons.feeRecipientEvents(from, to);
      if (events.length) {
        const r = applyFeeRecipientEvents(alerts, events, token, vault, now);
        alerts = r.alerts;
        raised.push(...r.raised);
        log.info(`fee-recipient events ${from}..${to}`, { events: events.map((e) => e.type) });
      }
      ctx.db.setCursor(MONITOR_CURSOR, (to + 1n).toString());
      from = to + 1n;
    }
  } catch (e) {
    scanError = e;
  }

  // 2) the factory's current record (catches anything the scan missed, e.g. a cursor started too late)
  try {
    const s = await pons.state(0);
    if (s?.creator_fee_recipient && !s.error) {
      const r = applyRecipientCheck(alerts, token, s.creator_fee_recipient, vault, now);
      alerts = r.alerts;
      raised.push(...r.raised);
    }
  } catch (e) {
    log.warn("factory record check failed", { error: errMsg(e) });
  }

  saveAlerts(ctx.db, alerts);
  for (const a of raised) shout(a, now, true);
  for (const a of activeAlerts(alerts, now)) {
    if (now - (lastLogged.get(a.id) ?? 0) >= REMIND_S) shout(a, now, false);
  }
  if (scanError) throw new Error(`fee-recipient log scan failed (cursor kept, retried next run): ${errMsg(scanError)}`);
}
