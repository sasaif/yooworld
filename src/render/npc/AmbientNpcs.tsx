import { useFrame } from '@react-three/fiber';
import { useStore } from '../../core/store';
import { game } from '../../app/services';
import { world } from '../../game/world';
import { Character } from '../Character';
import { listAmbient, npcDef, stepAmbientNpcs } from '../../game/npc/ambientNpcs';

const noop = () => {};

/** Lite PNJ avatars in the current scene (max 2). AI is stepped here; no extra draw when the roster is empty. */
export function AmbientNpcs() {
  const ready = useStore(game.store, (s) => s.ready);
  useStore(game.store, (s) => s.location); // re-render when travel respawns the roster
  useFrame(() => { if (ready) stepAmbientNpcs(performance.now()); });
  if (!ready) return null;
  return (
    <>
      {listAmbient().map((n) => {
        const c = world.chars[n.id]; if (!c) return null;
        return <Character key={n.id} c={c} def={npcDef(n)} look={n.look} selected={false} onSelect={noop} npcLabel="PNJ" lite />;
      })}
    </>
  );
}
