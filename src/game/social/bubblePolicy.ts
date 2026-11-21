import { CHAT_CONFIG } from './chatConfig';
/** Speech-bubble visibility for a busy room (~20 concurrent users). Pure, neutral policy.
 *
 *  Same rules for every speaker: friends get NO priority, non-friends are never hidden for not being friends.
 *   1. one bubble per avatar (its latest message);
 *   2. your own message always shows (on your screen; every player gets the same rule on theirs);
 *   3. bubbles already on screen keep their slot until they expire (no flicker, first come first served);
 *   4. free slots go to waiting messages by proximity band (nearer first), then arrival order (earlier first);
 *   5. speakers that are off screen take no slot (there is no space to show them).
 *  Messages that get no slot are NOT dropped: they are in the chat history and wait in `queued`.
 *  The cap comes from CHAT_CONFIG.maxVisibleBubbles (single config place). */
export const BUBBLE_CAP = CHAT_CONFIG.maxVisibleBubbles;

export interface BubbleCandidate {
  id: string; text: string;
  /** arrival order (monotonic sequence or timestamp) */ seq: number;
  /** distance to the local player / camera focus, world metres (Infinity when unknown) */ dist: number;
  /** already displayed (keeps its slot) */ visible?: boolean;
  /** false = speaker is off screen */ onScreen?: boolean;
}
export interface BubblePick { shown: BubbleCandidate[]; queued: BubbleCandidate[]; offscreen: BubbleCandidate[] }

export function pickSpeechBubbles(candidates: readonly BubbleCandidate[], opts: { cap?: number; selfId?: string; bandM?: number } = {}): BubblePick {
  const cap = Math.max(0, Math.floor(opts.cap ?? CHAT_CONFIG.maxVisibleBubbles));
  const band = opts.bandM ?? CHAT_CONFIG.proximityBandM;
  const latest = new Map<string, BubbleCandidate>();
  for (const c of candidates) { const p = latest.get(c.id); if (!p || c.seq >= p.seq) latest.set(c.id, c); }
  const all = [...latest.values()];
  const offscreen = all.filter((c) => c.onScreen === false && c.id !== opts.selfId);
  const live = all.filter((c) => !(c.onScreen === false && c.id !== opts.selfId));
  const bandOf = (c: BubbleCandidate) => (Number.isFinite(c.dist) ? Math.floor(Math.max(0, c.dist) / Math.max(1e-6, band)) : Number.MAX_SAFE_INTEGER);
  const waitOrder = (a: BubbleCandidate, b: BubbleCandidate) => bandOf(a) - bandOf(b) || a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const self = live.find((c) => c.id === opts.selfId);
  const keep = live.filter((c) => c.visible && c !== self).sort((a, b) => a.seq - b.seq);
  const wait = live.filter((c) => !c.visible && c !== self).sort(waitOrder);
  const shown: BubbleCandidate[] = [];
  if (self && cap > 0) shown.push(self);
  // own message takes a slot: if the screen was full, the farthest / oldest kept bubble gives way (it stays in history)
  const keepRoom = Math.max(0, cap - shown.length);
  const kept = keep.length > keepRoom ? [...keep].sort(waitOrder).slice(0, keepRoom) : keep;
  const bumped = keep.filter((c) => !kept.includes(c));
  shown.push(...kept);
  const queued: BubbleCandidate[] = [];
  for (const c of wait) { if (shown.length < cap) shown.push(c); else queued.push(c); }
  if (self && cap === 0) queued.unshift(self);
  return { shown, queued: [...bumped, ...queued].sort(waitOrder), offscreen };
}
