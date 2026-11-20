import { describe, expect, it } from 'vitest';
import { BUBBLE_CAP, pickSpeechBubbles, type BubbleCandidate } from '../src/game/social/bubblePolicy';
import { CHAT_CONFIG, bubbleCapFromSearch, bubbleDurationMs } from '../src/game/social/chatConfig';

const c = (id: string, seq: number, dist: number, extra: Partial<BubbleCandidate> = {}): BubbleCandidate => ({ id, text: id, seq, dist, ...extra });
const ids = (l: BubbleCandidate[]) => l.map((x) => x.id);

describe('neutral speech-bubble policy (no friend priority)', () => {
  it('cap comes from the single chat config (default 6)', () => {
    expect(BUBBLE_CAP).toBe(CHAT_CONFIG.maxVisibleBubbles);
    expect(CHAT_CONFIG.maxVisibleBubbles).toBe(6);
    const many = Array.from({ length: 20 }, (_, i) => c('p' + i, i, 1));
    expect(pickSpeechBubbles(many).shown).toHaveLength(6);
    expect(pickSpeechBubbles(many, { cap: 3 }).shown).toHaveLength(3);
  });

  it('has no friend input at all: same id set, same geometry => same result whoever is a friend', () => {
    const a = [c('friend', 2, 3), c('stranger', 1, 3), c('newbie', 3, 3)];
    const r = pickSpeechBubbles(a, { cap: 2 });
    // same band: arrival order decides (first come, first shown); the newcomer waits, it is not dropped
    expect(ids(r.shown)).toEqual(['stranger', 'friend']);
    expect(ids(r.queued)).toEqual(['newbie']);
    // swapping names changes nothing: only seq / dist matter
    const b = pickSpeechBubbles([c('stranger', 2, 3), c('friend', 1, 3), c('newbie', 3, 3)], { cap: 2 });
    expect(ids(b.shown)).toEqual(['friend', 'stranger']);
  });

  it('nearer proximity band goes first, then arrival order', () => {
    const r = pickSpeechBubbles([c('far1', 1, 9), c('near2', 3, 0.5), c('near1', 2, 1.2), c('mid', 4, 3)], { cap: 3, bandM: 2 });
    expect(ids(r.shown)).toEqual(['near1', 'near2', 'mid']);
    expect(ids(r.queued)).toEqual(['far1']);
  });

  it('own message always shows; a full screen gives up its farthest bubble (kept waiting, not lost)', () => {
    const visible = [1, 2, 3].map((i) => c('o' + i, i, i * 3, { visible: true }));
    const r = pickSpeechBubbles([...visible, c('me', 9, 0)], { cap: 3, selfId: 'me', bandM: 2 });
    expect(ids(r.shown)).toEqual(['me', 'o1', 'o2']);
    expect(ids(r.queued)).toEqual(['o3']);
  });

  it('bubbles already on screen keep their slot (no flicker) even if a nearer one arrives', () => {
    const r = pickSpeechBubbles([c('far', 1, 8, { visible: true }), c('near', 2, 0.3)], { cap: 1, selfId: 'me' });
    expect(ids(r.shown)).toEqual(['far']); expect(ids(r.queued)).toEqual(['near']);
  });

  it('one bubble per avatar (latest text wins) and off-screen speakers take no slot', () => {
    const r = pickSpeechBubbles([c('a', 1, 1, { text: 'old' }), c('a', 5, 1, { text: 'new' }), c('gone', 2, 1, { onScreen: false }), c('b', 3, 1)], { cap: 2 });
    expect(r.shown.map((x) => x.text)).toEqual(['b', 'new']); // same band: arrival order
    expect(ids(r.offscreen)).toEqual(['gone']);
  });

  it('bubble duration scales with text length and is clamped; ?bubbles=n parses 1..20 only', () => {
    expect(bubbleDurationMs('ok')).toBe(CHAT_CONFIG.bubbleMinMs + 2 * CHAT_CONFIG.bubblePerCharMs);
    expect(bubbleDurationMs('x'.repeat(80))).toBe(CHAT_CONFIG.bubbleMaxMs);
    expect(bubbleDurationMs('court')).toBeLessThan(bubbleDurationMs('un message nettement plus long'));
    expect(bubbleCapFromSearch('?bubbles=3')).toBe(3);
    expect(bubbleCapFromSearch('?bubbles=0')).toBeNull();
    expect(bubbleCapFromSearch('?x=1')).toBeNull();
  });
});
