// Timers for the in-process workers. A job never overlaps itself; status is exposed on /api/health.
import { EPOCH_SECONDS } from "@ebb/shared";
import type { Ctx, WorkerStatus } from "../context.js";
import { errMsg, logger } from "../log.js";

const log = logger("scheduler");

export class Scheduler {
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();
  private stopped = false;
  constructor(private ctx: Ctx) {}

  private status(name: string): WorkerStatus {
    let s = this.ctx.workers.get(name);
    if (!s) this.ctx.workers.set(name, (s = { last_run: null, last_ok: null, last_error: null, runs: 0 }));
    return s;
  }

  async run(name: string, fn: () => Promise<unknown>): Promise<void> {
    if (this.running.has(name) || this.stopped) return;
    this.running.add(name);
    const s = this.status(name);
    s.last_run = Math.floor(Date.now() / 1000);
    s.runs++;
    try {
      await fn();
      s.last_ok = s.last_run;
      s.last_error = null;
    } catch (e) {
      s.last_error = errMsg(e);
      log.error(`${name} failed`, { error: s.last_error });
    } finally {
      this.running.delete(name);
    }
  }

  /** run now (after `initialDelayMs`) and then every `ms` */
  every(name: string, ms: number, fn: () => Promise<unknown>, initialDelayMs = 0): void {
    this.status(name);
    const t0 = setTimeout(() => {
      void this.run(name, fn);
      const t = setInterval(() => void this.run(name, fn), ms);
      t.unref?.();
      this.timers.push(t);
    }, initialDelayMs);
    this.timers.push(t0);
  }

  /** run at every tide boundary (:00/:30 UTC) + offsetS, aligned to `genesis` */
  atTide(name: string, genesis: number, offsetS: number, fn: () => Promise<unknown>): void {
    this.status(name);
    const schedule = () => {
      if (this.stopped) return;
      const now = Date.now() / 1000;
      const sinceGenesis = now - genesis - offsetS;
      const next = genesis + offsetS + (Math.floor(sinceGenesis / EPOCH_SECONDS) + 1) * EPOCH_SECONDS;
      const t = setTimeout(async () => {
        await this.run(name, fn);
        schedule();
      }, Math.max(0, (next - now) * 1000));
      this.timers.push(t);
    };
    schedule();
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
