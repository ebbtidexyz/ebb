"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { Draggable, gsap, prefersReduced } from "@/lib/gsap";
import { r2 } from "@/lib/format";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;
const SWEEP = 270;
const MIN = -135;

/**
 * A brass rotary dial: a Draggable of type "rotation" with Inertia that clicks
 * into `detents` positions over a 270° sweep. A visually hidden range input
 * mirrors it for keyboards and screen readers (arrows, PageUp/Down, Home/End).
 */
export function Dial({
  label,
  t,
  onChange,
  onSettle,
  display,
  valueText,
  detents = 28,
}: {
  label: string;
  t: number;
  onChange: (t: number) => void;
  onSettle?: () => void;
  display: string;
  valueText: string;
  detents?: number;
}) {
  const knob = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const cb = useRef({ onChange, onSettle });
  cb.current = { onChange, onSettle };
  const id = useId();
  const step = SWEEP / detents;
  const toDeg = (v: number) => MIN + v * SWEEP;

  useIso(() => {
    const el = knob.current;
    if (!el) return;
    const snap = (v: number) => gsap.utils.clamp(MIN, MIN + SWEEP, Math.round((v - MIN) / step) * step + MIN);
    const emit = (rot: number) => cb.current.onChange(gsap.utils.clamp(0, 1, (rot - MIN) / SWEEP));
    gsap.set(el, { rotation: toDeg(t) });
    const settle = () => {
      dragging.current = false;
      cb.current.onSettle?.();
    };
    const d = Draggable.create(el, {
      type: "rotation",
      inertia: !prefersReduced(),
      bounds: { minRotation: MIN, maxRotation: MIN + SWEEP },
      snap,
      liveSnap: true,
      throwResistance: 2500,
      onPress() {
        dragging.current = true;
      },
      onDrag() {
        emit(this.rotation);
      },
      onThrowUpdate() {
        emit(this.rotation);
      },
      onRelease() {
        if (!this.tween || !this.tween.isActive()) settle();
      },
      onThrowComplete: settle,
    })[0];
    return () => {
      d.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // follow external changes (presets, keyboard)
  useEffect(() => {
    const el = knob.current;
    if (!el || dragging.current) return;
    const target = toDeg(t);
    const cur = Number(gsap.getProperty(el, "rotation"));
    if (Math.abs(cur - target) < 0.01) return;
    gsap.to(el, {
      rotation: target,
      duration: prefersReduced() ? 0 : 0.6,
      ease: "back.out(1.6)",
      overwrite: true,
      onComplete: () => Draggable.get(el)?.update(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const ticks = detents;
  const R = 46;
  const arc = (from: number, to: number, r: number) => {
    const p = (dd: number) => {
      const a = ((dd - 90) * Math.PI) / 180;
      return [60 + r * Math.cos(a), 60 + r * Math.sin(a)];
    };
    const [x1, y1] = p(from);
    const [x2, y2] = p(to);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const deg = toDeg(t);

  return (
    <div className="dial flex flex-col items-center text-center">
      <div className="relative h-[120px] w-[120px] sm:h-[132px] sm:w-[132px]">
        <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full" aria-hidden="true">
          {Array.from({ length: ticks + 1 }, (_, i) => {
            const dd = MIN + (i / ticks) * SWEEP;
            const a = ((dd - 90) * Math.PI) / 180;
            const on = i / ticks <= t + 1e-6;
            const major = i % Math.max(1, Math.round(ticks / 4)) === 0;
            return (
              <line
                key={i}
                x1={r2(60 + (major ? 51 : 53) * Math.cos(a))}
                y1={r2(60 + (major ? 51 : 53) * Math.sin(a))}
                x2={r2(60 + 58 * Math.cos(a))}
                y2={r2(60 + 58 * Math.sin(a))}
                stroke={on ? "var(--brass)" : "var(--mist)"}
                strokeOpacity={on ? 1 : 0.38}
                strokeWidth={major ? 1.4 : 0.9}
                style={{ transition: "stroke 160ms" }}
              />
            );
          })}
          <path d={arc(MIN, MIN + SWEEP, R)} fill="none" stroke="var(--line)" strokeWidth="2" />
          {t > 0.002 ? <path d={arc(MIN, deg, R)} fill="none" stroke="var(--brass)" strokeWidth="2" /> : null}
        </svg>
        <input
          type="range"
          min={0}
          max={detents}
          step={1}
          value={Math.round(t * detents)}
          onChange={(e) => {
            onChange(Number(e.target.value) / detents);
            onSettle?.();
          }}
          aria-labelledby={`${id}-l`}
          aria-valuetext={valueText}
          className="mirror-range pointer-events-none"
        />
        <div
          ref={knob}
          data-cursor
          className="dial-knob absolute left-1/2 top-1/2 -ml-[38px] -mt-[38px] h-[76px] w-[76px] touch-none select-none rounded-full border border-line bg-[radial-gradient(circle_at_35%_30%,var(--shelf),var(--deep)_70%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_10px_24px_-10px_rgb(0_0_0/0.7)]"
        >
          <svg viewBox="0 0 76 76" className="h-full w-full" aria-hidden="true">
            <circle cx="38" cy="38" r="30" fill="none" stroke="var(--line)" strokeDasharray="1 3" />
            {Array.from({ length: 24 }, (_, i) => {
              const a = (i / 24) * Math.PI * 2;
              return <line key={i} x1={r2(38 + 34 * Math.cos(a))} y1={r2(38 + 34 * Math.sin(a))} x2={r2(38 + 37 * Math.cos(a))} y2={r2(38 + 37 * Math.sin(a))} stroke="var(--mist)" strokeOpacity="0.35" />;
            })}
            <line x1="38" y1="38" x2="38" y2="9" stroke="var(--brass)" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="38" cy="9" r="2.8" fill="var(--brass)" />
            <circle cx="38" cy="38" r="4.5" fill="var(--abyss)" stroke="var(--brass)" strokeWidth="1.5" />
          </svg>
        </div>
      </div>
      <div id={`${id}-l`} className="eyebrow mt-3">
        {label}
      </div>
      <div className="mt-1 font-mono text-[15px] text-foam tnum">{display}</div>
    </div>
  );
}
