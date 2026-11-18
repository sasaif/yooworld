import type { Body } from '../fashion/types';
import { Html } from '@react-three/drei';
import { fashion, game } from '../app/services';
import { FURNITURE } from '../data/furniture';
import { world } from '../game/world';
import { baseHeight, itemTransform, type ApartmentLayout, type PlacedItem } from '../game/apartment/ApartmentModel';

/** Contextual actions for a tapped object (play mode). Actions come from the item's `interaction` type. */
export function InteractionMenu({ it, apt }: { it: PlacedItem; apt: ApartmentLayout }) {
  const d = FURNITURE[it.defId]; const t = itemTransform(it, FURNITURE); const y = baseHeight(apt, FURNITURE, it) + d.size.h + 0.12;
  const A: [string, () => void][] = [];
  if (d.interaction === 'sit') A.push(['🪑 S’asseoir', () => game.interact(it.uid, 'sit')]);
  if (d.interaction === 'bed') A.push(['🛏️ S’asseoir sur le lit', () => game.interact(it.uid, 'sit')]);
  if (d.interaction === 'light') A.push([it.on ? '🌙 Éteindre' : '💡 Allumer', () => game.interact(it.uid, 'toggle')]);
  if (d.interaction === 'tv') A.push([it.on ? '📴 Éteindre la télé' : '📺 Allumer la télé', () => game.interact(it.uid, 'toggle')]);
  if (d.interaction === 'music') {
    A.push([it.on ? '🔇 Couper la musique' : '🎵 Mettre de la musique', () => game.interact(it.uid, 'toggle')]);
    A.push(['💃 Danser', () => { if (!it.on) game.interact(it.uid, 'toggle'); if (!world.chars[game.s.activeChar]?.emote) game.toggleEmote(); game.store.set({ menuItem: null }); }]);
  }
  if (d.interaction === 'fridge') A.push(['🍓 Prendre un snack', () => game.interact(it.uid, 'snack')]);
  if (d.id === 'coatRackStanding') A.push(['👗 Garde-robe', () => { game.store.set({ menuItem: null }); fashion.open(game.s.activeChar as Body, 'tshirt', 'owned'); }]);
  if (d.interaction === 'look' || !d.interaction) A.push(['👀 Regarder', () => game.interact(it.uid, 'look')]);
  A.push(['✥ Déplacer', () => game.interact(it.uid, 'edit')]);
  return (
    <Html position={[t.x, y, t.z]} center zIndexRange={[40, 20]}>
      <div className="imenu" onPointerDown={(e) => e.stopPropagation()}>
        <div className="imenu-title">{d.name}</div>
        {A.map(([label, fn]) => <button key={label} className="btn" onClick={fn}>{label}</button>)}
      </div>
    </Html>
  );
}
