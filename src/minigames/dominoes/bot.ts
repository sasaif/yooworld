import type { BotPlayer } from '../types';
import type { DominoMove, DominoView } from './rules';

/**
 * "Facile" domino bot. It only ever returns one of the legal moves it is given (draw / pass are given to it by the rules
 * when nothing can be played). Policy: lay the heaviest tile (get rid of pips), doubles first on a tie, then a random
 * pick among equals (seeded RNG of the host). It sees only its own view: own hand + public line + tile counts.
 */
export function dominoBot(n: number): BotPlayer<DominoMove, DominoView> {
  return {
    id: `bot${n}`, label: `Bot ${n}`,
    pick(_view, legal, rng) {
      if (!legal.length) throw new Error('bot called without legal moves');
      const plays = legal.filter((m): m is Extract<DominoMove, { type: 'play' }> => m.type === 'play');
      if (!plays.length) return legal[0];
      const w = (m: (typeof plays)[number]) => (m.tile[0] + m.tile[1]) * 2 + (m.tile[0] === m.tile[1] ? 1 : 0);
      const best = Math.max(...plays.map(w)); const top = plays.filter((m) => w(m) === best);
      return top[Math.min(top.length - 1, Math.floor(rng() * top.length))];
    },
  };
}
