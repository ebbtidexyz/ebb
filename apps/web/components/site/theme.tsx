"use client";

import { IconMoon, IconSun } from "./icons";

/* Runs in <head> before paint: resolve stored or system theme onto <html data-theme>. */

export function ThemeToggle({ className = "" }: { className?: string }) {
  function toggle() {
    const d = document.documentElement;
    const next = d.getAttribute("data-theme") === "light" ? "dark" : "light";
    d.setAttribute("data-theme", next);
    try {
      localStorage.setItem("ebb-theme", next);
    } catch {}
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className={`group inline-flex h-9 w-9 items-center justify-center rounded-[2px] border border-line text-mist transition-colors hover:border-brass hover:text-foam ${className}`}
      aria-label="Switch between night chart and day chart"
      title="Night chart / day chart"
    >
      <IconSun size={16} className="theme-icon-sun" />
      <IconMoon size={16} className="theme-icon-moon" />
    </button>
  );
}
