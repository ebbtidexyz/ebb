"use client";

import { useNow } from "@/lib/use-now";
import { tideClock } from "@/lib/tide";
import { duration, pad2, r2 } from "@/lib/format";

const C = 160;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r2(C + r * Math.cos(a)), r2(C + r * Math.sin(a))];
}

function arc(r: number, from: number, to: number) {
  const sweep = Math.max(0.0001, Math.min(359.999, to - from));
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, from + sweep);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** A brass tide gauge: outer ring is the UTC day in 48 tides, inner ring the
 *  current tide's 30 minutes, and the porthole fills as the tide comes in. */
export function TideGauge({ genesis, size = 320, compact = false }: { genesis: number | null; size?: number; compact?: boolean }) {
  const nowMs = useNow();
  const clock = nowMs === null ? null : tideClock(nowMs, genesis);
  const d = nowMs === null ? null : new Date(nowMs);
  const dayFrac = d ? (d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()) / 86400 : 0;
  const frac = clock?.frac ?? 0;
  const level = 100 - 200 * frac; // porthole radius 100, water rises from the bottom
  const tideLabel = clock?.tide != null ? `#${clock.tide.toLocaleString("en-US")}` : "—";
  const utc = d ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}` : "--:--:--";
  const left = clock ? duration(clock.left, "clock") : "--:--";
  const minuteNow = clock ? Math.floor(clock.into / 60) : 0;

  const srText = clock
    ? `UTC ${utc.slice(0, 5)}. ${clock.tide != null ? `Tide ${clock.tide}.` : "Tide number published at genesis."} Next flood in ${Math.ceil(clock.left / 60)} minutes.`
    : "Tide gauge loading.";

  return (
    <figure className="flex flex-col items-center">
      <div className="relative" style={{ width: size, maxWidth: "100%" }}>
        <svg viewBox="-14 -14 348 348" className="block h-auto w-full" role="img" aria-label={srText}>
          <defs>
            <clipPath id="porthole">
              <circle cx={C} cy={C} r="100" />
            </clipPath>
            <radialGradient id="glass" cx="50%" cy="35%" r="70%">
              <stop offset="0%" stopColor="var(--shelf)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--abyss)" stopOpacity="0.1" />
            </radialGradient>
          </defs>

          {/* bezel */}
          <circle cx={C} cy={C} r="158" fill="var(--deep)" fillOpacity="0.6" stroke="var(--line)" />
          <circle cx={C} cy={C} r="153" fill="none" stroke="var(--brass)" strokeOpacity="0.55" strokeWidth="0.75" />

          {/* 24 h UTC ring: one tick per tide */}
          {Array.from({ length: 48 }, (_, i) => {
            const deg = (i / 48) * 360;
            const hour = i % 2 === 0;
            const [x1, y1] = polar(hour ? 138 : 143, deg);
            const [x2, y2] = polar(150, deg);
            const past = i / 48 < dayFrac;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={past ? "var(--brass)" : "var(--mist)"}
                strokeOpacity={past ? 0.9 : 0.45}
                strokeWidth={hour ? 1.2 : 0.8}
              />
            );
          })}
          {["00", "06", "12", "18"].map((h, i) => {
            const [x, y] = polar(126, i * 90);
            return (
              <text key={h} x={x} y={y + 3.5} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--mist)">
                {h}
              </text>
            );
          })}
          {/* UTC marker */}
          {d ? (
            <g transform={`rotate(${dayFrac * 360} ${C} ${C})`}>
              <path d={`M${C} ${C - 151} l-5 -9 h10 z`} fill="var(--brass)" />
            </g>
          ) : null}

          {/* tide ring: 30 minutes */}
          <circle cx={C} cy={C} r="112" fill="none" stroke="var(--line)" strokeWidth="1" />
          {Array.from({ length: 30 }, (_, i) => {
            const deg = (i / 30) * 360;
            const major = i % 5 === 0;
            const [x1, y1] = polar(major ? 104 : 107, deg);
            const [x2, y2] = polar(112, deg);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i <= minuteNow && clock ? "var(--foam)" : "var(--mist)"} strokeOpacity={i <= minuteNow && clock ? 0.75 : 0.4} strokeWidth={major ? 1.2 : 0.75} />;
          })}
          {clock ? <path d={arc(116, 0, frac * 360)} fill="none" stroke="var(--brass)" strokeWidth="2.5" strokeLinecap="round" /> : null}
          {clock ? (
            <g transform={`rotate(${frac * 360} ${C} ${C})`}>
              <path d={`M${C} ${C - 121} l4 5 l-4 5 l-4 -5 z`} fill="var(--brass)" />
            </g>
          ) : null}

          {/* porthole with water rising through the tide */}
          <circle cx={C} cy={C} r="100" fill="url(#glass)" />
          <g clipPath="url(#porthole)">
            <g transform={`translate(0 ${C + level})`}>
              <g className="motion-safe:[animation:wave-x_7s_linear_infinite]">
                <path
                  d={`M0 0 ${Array.from({ length: 12 }, (_, i) => `q10 -5 20 0 t20 0`).join(" ")} V220 H0 Z`}
                  fill="var(--water)"
                  fillOpacity="0.32"
                />
                <path d={`M0 0 ${Array.from({ length: 12 }, () => `q10 -5 20 0 t20 0`).join(" ")}`} fill="none" stroke="var(--foam)" strokeOpacity="0.5" strokeWidth="1" />
              </g>
            </g>
          </g>
          <circle cx={C} cy={C} r="100" fill="none" stroke="var(--line)" strokeWidth="1.25" />

          {/* readout */}
          <text x={C} y={C - 34} textAnchor="middle" fontSize="9.5" letterSpacing="2" fontFamily="var(--font-mono)" fill="var(--mist)">
            TIDE
          </text>
          <text x={C} y={C + 8} textAnchor="middle" fontSize={tideLabel.length > 6 ? 34 : 40} fontFamily="var(--font-display)" fill="var(--foam)" style={{ fontVariantNumeric: "tabular-nums" }}>
            {tideLabel}
          </text>
          <text x={C} y={C + 36} textAnchor="middle" fontSize="9.5" letterSpacing="2" fontFamily="var(--font-mono)" fill="var(--mist)">
            NEXT FLOOD
          </text>
          <text x={C} y={C + 56} textAnchor="middle" fontSize="17" fontFamily="var(--font-mono)" fill="var(--brass-ink)" style={{ fontVariantNumeric: "tabular-nums" }}>
            {left}
          </text>
        </svg>
      </div>
      {!compact ? (
        <dl className="mt-5 grid w-full max-w-[340px] grid-cols-3 border-y border-line font-mono text-[11px]">
          <div className="px-2 py-2.5 text-center">
            <dt className="text-mist">UTC</dt>
            <dd className="mt-1 text-[13px] text-foam tnum">{utc}</dd>
          </div>
          <div className="border-x border-line px-2 py-2.5 text-center">
            <dt className="text-mist">Tide</dt>
            <dd className="mt-1 text-[13px] text-foam tnum">{tideLabel}</dd>
          </div>
          <div className="px-2 py-2.5 text-center">
            <dt className="text-mist">Floods in</dt>
            <dd className="mt-1 text-[13px] text-brass-ink tnum">{left}</dd>
          </div>
        </dl>
      ) : null}
    </figure>
  );
}
