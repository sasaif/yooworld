/** Data-driven avatar definitions. Add a new base body here; no code change needed in the renderer. */
export type RigId = 'mixamo';
export interface AvatarDef {
  id: string; label: string; url: string; rig: RigId; facing: 'negZ' | 'posZ'; tagColor: string;
  sitForward: number; // metres the hips sit in front of the seat centre (avoid legs clipping into box sofas)
}
export const AVATARS: Record<string, AvatarDef> = {
  f: { id: 'f', label: 'Femme (Juanita)', url: '/models/avatars/juanita_female.glb', rig: 'mixamo', facing: 'negZ', tagColor: '#e2569b', sitForward: 0.13 },
  m: { id: 'm', label: 'Homme (Juan)', url: '/models/avatars/juanita_male.glb', rig: 'mixamo', facing: 'negZ', tagColor: '#4f8be0', sitForward: 0.13 },
};
/** Shared animation library (Quaternius 23-bone, CC0) retargeted at runtime onto each avatar. */
export const ANIM_LIBRARY = '/models/anim/QACP_Casual_Female_23bones.glb';
export const CLIPS = { idle: 'Idle', walk: 'Walk', run: 'Run', sit: 'SitDown', stand: 'StandUp', emote: 'Victory' } as const;
export type ClipKey = keyof typeof CLIPS;
