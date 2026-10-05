/* Background: bathymetric contours drifting slowly, scattered depth soundings and
   a few rhumb lines. Deterministic (seeded) so server and client agree. */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothClosed(pts: [number, number][]) {
  const n = pts.length;
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + "Z";
}

function basin(cx: number, cy: number, R: number, rings: number, seed: number, squash = 0.7) {
  const r = rng(seed);
  const ph = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
  const paths: { d: string; major: boolean }[] = [];
  for (let k = 0; k < rings; k++) {
    const f = 1 - k / (rings + 0.6);
    const pts: [number, number][] = [];
    const N = 40;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const wob =
        1 +
        0.16 * Math.sin(2 * a + ph[0] + k * 0.22) +
        0.08 * Math.sin(3 * a + ph[1] - k * 0.31) +
        0.05 * Math.sin(5 * a + ph[2] + k * 0.17) +
        0.025 * Math.sin(7 * a + ph[3]);
      const rad = R * f * wob;
      pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a) * squash]);
    }
    paths.push({ d: smoothClosed(pts), major: k % 4 === 0 });
  }
  return paths;
}

const W = 1600;
const H = 1000;

const groupA = [...basin(1180, 260, 520, 14, 7), ...basin(260, 860, 380, 10, 21, 0.8)];
const groupB = [...basin(520, 120, 300, 8, 42, 0.6), ...basin(1420, 900, 330, 9, 99, 0.75)];

const soundings = (() => {
  const r = rng(1337);
  const out: { x: number; y: number; t: string; sub?: string }[] = [];
  for (let i = 0; i < 46; i++) {
    const depth = Math.floor(4 + r() * 62);
    out.push({
      x: Math.round(30 + r() * (W - 60)),
      y: Math.round(30 + r() * (H - 60)),
      t: String(depth),
      sub: r() > 0.62 ? String(Math.floor(r() * 9) + 1) : undefined,
    });
  }
  return out;
})();

export function Bathymetry() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <svg className="h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="bathy-vignette" cx="50%" cy="40%" r="75%">
            <stop offset="0%" stopColor="var(--abyss)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--abyss)" stopOpacity="0.85" />
          </radialGradient>
        </defs>
        {/* rhumb lines from an off-page rose */}
        <g stroke="var(--contour)" strokeWidth="0.6" opacity="0.7">
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            return <line key={i} x1={-120} y1={420} x2={Math.round(-120 + Math.cos(a) * 2400)} y2={Math.round(420 + Math.sin(a) * 2400)} strokeDasharray={i % 2 ? "2 10" : undefined} />;
          })}
        </g>
        <g className="motion-safe:animate-drift-a" fill="none" stroke="var(--contour)">
          {groupA.map((p, i) => (
            <path key={i} d={p.d} strokeWidth={p.major ? 1.1 : 0.7} />
          ))}
        </g>
        <g className="motion-safe:animate-drift-b" fill="none" stroke="var(--contour)">
          {groupB.map((p, i) => (
            <path key={i} d={p.d} strokeWidth={p.major ? 1.1 : 0.7} />
          ))}
        </g>
        <g fill="var(--sounding)" fontFamily="var(--font-mono)" fontSize="11" opacity="0.75">
          {soundings.map((s, i) => (
            <text key={i} x={s.x} y={s.y}>
              {s.t}
              {s.sub ? (
                <tspan fontSize="8" dy="3">
                  {s.sub}
                </tspan>
              ) : null}
            </text>
          ))}
        </g>
        <rect width={W} height={H} fill="url(#bathy-vignette)" />
      </svg>
    </div>
  );
}
