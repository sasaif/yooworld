import { ITEMS } from '../../../fashion/catalogue';
import type { AccModel, BeardStyle, FaceMorph, HairStyle, Look, Pattern, Print } from '../../../fashion/types';
/** Look (item ids) -> concrete render parameters. Pure & unit-tested; the renderer only reads this. */
export interface ClothSpec { color: string; color2?: string; pattern: Pattern }
export interface RenderSpec {
  body: 'f' | 'm'; skin: string; eyeColor: string; hairColor: string; hairColor2?: string;
  morph: Partial<Record<FaceMorph, number>>; hair: HairStyle; beard: BeardStyle;
  lips: { w: number; h: number; bow: number; color?: string; gloss?: boolean };
  decals: { kind: 'freckles' | 'mole' | 'blush' | 'glow' | 'star'; color: string }[];
  shadow?: string; liner?: string;
  top: ClothSpec & { print: Print; sleeve: 'long' | 'short' | 'tank' };
  jacket?: ClothSpec & { trim: string; extra: 'hood' | 'fur' | 'none' };
  pants: ClothSpec & { length: 'long' | 'short' };
  shoes: { color: string; color2: string; shaft?: 'boot' | 'high'; glow?: number };
  acc: { model: AccModel; color: string; color2?: string }[];
  /** face v2 options (absent = classic face) */ faceV2?: { smile: boolean; sparkle: boolean };
}
export function resolveLook(look: Look): RenderSpec {
  const g = (slot: keyof Look['slots']) => { const id = look.slots[slot]; return id ? ITEMS[id] : undefined; };
  const r = (slot: keyof Look['slots']) => g(slot)?.render ?? {};
  const morph: RenderSpec['morph'] = {};
  for (const s of ['faceShape', 'eyes', 'brows', 'nose', 'mouth'] as const) Object.assign(morph, r(s).morph ?? {});
  const lipsR = r('mouth').lips ?? { w: 1, h: 1, bow: 0.5 }; const lipItem = r('makeup.lips');
  const top = r('top'); const jk = g('jacket'); const pants = r('pants'); const shoes = r('shoes');
  const decals: RenderSpec['decals'] = [];
  for (const s of ['details.blush', 'details.freckles', 'details.mole', 'details.sticker'] as const) { const d = r(s); if (d.decal) decals.push({ kind: d.decal, color: d.color ?? '#ff8080' }); }
  const acc: RenderSpec['acc'] = [];
  for (const [slot, id] of Object.entries(look.slots)) if (slot.startsWith('acc.') && id) { const it = ITEMS[id]; if (it?.render.acc) acc.push({ model: it.render.acc, color: it.render.color ?? '#ffffff', color2: it.render.color2 }); }
  return {
    body: look.body, skin: r('skin').color ?? '#efc3a5', eyeColor: r('eyeColor').color ?? '#6b3d1f', hairColor: r('hairColor').color ?? '#4a2c22', hairColor2: r('hairColor').color2,
    morph, hair: r('hair').hair ?? (look.body === 'f' ? 'buns' : 'quiff'), beard: look.body === 'm' ? r('beard').beard ?? 'none' : 'none',
    lips: { ...lipsR, color: lipItem.color, gloss: lipItem.gloss }, decals, shadow: r('makeup.eyes').color, liner: r('makeup.liner').color,
    top: { color: top.color ?? '#f2f1e8', color2: top.color2, pattern: top.pattern ?? 'none', print: top.print ?? 'none', sleeve: top.sleeve ?? 'short' },
    jacket: jk ? { color: jk.render.color!, color2: jk.render.color2, pattern: jk.render.pattern ?? 'none', trim: jk.render.trim ?? jk.render.color!, extra: jk.render.extra ?? 'none' } : undefined,
    pants: { color: pants.color ?? '#2d2a33', color2: pants.color2, pattern: pants.pattern ?? 'none', length: pants.length ?? 'long' },
    shoes: { color: shoes.color ?? '#cfe05a', color2: shoes.color2 ?? '#ffffff', shaft: shoes.shaft, glow: shoes.glow },
    acc,
    faceV2: r('mouth').face?.smile || r('eyes').face?.sparkle ? { smile: !!r('mouth').face?.smile, sparkle: !!r('eyes').face?.sparkle } : undefined,
  };
}
/** Hats flatten voluminous hair: the hair renderer swaps to a cap-friendly variant. */
export const HAT_MODELS: AccModel[] = ['cap', 'beanie', 'strawhat', 'crown'];
export const hasHat = (s: RenderSpec) => s.acc.some((a) => HAT_MODELS.includes(a.model));
