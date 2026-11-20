/** Speech-bubble visibility for a busy room (~20 concurrent users).
 *  Pure policy, behind the chat message interface. Does not replace world.say(). */
export const BUBBLE_CAP = 6;
export type BubblePriority = 'self' | 'nearby' | 'friends' | 'other';
export interface BubbleCandidate { id: string; text: string; at: number; priority: BubblePriority }

const RANK: Record<BubblePriority, number> = { self: 0, nearby: 1, friends: 2, other: 3 };

/** One bubble per avatar (latest text). Fill the cap in priority order: self > nearby > friends > others.
 *  Leftover "other" avatars collapse (ids returned in `collapsedIds`, to be shown as "…"). */
export function pickSpeechBubbles(candidates: BubbleCandidate[], cap = BUBBLE_CAP): { shown: BubbleCandidate[]; collapsedIds: string[] } {
  const latest = new Map<string, BubbleCandidate>();
  for (const c of candidates) {
    const prev = latest.get(c.id);
    if (!prev || c.at >= prev.at) latest.set(c.id, c);
  }
  const groups: Record<BubblePriority, BubbleCandidate[]> = { self: [], nearby: [], friends: [], other: [] };
  for (const c of latest.values()) groups[c.priority].push(c);
  for (const list of Object.values(groups)) list.sort((a, b) => b.at - a.at);

  const shown: BubbleCandidate[] = [];
  for (const key of ['self', 'nearby', 'friends'] as const) {
    for (const c of groups[key]) if (shown.length < cap) shown.push(c);
  }
  const others = groups.other;
  const slots = cap - shown.length;
  if (others.length <= slots) return { shown: shown.concat(others), collapsedIds: [] };
  // Keep one slot for a collapse marker when possible so leftover others are represented.
  if (slots <= 0) return { shown, collapsedIds: others.map((c) => c.id) };
  const keep = Math.max(0, slots - 1);
  return { shown: shown.concat(others.slice(0, keep)), collapsedIds: others.slice(keep).map((c) => c.id) };
}

export function bubblePriority(id: string, selfId: string, nearbyIds: readonly string[] = [], friendIds: readonly string[] = []): BubblePriority {
  if (id === selfId) return 'self';
  if (nearbyIds.includes(id)) return 'nearby';
  if (friendIds.includes(id)) return 'friends';
  return 'other';
}
