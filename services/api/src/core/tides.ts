// Tide (epoch) clock bound to a genesis timestamp.
import { EPOCH_SECONDS, EXPIRY_SECONDS } from "@ebb/shared";

export class TideClock {
  constructor(readonly genesis: number) {}
  epochAt(t: number): number {
    return Math.floor((t - this.genesis) / EPOCH_SECONDS);
  }
  start(epoch: number): number {
    return this.genesis + epoch * EPOCH_SECONDS;
  }
  end(epoch: number): number {
    return this.start(epoch) + EPOCH_SECONDS;
  }
  expiresAt(epoch: number): number {
    return this.start(epoch) + EXPIRY_SECONDS;
  }
  isExpired(epoch: number, now: number): boolean {
    return now >= this.expiresAt(epoch);
  }
}

/** align a unix time down to :00 / :30 UTC */
export function alignTide(t: number): number {
  return t - (t % EPOCH_SECONDS);
}
