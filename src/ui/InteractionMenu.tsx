import type { Body } from '../fashion/types';
import { Html } from '@react-three/drei';
import { fashion, game } from '../app/services';
import { FURNITURE } from '../data/furniture';
import { world } from '../game/world';
import { actionsFor, type ActionId } from '../game/interact/interactions';
import { baseHeight, itemTransform, type ApartmentLayout, type PlacedItem } from '../game/apartment/ApartmentModel';

/** Contextual actions for a tapped object (play mode). Actions come from the item's `interaction` type. */
export function InteractionMenu({ it, apt }: { it: PlacedItem; apt: ApartmentLayout }) {
  const d = FURNITURE[it.defId]; const t = itemTransform(it, FURNITURE); const y = baseHeight(apt, FURNITURE, it) + d.size.h + 0.12;
  const run: Record<ActionId, () => void> = {
    sit: () => game.interact(it.uid, 'sit'), sitEdge: () => game.interact(it.uid, 'sit'), lie: () => game.interact(it.uid, 'lie'),
    light: () => game.interact(it.uid, 'toggle'), tv: () => game.interact(it.uid, 'toggle'), watch: () => game.interact(it.uid, 'watch'),
    music: () => game.interact(it.uid, 'toggle'),
    dance: () => { if (!it.on) game.interact(it.uid, 'toggle'); if (!world.chars[game.s.activeChar]?.emote) game.toggleEmote(); game.store.set({ menuItem: null }); },
    snack: () => game.interact(it.uid, 'snack'),
    wardrobe: () => { game.store.set({ menuItem: null }); fashion.open(game.s.activeChar as Body, 'tshirt', 'owned'); },
    look: () => game.interact(it.uid, 'look'), move: () => game.interact(it.uid, 'edit'),
  };
  const A = actionsFor(d, !!it.on).map((a) => [a.label, run[a.id]] as [string, () => void]);
  return (
    <Html position={[t.x, y, t.z]} center zIndexRange={[40, 20]}>
      <div className="imenu" onPointerDown={(e) => e.stopPropagation()}>
        <div className="imenu-title">{d.name}</div>
        {A.map(([label, fn]) => <button key={label} className="btn" onClick={fn}>{label}</button>)}
      </div>
    </Html>
  );
}
