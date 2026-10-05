/* The Ebb mark: a compass rose. North point solid brass, the rest in hairline. */
export function CompassRose({ size = 28, className, title }: { size?: number; className?: string; title?: string }) {
  const long = (a: number) => {
    const r = (a * Math.PI) / 180;
    const tip = [16 + 14 * Math.sin(r), 16 - 14 * Math.cos(r)];
    const l = [16 + 2.6 * Math.sin(r - Math.PI / 2), 16 - 2.6 * Math.cos(r - Math.PI / 2)];
    const rr = [16 + 2.6 * Math.sin(r + Math.PI / 2), 16 - 2.6 * Math.cos(r + Math.PI / 2)];
    return `M${tip[0].toFixed(2)} ${tip[1].toFixed(2)}L${l[0].toFixed(2)} ${l[1].toFixed(2)}L16 16L${rr[0].toFixed(2)} ${rr[1].toFixed(2)}Z`;
  };
  const short = (a: number) => {
    const r = (a * Math.PI) / 180;
    const tip = [16 + 8.5 * Math.sin(r), 16 - 8.5 * Math.cos(r)];
    const l = [16 + 1.8 * Math.sin(r - Math.PI / 2), 16 - 1.8 * Math.cos(r - Math.PI / 2)];
    const rr = [16 + 1.8 * Math.sin(r + Math.PI / 2), 16 - 1.8 * Math.cos(r + Math.PI / 2)];
    return `M${tip[0].toFixed(2)} ${tip[1].toFixed(2)}L${l[0].toFixed(2)} ${l[1].toFixed(2)}L16 16L${rr[0].toFixed(2)} ${rr[1].toFixed(2)}Z`;
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <circle cx="16" cy="16" r="11" fill="none" stroke="var(--line)" strokeWidth="1" />
      <circle cx="16" cy="16" r="11" fill="none" stroke="var(--brass)" strokeWidth="0.75" strokeDasharray="0.75 2.13" opacity="0.9" />
      {[45, 135, 225, 315].map((a) => (
        <path key={a} d={short(a)} fill="none" stroke="var(--mist)" strokeWidth="0.75" strokeLinejoin="round" />
      ))}
      {[90, 180, 270].map((a) => (
        <path key={a} d={long(a)} fill="var(--abyss)" stroke="var(--foam)" strokeWidth="0.85" strokeLinejoin="round" />
      ))}
      <path d={long(0)} fill="var(--brass)" stroke="var(--brass)" strokeWidth="0.85" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="1.4" fill="var(--abyss)" stroke="var(--brass)" strokeWidth="0.8" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <CompassRose size={28} />
      <span className="font-display text-[1.375rem] leading-none tracking-[-0.01em] text-foam" style={{ fontVariationSettings: '"opsz" 72, "SOFT" 30' }}>
        Ebb
      </span>
    </span>
  );
}
