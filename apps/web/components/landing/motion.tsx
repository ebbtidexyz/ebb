"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap, MEDIA, ScrollSmoother, ScrollTrigger, scrollToTarget, useGsap } from "@/lib/gsap";
import { onLandingReady, resetLanding } from "./bus";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Creates the ScrollSmoother before any section builds its ScrollTriggers
 * (it is the first sibling, so its layout effect runs first), routes in-page
 * anchor links through it, and refreshes once fonts and images settle.
 */
export function SmoothInit() {
  useIso(() => {
    const mm = gsap.matchMedia();
    mm.add(MEDIA, (ctx) => {
      if (!ctx.conditions?.motion) return;
      const s = ScrollSmoother.create({
        wrapper: "#smooth-wrapper",
        content: "#smooth-content",
        smooth: 1.1,
        effects: true,
        smoothTouch: 0.1,
      });
      return () => s.kill();
    });

    // in-page anchors (#id and /#id) go through the smoother; capture phase beats next/link
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank") return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== "/" || !url.hash) return;
      const el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      scrollToTarget(el);
      window.history.replaceState(null, "", url.hash);
    };
    document.addEventListener("click", onClick, true);

    const refresh = () => ScrollTrigger.refresh();
    document.fonts?.ready.then(refresh).catch(() => {});
    window.addEventListener("load", refresh);

    // late layout changes (a heading re-split after its font arrived, live rows filling in)
    // move every trigger below them: refresh when the page height really changes
    const content = document.getElementById("smooth-content");
    let lastH = content?.offsetHeight ?? 0;
    let refreshing = false;
    const record = () => {
      refreshing = false;
      lastH = content?.offsetHeight ?? 0;
    };
    const starting = () => (refreshing = true);
    ScrollTrigger.addEventListener("refreshInit", starting);
    ScrollTrigger.addEventListener("refresh", record);
    let pending: gsap.core.Tween | null = null;
    const ro = new ResizeObserver(() => {
      if (!content || refreshing) return;
      if (Math.abs(content.offsetHeight - lastH) < 2) return;
      pending?.kill();
      pending = gsap.delayedCall(0.25, refresh);
    });
    if (content) ro.observe(content);

    const offReady = onLandingReady(() => {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const el = document.getElementById(decodeURIComponent(hash));
      if (el) setTimeout(() => scrollToTarget(el, false), 80);
    });

    document.documentElement.classList.add("is-landing");
    return () => {
      offReady();
      mm.revert();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("load", refresh);
      ScrollTrigger.removeEventListener("refresh", record);
      ScrollTrigger.removeEventListener("refreshInit", starting);
      ro.disconnect();
      pending?.kill();
      document.documentElement.classList.remove("is-landing");
      resetLanding();
    };
  }, []);
  return null;
}

/* ------------------------------------------------------------------ cursor */

/** Brass ring that trails the pointer, swells over controls and pulls on [data-magnetic]. */
export function Cursor() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!fine || window.matchMedia(MEDIA.reduce).matches) return;
    el.style.display = "block";
    document.documentElement.classList.add("has-cursor");
    gsap.set(el, { xPercent: -50, yPercent: -50 });
    const xTo = gsap.quickTo(el, "x", { duration: 0.35, ease: "power3" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.35, ease: "power3" });
    let shown = false;
    let hover: Element | null = null;
    let magnet: HTMLElement | null = null;

    const release = (m: HTMLElement) => gsap.to(m, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.4)" });

    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      xTo(e.clientX);
      yTo(e.clientY);
      if (!shown) {
        shown = true;
        gsap.to(el, { opacity: 1, duration: 0.3 });
      }
      const t = e.target as Element | null;
      const m = (t?.closest?.("[data-magnetic]") as HTMLElement | null) ?? null;
      if (m !== magnet) {
        if (magnet) release(magnet);
        magnet = m;
      }
      if (magnet) {
        const r = magnet.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        gsap.to(magnet, { x: gsap.utils.clamp(-12, 12, dx * 0.3), y: gsap.utils.clamp(-12, 12, dy * 0.4), duration: 0.4, ease: "power3" });
      }
      const h = t?.closest?.("a, button, [role='button'], [role='tab'], [role='slider'], input, select, textarea, label, [data-cursor]") ?? null;
      if (h !== hover) {
        hover = h;
        el.classList.toggle("is-hover", !!h);
        gsap.to(el, { scale: h ? (magnet ? 2.4 : 1.8) : 1, duration: 0.35, ease: "power3" });
      }
    };
    const leave = () => {
      shown = false;
      gsap.to(el, { opacity: 0, duration: 0.3 });
      if (magnet) release(magnet);
      magnet = null;
    };
    const down = () => gsap.to(el, { scale: "*=0.8", duration: 0.15 });
    const up = () => gsap.to(el, { scale: hover ? 1.8 : 1, duration: 0.3 });
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.documentElement.classList.remove("has-cursor");
      el.style.display = "none";
    };
  }, []);
  return <div ref={ref} className="cursor-ring" aria-hidden="true" />;
}

/* ------------------------------------------------------------------ section rail */

interface RailItem {
  id: string;
  numeral: string;
  label: string;
}

/** Fixed left index of the eleven sections; active numeral in brass, progress line on scrub. */
export function SectionRail() {
  const ref = useRef<HTMLElement>(null);
  const [items, setItems] = useState<RailItem[]>([]);

  useEffect(() => {
    const list = Array.from(document.querySelectorAll<HTMLElement>("#smooth-content [data-rail]")).map((s) => ({
      id: s.id,
      numeral: s.dataset.rail ?? "",
      label: s.dataset.railLabel ?? "",
    }));
    setItems(list);
  }, []);

  useGsap(
    ref,
    ({ motion }) => {
      const nav = ref.current!;
      if (!items.length) return;
      const els = nav.querySelectorAll<HTMLElement>(".rail-item");
      const secs = items.map((it) => document.getElementById(it.id)).filter((x): x is HTMLElement => !!x);
      const fill = nav.querySelector<HTMLElement>(".rail-fill")!;
      const fillTo = gsap.quickTo(fill, "scaleY", { duration: motion ? 0.5 : 0, ease: "power3" });
      gsap.set(fill, { scaleY: 0, transformOrigin: "top" });
      gsap.set(nav, { autoAlpha: 0, x: -12 });
      let active = -2;
      let shown = false;
      // measured from live rects on every update, so pinned sections (and their spacers) are always right
      const update = () => {
        const line = window.innerHeight * 0.55;
        let i = -1;
        secs.forEach((s, k) => {
          if (s.getBoundingClientRect().top <= line) i = k;
        });
        if (i !== active) {
          active = i;
          els.forEach((e, k) => (e.dataset.active = String(k === i)));
        }
        const show = secs.length > 0 && secs[0].getBoundingClientRect().top < window.innerHeight * 0.7;
        if (show !== shown) {
          shown = show;
          gsap.to(nav, { autoAlpha: show ? 1 : 0, x: show ? 0 : -12, duration: motion ? 0.5 : 0, overwrite: "auto" });
        }
        const first = secs[0];
        const content = document.getElementById("smooth-content");
        if (first && content) {
          const top = first.getBoundingClientRect().top;
          const total = content.getBoundingClientRect().height - window.innerHeight - (first.getBoundingClientRect().top - content.getBoundingClientRect().top);
          fillTo(gsap.utils.clamp(0, 1, -top / Math.max(1, total)));
        }
      };
      ScrollTrigger.create({ start: 0, end: "max", onUpdate: update, onRefresh: update, refreshPriority: -1 });
      update();
    },
    [items],
  );

  return (
    <nav ref={ref} aria-label="Section index" className="fixed left-5 top-1/2 z-30 hidden -translate-y-1/2 xl:block" style={{ visibility: "hidden" }}>
      <div className="relative pl-3">
        <span className="absolute left-0 top-0 h-full w-px bg-line" aria-hidden="true" />
        <span className="rail-fill absolute left-0 top-0 h-full w-px origin-top bg-brass" aria-hidden="true" />
        <ol className="space-y-2.5">
          {items.map((it) => (
            <li key={it.id} className="rail-item group" data-active="false">
              <a href={`#${it.id}`} className="flex items-center gap-2 py-0.5" aria-label={`${it.numeral} · ${it.label}`}>
                <span className="rail-tick h-px w-2.5 bg-mist/50 transition-all duration-300" aria-hidden="true" />
                <span className="rail-num w-7 font-mono text-[10.5px] tracking-[0.08em] text-mist transition-colors duration-300">{it.numeral}</span>
                <span className="rail-label pointer-events-none -translate-x-1 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.12em] text-foam opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100">
                  {it.label}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
