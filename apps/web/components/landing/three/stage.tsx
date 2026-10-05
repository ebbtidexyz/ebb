"use client";

import { useEffect, useRef } from "react";
import { gsap, MEDIA } from "@/lib/gsap";
import { onLandingReady } from "../bus";
import { resetStage, stage } from "./store";
import type { Engine } from "./engine";

/** The one fixed WebGL canvas. three.js is imported only after first paint. */
export function Stage() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let engine: Engine | null = null;
    let cancelled = false;
    const mobile = window.matchMedia(MEDIA.mobile).matches;
    const reduced = window.matchMedia(MEDIA.reduce).matches;
    const tick = () => engine?.frame(gsap.ticker.time);
    const onResize = () => engine?.resize();
    let offReady: (() => void) | undefined;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __stage: typeof stage }).__stage = stage;

    (async () => {
      const mod = await import("./engine");
      if (cancelled) return;
      engine = mod.createEngine(canvas, { mobile, reduced });
      if (!engine) {
        stage.failed = true;
        stage.emit();
        return;
      }
      window.addEventListener("resize", onResize);
      gsap.ticker.add(tick);
      await engine.load("nautilus").catch(() => {});
      if (cancelled || mobile) return;
      // the supporting cast loads once the hero is on screen
      offReady = onLandingReady(() => {
        const idle = (cb: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 600));
        idle(() => {
          if (cancelled || !engine) return;
          engine
            .load("compass")
            .catch(() => {})
            .then(() => {
              if (!cancelled) engine?.load("buoy").catch(() => {});
            });
        });
      });
    })();

    return () => {
      cancelled = true;
      offReady?.();
      gsap.ticker.remove(tick);
      window.removeEventListener("resize", onResize);
      engine?.dispose();
      engine = null;
      resetStage();
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 block h-full w-full" />;
}
