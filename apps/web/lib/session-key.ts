"use client";

import { useCallback, useSyncExternalStore } from "react";

/* The API key used by Usage and Playground. Kept in sessionStorage only:
   it disappears when the tab closes and is never written to localStorage. */
const K = "ebb.key";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return sessionStorage.getItem(K);
  } catch {
    return null;
  }
}

export function useSessionKey() {
  const key = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => null,
  );
  const set = useCallback((v: string | null) => {
    try {
      if (v) sessionStorage.setItem(K, v.trim());
      else sessionStorage.removeItem(K);
    } catch {}
    listeners.forEach((l) => l());
  }, []);
  return [key, set] as const;
}
