"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "./icons";

export function CopyButton({ value, label = "Copy", className = "", compact = false }: { value: string; label?: string; className?: string; compact?: boolean }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-1.5 rounded-[2px] border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-mist transition-colors hover:border-brass hover:text-foam ${className}`}
      aria-label={done ? "Copied" : `${label} to clipboard`}
    >
      {done ? <IconCheck size={13} className="text-kelp" /> : <IconCopy size={13} />}
      {compact ? null : <span>{done ? "Copied" : label}</span>}
      <span className="sr-only" aria-live="polite">
        {done ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}
