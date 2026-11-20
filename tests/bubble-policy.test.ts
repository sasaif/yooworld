import { describe, expect, it } from 'vitest';
import { BUBBLE_CAP, bubblePriority, pickSpeechBubbles, type BubbleCandidate } from '../src/game/social/bubblePolicy';

const c = (id: string, priority: BubbleCandidate['priority'], at: number, text = id): BubbleCandidate => ({ id, text, at, priority });

describe('speech-bubble cap (~20 users)', () => {
  it('keeps the cap at 6 and prefers self > nearby > friends > others', () => {
    expect(BUBBLE_CAP).toBe(6);
    const many: BubbleCandidate[] = [
      c('me', 'self', 1),
      ...[1, 2, 3, 4].map((i) => c('n' + i, 'nearby', i)),
      ...[1, 2, 3].map((i) => c('f' + i, 'friends', i)),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => c('o' + i, 'other', i)),
    ];
    const { shown, collapsedIds } = pickSpeechBubbles(many, 6);
    expect(shown.map((s) => s.id)).toEqual(['me', 'n4', 'n3', 'n2', 'n1', 'f3']);
    expect(shown).toHaveLength(6);
    // leftover friends simply do not get a bubble; leftover "others" collapse to "…"
    expect(collapsedIds.sort()).toEqual(['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8']);
  });

  it('one bubble per avatar (latest text wins)', () => {
    const { shown, collapsedIds } = pickSpeechBubbles([
      c('me', 'self', 1, 'old'),
      c('me', 'self', 5, 'new'),
      c('n1', 'nearby', 2, 'hi'),
    ], 6);
    expect(shown).toHaveLength(2);
    expect(shown.find((s) => s.id === 'me')?.text).toBe('new');
    expect(collapsedIds).toEqual([]);
  });

  it('collapses leftover others into collapsedIds and reserves a slot when others overflow the remainder', () => {
    const { shown, collapsedIds } = pickSpeechBubbles([
      c('me', 'self', 9),
      c('n1', 'nearby', 8),
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => c('o' + i, 'other', i)),
    ], 6);
    // self + nearby + 3 others + collapse (ids of the leftover others)
    expect(shown.map((s) => s.id)).toEqual(['me', 'n1', 'o7', 'o6', 'o5']);
    expect(shown).toHaveLength(5);
    expect(collapsedIds.sort()).toEqual(['o1', 'o2', 'o3', 'o4'].sort());
  });

  it('shows all others when they fit, and bubblePriority matches the local relation lists', () => {
    const { shown, collapsedIds } = pickSpeechBubbles([
      c('me', 'self', 1), c('a', 'other', 2), c('b', 'other', 3),
    ], 6);
    expect(shown).toHaveLength(3); expect(collapsedIds).toEqual([]);
    expect(bubblePriority('me', 'me', ['n'], ['f'])).toBe('self');
    expect(bubblePriority('n', 'me', ['n'], ['f'])).toBe('nearby');
    expect(bubblePriority('f', 'me', ['n'], ['f'])).toBe('friends');
    expect(bubblePriority('x', 'me', ['n'], ['f'])).toBe('other');
  });
});
