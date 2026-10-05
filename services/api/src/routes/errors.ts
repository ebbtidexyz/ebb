// Error envelope (SPEC.md §5.5): { "error": { "type": "...", "message": "..." } }
import type { ApiError } from "@ebb/shared";

export function errorResponse(status: number, type: string, message: string, headers: Record<string, string> = {}): Response {
  const body: ApiError = { error: { type, message } };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly type: string, message: string, readonly headers: Record<string, string> = {}) {
    super(message);
  }
  toResponse() {
    return errorResponse(this.status, this.type, this.message, this.headers);
  }
}

/** JSON with bigints serialized as strings */
export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
