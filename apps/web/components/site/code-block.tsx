import { CopyButton } from "./copy-button";

/* Minimal syntax tint: comments muted, strings kelp, a few keywords brass. */
function tint(line: string, lang: string) {
  const parts: React.ReactNode[] = [];
  const commentIdx = lang === "sh" || lang === "bash" || lang === "py" ? line.indexOf("#") : line.indexOf("//");
  let code = line;
  let comment = "";
  if (commentIdx >= 0 && !/https?:\/\//.test(line.slice(Math.max(0, commentIdx - 6), commentIdx + 2))) {
    code = line.slice(0, commentIdx);
    comment = line.slice(commentIdx);
  }
  const re = /("[^"]*"|'[^']*'|`[^`]*`|\b(?:function|returns|require|external|view|const|await|async|import|from|export|let|return|if|else|for|new|curl|POST|GET)\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) parts.push(code.slice(last, m.index));
    const tok = m[0];
    const isStr = /^["'`]/.test(tok);
    parts.push(
      <span key={i++} className={isStr ? "text-kelp" : "text-brass-ink"}>
        {tok}
      </span>,
    );
    last = m.index + tok.length;
  }
  if (last < code.length) parts.push(code.slice(last));
  if (comment)
    parts.push(
      <span key="c" className="text-mist/80 italic">
        {comment}
      </span>,
    );
  return parts;
}

export function CodeBlock({ code, lang = "", title, className = "" }: { code: string; lang?: string; title?: string; className?: string }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className={`neatline overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <span className="eyebrow truncate">{title ?? (lang || "code")}</span>
        <CopyButton value={code.replace(/\n$/, "")} />
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[12.5px] leading-[1.7] text-foam">
        <code>
          {lines.map((l, i) => (
            <span key={i} className="block min-h-[1.7em]">
              {tint(l, lang)}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
