/** ONE place for the chat / speech-bubble tuning (YoLand chat, Option C + Glass Candy).
 *  Everything that limits or times bubbles reads these values; nothing else hard-codes a cap.
 *  Test / demo override (never saved): ?bubbles=<n> sets maxVisibleBubbles for this tab. */
export interface ChatConfig {
  /** Speech bubbles visible at once above avatars (own message always shows, counts toward the cap). */
  maxVisibleBubbles: number;
  /** Bubble lifetime = clamp(minMs + perCharMs * length, minMs, maxMs). */
  bubbleMinMs: number; bubblePerCharMs: number; bubbleMaxMs: number;
  /** A message that could not get a bubble slot waits this long for a free slot, then stays history-only. */
  queueTtlMs: number;
  /** Proximity bands (world metres): within one band, arrival order decides; a nearer band goes first. */
  proximityBandM: number;
  /** Messages kept in the history panel (missed bubbles stay readable there). */
  historyMax: number;
  /** Remote message ids remembered for de-duplication (reconnect / replay). */
  dedupeWindow: number;
}

export const CHAT_CONFIG: ChatConfig = {
  maxVisibleBubbles: 6,
  bubbleMinMs: 4500, bubblePerCharMs: 55, bubbleMaxMs: 10000,
  queueTtlMs: 5000,
  proximityBandM: 2,
  historyMax: 200,
  dedupeWindow: 1000,
};

/** Parse the optional ?bubbles=<n> override (1..20). */
export function bubbleCapFromSearch(search: string): number | null {
  try {
    const raw = new URLSearchParams(search.startsWith('?') ? search : '?' + search).get('bubbles');
    if (raw == null || raw === '') return null;
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n >= 1 && n <= 20 ? n : null;
  } catch { return null; }
}
if (typeof location !== 'undefined') {
  const n = bubbleCapFromSearch(location.search);
  if (n != null) CHAT_CONFIG.maxVisibleBubbles = n;
}

/** How long a bubble stays up for this text (ms). */
export function bubbleDurationMs(text: string, cfg: Pick<ChatConfig, 'bubbleMinMs' | 'bubblePerCharMs' | 'bubbleMaxMs'> = CHAT_CONFIG): number {
  const n = [...(text ?? '')].length;
  return Math.max(cfg.bubbleMinMs, Math.min(cfg.bubbleMaxMs, cfg.bubbleMinMs + cfg.bubblePerCharMs * n));
}
