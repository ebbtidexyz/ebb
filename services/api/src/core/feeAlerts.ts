// Creator-fee-recipient alerts (Pons v2). pons' owner can propose redirecting $EBB's creator fees away from the
// vault (CreatorFeeRecipientChangeProposed, executable by anyone 3–6 days later). We cannot block it, so we make
// it loud: ERROR log, /api/health `alerts`, /api/soundings `fee_recipient_alert`.
// State is a JSON list in the cursor table so it survives restarts; the logic here is pure.
import type { Db } from "../db/index.js";
import { iso } from "../money.js";

export type FeeAlertKind =
  | "creator_fee_recipient_change_proposed" // takeover proposed; executable from executable_at until expires_at
  | "creator_fee_recipient_changed" // CreatorFeeRecipientUpdated to something other than the vault
  | "creator_fee_recipient_mismatch"; // factory record does not name the vault (on-chain read)

export type FeeAlertStatus = "active" | "cancelled" | "executed" | "resolved";

export interface FeeAlert {
  id: string;
  kind: FeeAlertKind;
  severity: "critical";
  status: FeeAlertStatus;
  token: string;
  current_recipient: string | null;
  new_recipient: string | null;
  executable_at: number | null;
  expires_at: number | null;
  tx: string | null;
  block: number | null;
  detected_at: number;
  message: string;
}

export type FeeRecipientEvent =
  | { type: "proposed"; token: string; current: string; next: string; executableAt: number; expiresAt: number; tx: string; block: number; logIndex: number }
  | { type: "updated"; token: string; old: string; next: string; tx: string; block: number; logIndex: number }
  | { type: "cancelled"; token: string; tx: string; block: number; logIndex: number };

const lc = (a: string) => a.toLowerCase();
const CURSOR = "pons_fee_alerts";

export function loadAlerts(db: Db): FeeAlert[] {
  const raw = db.getCursor(CURSOR);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as FeeAlert[]) : [];
  } catch {
    return [];
  }
}

export function saveAlerts(db: Db, alerts: FeeAlert[]): void {
  db.setCursor(CURSOR, JSON.stringify(alerts));
}

/** fold factory events (ordered by block/logIndex) concerning `token` into the alert list */
export function applyFeeRecipientEvents(
  prev: readonly FeeAlert[], events: readonly FeeRecipientEvent[], token: string, vault: string, now: number,
): { alerts: FeeAlert[]; raised: FeeAlert[] } {
  const alerts = prev.map((a) => ({ ...a }));
  const raised: FeeAlert[] = [];
  const has = (id: string) => alerts.some((a) => a.id === id);
  for (const ev of events) {
    if (lc(ev.token) !== lc(token)) continue;
    const id = `${ev.tx}:${ev.logIndex}`;
    if (has(id)) continue; // idempotent re-scan
    if (ev.type === "proposed") {
      if (lc(ev.next) === lc(vault)) continue; // proposing the vault itself is harmless
      const a: FeeAlert = {
        id, kind: "creator_fee_recipient_change_proposed", severity: "critical", status: "active", token: lc(token),
        current_recipient: lc(ev.current), new_recipient: lc(ev.next), executable_at: ev.executableAt, expires_at: ev.expiresAt,
        tx: ev.tx, block: ev.block, detected_at: now,
        message: `pons proposed redirecting $EBB creator fees from ${lc(ev.current)} to ${lc(ev.next)}; anyone can execute it between ${iso(ev.executableAt)} and ${iso(ev.expiresAt)}. Fees then stop reaching the vault.`,
      };
      alerts.push(a);
      raised.push(a);
    } else if (ev.type === "updated") {
      const toVault = lc(ev.next) === lc(vault);
      for (const a of alerts) {
        if (a.status !== "active") continue;
        if (a.kind === "creator_fee_recipient_change_proposed" && a.new_recipient === lc(ev.next)) a.status = "executed";
        else if (toVault && (a.kind === "creator_fee_recipient_changed" || a.kind === "creator_fee_recipient_mismatch")) a.status = "resolved";
      }
      if (!toVault) {
        const a: FeeAlert = {
          id, kind: "creator_fee_recipient_changed", severity: "critical", status: "active", token: lc(token),
          current_recipient: lc(ev.old), new_recipient: lc(ev.next), executable_at: null, expires_at: null,
          tx: ev.tx, block: ev.block, detected_at: now,
          message: `$EBB creator fee recipient changed from ${lc(ev.old)} to ${lc(ev.next)}: new creator fees no longer reach the vault.`,
        };
        alerts.push(a);
        raised.push(a);
      }
    } else {
      for (const a of alerts) if (a.status === "active" && a.kind === "creator_fee_recipient_change_proposed") a.status = "cancelled";
    }
  }
  return { alerts, raised };
}

/** compare the factory's current record with the vault (catches anything the log scan missed) */
export function applyRecipientCheck(
  prev: readonly FeeAlert[], token: string, recipient: string, vault: string, now: number,
): { alerts: FeeAlert[]; raised: FeeAlert[] } {
  const alerts = prev.map((a) => ({ ...a }));
  const open = alerts.find((a) => a.kind === "creator_fee_recipient_mismatch" && a.status === "active");
  if (lc(recipient) === lc(vault)) {
    if (open) open.status = "resolved";
    return { alerts, raised: [] };
  }
  if (open && open.new_recipient === lc(recipient)) return { alerts, raised: [] };
  if (open) open.status = "resolved"; // recipient moved again: replace
  const a: FeeAlert = {
    id: `mismatch:${lc(recipient)}:${now}`, kind: "creator_fee_recipient_mismatch", severity: "critical", status: "active",
    token: lc(token), current_recipient: lc(vault), new_recipient: lc(recipient), executable_at: null, expires_at: null,
    tx: null, block: null, detected_at: now,
    message: `pons factory record names ${lc(recipient)} as $EBB creator fee recipient, not the vault ${lc(vault)}.`,
  };
  alerts.push(a);
  return { alerts, raised: [a] };
}

/** alerts that still need attention at `now` (a proposal past its expiry can no longer be executed) */
export function activeAlerts(alerts: readonly FeeAlert[], now: number): FeeAlert[] {
  return alerts.filter((a) => a.status === "active" && (a.expires_at === null || now < a.expires_at));
}

/** JSON shape for the HTTP API */
export function alertView(a: FeeAlert) {
  return {
    id: a.id,
    kind: a.kind,
    severity: a.severity,
    token: a.token,
    current_recipient: a.current_recipient,
    new_recipient: a.new_recipient,
    executable_at: a.executable_at !== null ? iso(a.executable_at) : null,
    expires_at: a.expires_at !== null ? iso(a.expires_at) : null,
    tx: a.tx,
    block: a.block,
    detected_at: iso(a.detected_at),
    message: a.message,
  };
}

export function activeAlertViews(db: Db, now: number) {
  return activeAlerts(loadAlerts(db), now).map(alertView);
}
