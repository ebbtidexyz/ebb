// Tiny structured logger: one line per event, bigint-safe.
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: Level = (process.env.LOG_LEVEL as Level) in order ? (process.env.LOG_LEVEL as Level) : "info";

export function setLogLevel(l: Level) {
  threshold = l;
}

function fmt(data: unknown): string {
  if (data === undefined) return "";
  try {
    return " " + JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Error ? v.message : v));
  } catch {
    return " [unserializable]";
  }
}

function write(level: Level, scope: string, msg: string, data?: unknown) {
  if (order[level] < order[threshold]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${fmt(data)}`;
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export function logger(scope: string) {
  return {
    debug: (msg: string, data?: unknown) => write("debug", scope, msg, data),
    info: (msg: string, data?: unknown) => write("info", scope, msg, data),
    warn: (msg: string, data?: unknown) => write("warn", scope, msg, data),
    error: (msg: string, data?: unknown) => write("error", scope, msg, data),
  };
}
export type Logger = ReturnType<typeof logger>;

export function errMsg(e: unknown): string {
  if (e instanceof Error) return (e as Error & { shortMessage?: string }).shortMessage ?? e.message;
  return String(e);
}
