import { CHAT_CONFIG, type ChatConfig } from './chatConfig';
import { pickSpeechBubbles, type BubbleCandidate } from './bubblePolicy';

/** Runtime owner of every speech bubble (world.say() is routed here). Applies the neutral pick to the characters'
 *  `say` slot, so the cap really holds in the rendering path. No React, no three: positions come from `locate`,
 *  on-screen tests from `onScreen` (optional). Ticked a few times per second (not per frame). */
export interface SayTarget { say?: { text: string; until: number } }
export interface DirectorDeps {
  now?: () => number;
  /** character slot to write the bubble into (null = no avatar rendered for that id: logic only, e.g. a simulated sender) */
  target: (id: string) => SayTarget | null | undefined;
  locate: (id: string) => { x: number; z: number } | null | undefined;
  selfId: () => string;
  onScreen?: (id: string) => boolean | undefined;
  config?: Pick<ChatConfig, 'maxVisibleBubbles' | 'queueTtlMs' | 'proximityBandM'>;
}
interface Entry { id: string; text: string; seq: number; ms: number; at: number; until: number; visible: boolean }
export interface BubbleStats { visible: string[]; queued: string[]; requested: number; shownTotal: number; expiredUnshown: number; cap: number }

export class BubbleDirector {
  private entries = new Map<string, Entry>();
  private seq = 0;
  private stats = { requested: 0, shownTotal: 0, expiredUnshown: 0 };
  private readonly now: () => number;
  constructor(private deps: DirectorDeps) { this.now = deps.now ?? (() => performance.now()); }
  setOnScreen(fn: DirectorDeps['onScreen']) { this.deps.onScreen = fn; }
  private get cfg() { return this.deps.config ?? CHAT_CONFIG; }

  /** world.say(id, text, ms) lands here. Returns whether the bubble is visible right now. */
  request(id: string, text: string, ms: number): 'shown' | 'queued' {
    const now = this.now(); this.stats.requested++;
    const prev = this.entries.get(id);
    // same avatar speaks again: replace its text (latest wins), keep its slot when it already had one
    const e: Entry = { id, text, ms, seq: ++this.seq, at: now, until: prev?.visible ? now + ms : 0, visible: !!prev?.visible };
    this.entries.set(id, e);
    this.update(now);
    return this.entries.get(id)?.visible ? 'shown' : 'queued';
  }

  /** Expire, re-pick, write the character slots. Cheap; call every ~250 ms and on each request. */
  update(now = this.now()) {
    const ttl = this.cfg.queueTtlMs;
    for (const e of [...this.entries.values()]) {
      if (e.visible && e.until <= now) { this.entries.delete(e.id); this.clearSlot(e.id, e.text); }
      else if (!e.visible && now - e.at > ttl) { this.entries.delete(e.id); this.stats.expiredUnshown++; }
    }
    const me = this.deps.selfId(); const meAt = this.deps.locate(me);
    const cands: BubbleCandidate[] = [...this.entries.values()].map((e) => {
      const p = this.deps.locate(e.id);
      const dist = e.id === me ? 0 : p && meAt ? Math.hypot(p.x - meAt.x, p.z - meAt.z) : Infinity;
      return { id: e.id, text: e.text, seq: e.seq, dist, visible: e.visible, onScreen: this.deps.onScreen?.(e.id) };
    });
    const pick = pickSpeechBubbles(cands, { cap: this.cfg.maxVisibleBubbles, selfId: me, bandM: this.cfg.proximityBandM });
    const show = new Set(pick.shown.map((c) => c.id));
    for (const e of this.entries.values()) {
      if (show.has(e.id)) {
        if (!e.visible) { e.visible = true; e.until = now + e.ms; this.stats.shownTotal++; }
        const t = this.deps.target(e.id); if (t && (t.say?.text !== e.text || t.say.until !== e.until)) t.say = { text: e.text, until: e.until };
      } else if (e.visible) {
        // bumped (only by the local player's own message): back to waiting, its text is in the history
        e.visible = false; e.at = now; this.clearSlot(e.id, e.text);
      } else this.clearSlot(e.id, e.text);
    }
  }
  private clearSlot(id: string, text: string) { const t = this.deps.target(id); if (t?.say && t.say.text === text) t.say = undefined; }

  /** Location changed / characters respawned: forget pending bubbles. */
  reset() { for (const e of this.entries.values()) if (e.visible) this.clearSlot(e.id, e.text); this.entries.clear(); }
  snapshot(): BubbleStats {
    const v = [...this.entries.values()];
    return { visible: v.filter((e) => e.visible).map((e) => e.id), queued: v.filter((e) => !e.visible).map((e) => e.id), ...this.stats, cap: this.cfg.maxVisibleBubbles };
  }
}
