// Conservative token estimates (we only need an upper-ish bound for the reservation;
// the real usage reported by the upstream decides the final cost).

type Part = { type?: string; text?: unknown };
export interface ChatMessage { role?: unknown; content?: unknown; name?: unknown }

export function contentChars(content: unknown): { chars: number; images: number } {
  if (typeof content === "string") return { chars: content.length, images: 0 };
  if (Array.isArray(content)) {
    let chars = 0;
    let images = 0;
    for (const p of content as Part[]) {
      if (p && typeof p === "object") {
        if (typeof p.text === "string") chars += p.text.length;
        else if (p.type === "image_url" || p.type === "input_image") images++;
        else chars += JSON.stringify(p).length;
      }
    }
    return { chars, images };
  }
  if (content == null) return { chars: 0, images: 0 };
  return { chars: JSON.stringify(content).length, images: 0 };
}

/** ~3 chars/token (deliberately pessimistic) + per-message overhead + 1000 per image */
export function estimatePromptTokens(messages: readonly ChatMessage[], extra: unknown = undefined): number {
  let chars = 0;
  let images = 0;
  for (const m of messages) {
    const c = contentChars(m.content);
    chars += c.chars;
    images += c.images;
  }
  if (extra !== undefined) chars += JSON.stringify(extra).length; // tools / response_format
  return Math.ceil(chars / 3) + 4 * messages.length + 3 + images * 1000;
}

/** used when an upstream omits usage */
export function estimateCompletionTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
