import type { GameController } from '../game/GameController';
import type { SimTransport } from '../net/SimTransport';
import { world } from '../game/world';
/** LOCAL SIMULATION harness for the chat (window.__chatSim, only with ?chatSim=…). Clearly NOT multiplayer:
 *  simulated senders are ids with a position (no rendered avatar, no network); rendered local characters (Juan,
 *  PNJ) can also be made to "receive" a message so their bubble shows. Everything goes through the real
 *  SimTransport -> LocalChatService -> ChatStore -> BubbleDirector path. */
export function installChatSim(game: GameController, net: SimTransport) {
  let n = 0; let counter = 0; const sent: { t: 'chat'; id: string; playerId: string; text: string; at: number }[] = [];
  const me = () => world.chars[game.s.activeChar]?.pos ?? { x: 0, z: 0 };
  const api = {
    label: 'LOCAL SIMULATION (same browser, no server)',
    broadcasting: net.broadcasting, tabId: net.tabId,
    /** n simulated senders sim_1..sim_n on rings 1..9 m around the player */
    players(count: number) {
      for (let i = 1; i <= count; i++) {
        const a = (i / count) * Math.PI * 2, r = 1 + ((i * 7) % 9); const p = me();
        game.virtualSpeakers.set(`sim_${i}`, { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, name: `Sim ${i}` });
      }
      n = count; return [...game.virtualSpeakers.keys()];
    },
    /** a "received" message (as a network message would arrive) */
    receive(from: string, text: string, opts: { at?: number; id?: string } = {}) {
      const m = { t: 'chat' as const, playerId: from, text, at: opts.at ?? Date.now(), id: opts.id ?? `${from}:sim:${++counter}` };
      sent.push(m); net.receive(m); return m.id;
    },
    /** `count` messages round-robin over the simulated senders (and optional extra ids) */
    burst(count: number, extra: string[] = []) {
      const ids = [...Array.from({ length: n }, (_, i) => `sim_${i + 1}`), ...extra];
      const t0 = Date.now();
      for (let i = 0; i < count; i++) api.receive(ids[i % ids.length], `msg ${i + 1} de ${ids[i % ids.length]}`, { at: t0 + i });
      return count;
    },
    /** reconnect: the server replays the last k messages with the same ids (must not duplicate) */
    replay(k: number) { for (const m of sent.slice(-k)) net.receive({ ...m }); return k; },
    stats() { return { ...game.bubbles.snapshot(), history: game.chat.history().length, ids: new Set(game.chat.history().map((m) => m.id)).size }; },
  };
  (window as unknown as Record<string, unknown>).__chatSim = api;
  return api;
}
