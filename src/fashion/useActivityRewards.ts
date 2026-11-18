import { useEffect, useRef } from 'react';
import { useStore } from '../core/store';
import { fashion, game } from '../app/services';
import { world } from '../game/world';
/** Gold earning hooks (documented rates in economy/rewards.ts): dancing and relaxing seated pay a little Gold
 *  per 30 s (daily caps), first visit of Yoo Plage each day pays a bonus. Local dev economy only. */
export function useActivityRewards() {
  const loc = useStore(game.store, (s) => s.location); const ready = useStore(game.store, (s) => s.ready); const first = useRef(true);
  useEffect(() => {
    if (!ready || new URLSearchParams(location.search).has('shot')) return;
    const STEP = 10; const id = setInterval(() => {
      if (fashion.s.studio || document.hidden) return; const c = world.chars[game.s.activeChar]; if (!c) return;
      if (c.mode === 'emote') void fashion.activity('dance', STEP); else if (c.mode === 'sitting') void fashion.activity('sit', STEP);
    }, STEP * 1000);
    return () => clearInterval(id);
  }, [ready]);
  useEffect(() => { if (!ready) return; if (first.current) { first.current = false; if (loc !== 'beach') return; } if (loc === 'beach') void fashion.activity('visit_beach', 0); }, [loc, ready]);
}
