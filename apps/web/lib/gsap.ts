"use client";

/* GSAP, registered once for the whole client. Every landing component imports
   gsap and its plugins from here so registration and the custom eases exist
   before the first tween. */
import { useEffect, useLayoutEffect, type DependencyList, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { SplitText } from "gsap/SplitText";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { Flip } from "gsap/Flip";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { Observer } from "gsap/Observer";
import { CustomEase } from "gsap/CustomEase";
import { TextPlugin } from "gsap/TextPlugin";

let registered = false;

export function registerGsap() {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(
    ScrollTrigger,
    ScrollSmoother,
    SplitText,
    DrawSVGPlugin,
    MorphSVGPlugin,
    MotionPathPlugin,
    ScrambleTextPlugin,
    Flip,
    Draggable,
    InertiaPlugin,
    Observer,
    CustomEase,
    TextPlugin,
  );
  CustomEase.create("tide", "M0,0 C0.25,0.1 0.25,1 1,1");
  CustomEase.create("ebb", "M0,0 C0.5,0 0.1,1 1,1");
  gsap.defaults({ ease: "tide", duration: 0.9 });
  ScrollTrigger.config({ ignoreMobileResize: true });
  // dev-only handle for poking at triggers from the console
  if (process.env.NODE_ENV !== "production") (window as unknown as { __gsap: unknown }).__gsap = { gsap, ScrollTrigger, ScrollSmoother };
  registered = true;
}

registerGsap();

export { gsap, ScrollTrigger, ScrollSmoother, SplitText, DrawSVGPlugin, MorphSVGPlugin, MotionPathPlugin, ScrambleTextPlugin, Flip, Draggable, InertiaPlugin, Observer, CustomEase, TextPlugin };

/** Characters used for figure scrambles everywhere on the landing. */
export const SCRAMBLE_CHARS = "0123456789·~≈";

export interface MotionConditions {
  /** user allows motion */
  motion: boolean;
  /** prefers-reduced-motion: reduce */
  reduce: boolean;
  /** ≥ 768 px */
  desktop: boolean;
  /** < 768 px */
  mobile: boolean;
}

export const MEDIA = {
  motion: "(prefers-reduced-motion: no-preference)",
  reduce: "(prefers-reduced-motion: reduce)",
  desktop: "(min-width: 768px)",
  mobile: "(max-width: 767.98px)",
} as const;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * gsap.matchMedia() scoped to a ref: `fn` runs inside a gsap context for the
 * current motion/size conditions, is reverted when they change and on unmount.
 * Return a function from `fn` for any extra cleanup (listeners, Draggables).
 */
export function useGsap(
  scope: RefObject<HTMLElement | null>,
  fn: (c: MotionConditions, ctx: gsap.Context) => void | (() => void),
  deps: DependencyList = [],
) {
  useIsoLayoutEffect(() => {
    const el = scope.current;
    if (!el) return;
    const mm = gsap.matchMedia(el);
    mm.add(MEDIA, (ctx) => fn(ctx.conditions as unknown as MotionConditions, ctx) ?? undefined);
    return () => mm.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** The live ScrollSmoother, if motion is allowed and the landing is mounted. */
export function smoother(): ScrollSmoother | null {
  return ScrollSmoother.get() ?? null;
}

/** Scroll the page to an absolute y, through the smoother when present. */
export function scrollToY(y: number, smooth = true) {
  const s = smoother();
  if (s) s.scrollTo(y, smooth);
  else window.scrollTo({ top: y, behavior: smooth && !prefersReduced() ? "smooth" : "auto" });
}

/** Scroll a section/element to the top of the viewport. */
export function scrollToTarget(target: Element | string, smooth = true) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return;
  const s = smoother();
  if (s) {
    s.scrollTo(el, smooth, "top top");
    return;
  }
  const y = el.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: y, behavior: smooth && !prefersReduced() ? "smooth" : "auto" });
}

export function prefersReduced() {
  return typeof window !== "undefined" && window.matchMedia(MEDIA.reduce).matches;
}

/** A scrubbed or toggled ScrollTrigger scroll position → absolute page y for a 0..1 progress. */
export function triggerY(st: ScrollTrigger, p: number) {
  return st.start + (st.end - st.start) * Math.max(0, Math.min(1, p));
}
