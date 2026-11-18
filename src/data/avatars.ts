/** Data-driven avatar definitions. Add a new base body here; no code change needed in the renderer. */
export type RigId = 'mixamo';
export interface AvatarDef {
  id: string; label: string; url: string; /** body-part labels & landmarks (tools/fashion/build_parts.py) */ parts: string; rig: RigId; facing: 'negZ' | 'posZ'; tagColor: string;
  sitForward: number; // metres the hips sit in front of the seat centre (avoid legs clipping into box sofas)
  scale: number;      // visual scale vs the authored 0.96 m model (checked against door opening 1.18 m, fridge 1.10 m, sofa seat)
}
import { VARIANT } from '../app/variant';
/** V1: +10%: avatar 0.96 m -> 1.06 m = 90% of the door opening (1.18 m), just under the fridge top (1.10 m). See docs/POLISH_AUDIT.md.
 *  ?v=2|3 use 1.14 (1.09 m = 93% of the door). See docs/COMPARE_V.md. */
export const AVATAR_SCALE = VARIANT.scale;
export const AVATARS: Record<string, AvatarDef> = {
  f: { id: 'f', label: 'Femme (Juanita)', url: import.meta.env.BASE_URL + 'models/avatars/juanita_female.glb', parts: import.meta.env.BASE_URL + 'models/avatars/juanita_female.parts.json', rig: 'mixamo', facing: 'negZ', tagColor: '#e2569b', sitForward: 0.13, scale: AVATAR_SCALE },
  m: { id: 'm', label: 'Homme (Juan)', url: import.meta.env.BASE_URL + 'models/avatars/juanita_male.glb', parts: import.meta.env.BASE_URL + 'models/avatars/juanita_male.parts.json', rig: 'mixamo', facing: 'negZ', tagColor: '#4f8be0', sitForward: 0.13, scale: AVATAR_SCALE },
};
/** Shared animation library (Quaternius 23-bone, CC0) retargeted at runtime onto each avatar. */
export const ANIM_LIBRARY = import.meta.env.BASE_URL + 'models/anim/QACP_Casual_Female_23bones.glb';
export const CLIPS = { idle: 'Idle', walk: 'Walk', run: 'Run', sit: 'SitDown', stand: 'StandUp', emote: 'Victory' } as const;
export type ClipKey = keyof typeof CLIPS;
/** Shared atlas label mask (both bodies use the same UV layout). */
export const ATLAS_MASK = import.meta.env.BASE_URL + 'models/avatars/atlas_mask.png';
