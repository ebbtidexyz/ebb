// node:sqlite wrapper: cached statements, bigint reads on demand, nested transactions via savepoints.
import { DatabaseSync, type StatementSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrations.js";

export type Param = SQLInputValue;
export type Row = Record<string, unknown>;

export class Db {
  readonly raw: DatabaseSync;
  private cache = new Map<string, StatementSync>();
  private bigCache = new Map<string, StatementSync>();
  private depth = 0;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF;");
    migrate(this.raw);
  }

  private stmt(sql: string, big: boolean): StatementSync {
    const cache = big ? this.bigCache : this.cache;
    let s = cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      if (big) s.setReadBigInts(true);
      cache.set(sql, s);
    }
    return s;
  }

  /** first row, INTEGER columns as JS numbers */
  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.stmt(sql, false).get(...params) as T | undefined;
  }
  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql, false).all(...params) as T[];
  }
  /** first row, INTEGER columns as bigint (use for money) */
  getBig<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.stmt(sql, true).get(...params) as T | undefined;
  }
  allBig<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql, true).all(...params) as T[];
  }
  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number | bigint } {
    const r = this.stmt(sql, false).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  /** Synchronous transaction. Nested calls become savepoints. Throwing rolls back. */
  tx<T>(fn: () => T): T {
    const sp = `sp${this.depth}`;
    this.raw.exec(this.depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const out = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${sp}`);
      return out;
    } catch (e) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw e;
    }
  }

  // cursor table: small key/value store for worker state
  getCursor(name: string): string | undefined {
    return this.get<{ value: string }>("SELECT value FROM cursor WHERE name = ?", name)?.value;
  }
  setCursor(name: string, value: string | number | bigint): void {
    this.run("INSERT INTO cursor(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", name, String(value));
  }

  close() {
    this.raw.close();
  }
}

export function openDb(path: string): Db {
  return new Db(path);
}
