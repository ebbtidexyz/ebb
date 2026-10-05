"use client";

import { useSyncExternalStore } from "react";

/* One shared 1 Hz ticker, aligned to whole seconds, for every clock on the page. */
const listeners = new Set<() => void>();
let now = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function tick() {
  now = Date.now();
  listeners.forEach((l) => l());
  timer = setTimeout(tick, 1000 - (now % 1000) + 5);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (timer === undefined) {
    now = Date.now();
    timer = setTimeout(tick, 1000 - (now % 1000) + 5);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

function getSnapshot() {
  if (!now) now = Date.now();
  return now;
}

function getServerSnapshot() {
  return null;
}

/** Current time in ms, or null during SSR / hydration (render placeholders then). */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
