// Schema (SPEC.md §5.2) + a few additive tables/columns, versioned by PRAGMA user_version.
// Times are unix seconds. Micro-dollars are INTEGER (fit in int64). 18-dp token amounts are TEXT.
import type { DatabaseSync } from "node:sqlite";

const migrations: string[] = [
  /* 1: SPEC §5.2 */ `
  CREATE TABLE transfers (
    block INTEGER NOT NULL, log_index INTEGER NOT NULL, ts INTEGER NOT NULL,
    from_addr TEXT NOT NULL, to_addr TEXT NOT NULL, amount TEXT NOT NULL, tx TEXT,
    PRIMARY KEY (block, log_index)
  );
  CREATE TABLE balance_points (
    addr TEXT NOT NULL, block INTEGER NOT NULL, ts INTEGER NOT NULL, balance TEXT NOT NULL,
    PRIMARY KEY (addr, block)
  );
  CREATE INDEX balance_points_ts ON balance_points(ts);

  CREATE TABLE epochs (
    n INTEGER PRIMARY KEY, starts_at INTEGER NOT NULL,
    booked_micro INTEGER NOT NULL DEFAULT 0, granted_micro INTEGER NOT NULL DEFAULT 0,
    wallets INTEGER NOT NULL DEFAULT 0,
    root TEXT, committed_tx TEXT,
    withdrawn_micro INTEGER NOT NULL DEFAULT 0, burned_micro INTEGER NOT NULL DEFAULT 0,
    ebb_burned TEXT NOT NULL DEFAULT '0', burn_tx TEXT,
    status TEXT NOT NULL DEFAULT 'open'   -- open | committing | committed | expired | burned
  );
  CREATE INDEX epochs_status ON epochs(status);

  CREATE TABLE grants (
    epoch INTEGER NOT NULL, addr TEXT NOT NULL,
    amount_micro INTEGER NOT NULL, remaining_micro INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    PRIMARY KEY (epoch, addr)
  );
  CREATE INDEX grants_addr ON grants(addr, epoch);

  CREATE TABLE keys (
    id TEXT PRIMARY KEY, addr TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '', parent_id TEXT, spend_cap_micro INTEGER,
    spent_micro INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, revoked_at INTEGER
  );
  CREATE INDEX keys_addr ON keys(addr);

  CREATE TABLE siwe_nonces (nonce TEXT PRIMARY KEY, created_at INTEGER NOT NULL, used_at INTEGER);

  CREATE TABLE requests (
    id TEXT PRIMARY KEY, key_id TEXT, addr TEXT NOT NULL, model TEXT NOT NULL,
    in_tokens INTEGER NOT NULL DEFAULT 0, out_tokens INTEGER NOT NULL DEFAULT 0,
    cost_micro INTEGER NOT NULL DEFAULT 0, reserved_micro INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,                 -- pending | ok | error
    error TEXT, created_at INTEGER NOT NULL, finished_at INTEGER, settled_epoch INTEGER
  );
  CREATE INDEX requests_addr ON requests(addr, created_at);
  CREATE INDEX requests_key ON requests(key_id, created_at);
  CREATE INDEX requests_status ON requests(status, created_at);

  CREATE TABLE debits (
    request_id TEXT NOT NULL, epoch INTEGER NOT NULL, amount_micro INTEGER NOT NULL,
    settlement_id TEXT,
    PRIMARY KEY (request_id, epoch)
  );
  CREATE INDEX debits_epoch ON debits(epoch, settlement_id);

  CREATE TABLE settlements (
    id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, amount_micro INTEGER NOT NULL,
    usage_root TEXT NOT NULL, tx TEXT, leaves INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );

  CREATE TABLE cursor (name TEXT PRIMARY KEY, value TEXT NOT NULL);

  -- additive: grant Merkle tree dumps (StandardMerkleTree.dump()) so proofs can be served
  CREATE TABLE trees (epoch INTEGER PRIMARY KEY, dump TEXT NOT NULL);

  -- additive: raw vault events (indexed in chain mode, simulated in sandbox)
  CREATE TABLE harvests (
    tx TEXT NOT NULL, log_index INTEGER NOT NULL, epoch INTEGER NOT NULL, block INTEGER, ts INTEGER NOT NULL,
    eth_in TEXT NOT NULL, usdg_out INTEGER NOT NULL, to_pool INTEGER NOT NULL, to_treasury INTEGER NOT NULL,
    PRIMARY KEY (tx, log_index)
  );
  CREATE TABLE burns (
    tx TEXT NOT NULL, log_index INTEGER NOT NULL, epoch INTEGER NOT NULL, block INTEGER, ts INTEGER NOT NULL,
    usdg_in INTEGER NOT NULL, ebb_burned TEXT NOT NULL, caller TEXT NOT NULL, tip_micro INTEGER NOT NULL,
    PRIMARY KEY (tx, log_index)
  );
  CREATE INDEX burns_epoch ON burns(epoch);
  `,
];

export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let v = Number(row.user_version);
  while (v < migrations.length) {
    db.exec("BEGIN");
    try {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    v++;
  }
}
