/** Five social facial expressions (Phase A). Weights drive blendshapes that already ship in both GLBs (CC0 VRM-style
 *  `blendShape2.*`) plus additive deltas on the game's own procedural face morphs (`yw_*`, see faceMorphs.ts).
 *  Values = the v2 prototype (art/proposals/v2/scripts/v2.mjs `EX`), with "surprised" reinforced for 93 px. */
export type Expression = 'happy' | 'angry' | 'sad' | 'surprised' | 'wink';
export const EXPRESSIONS: Expression[] = ['happy', 'angry', 'sad', 'surprised', 'wink'];
/** VRM blendshapes this layer owns while an expression is shown (their suffix after "blendShape2."). */
export const VRM_KEYS = ['Blink_L', 'Blink_R', 'happy', 'joy', 'angry', 'sorrow', 'mouth_a', 'mouth_e', 'mouth_i', 'mouth_o', 'mouth_u'] as const;
export type VrmKey = typeof VRM_KEYS[number];
/** Procedural morphs used additively on top of the look's own value (e.g. a player with "Grands yeux" keeps them). */
export const YW_KEYS = ['yw_eyeBig', 'yw_browArch'] as const;
export type YwKey = typeof YW_KEYS[number];
export type ExprKey = VrmKey | YwKey;
export interface ExpressionPreset {
  label: string; emoji: string;
  /** absolute target of the VRM keys (missing = 0) */ vrm: Partial<Record<VrmKey, number>>;
  /** added to the look's procedural morph value, clamped to [0,1] */ yw?: Partial<Record<YwKey, number>>;
  /** small mark shown above the name tag (DOM, crisp at any scale) */ indicator?: string;
}
export const PRESETS: Record<Expression, ExpressionPreset> = {
  happy: { label: 'Content', emoji: '😊', vrm: { happy: 1.0, mouth_a: 0.3, mouth_i: 0.15 } },
  angry: { label: 'Fâché', emoji: '😠', vrm: { angry: 0.9, mouth_e: 0.15 } },
  sad: { label: 'Triste', emoji: '😢', vrm: { sorrow: 0.9, mouth_u: 0.12 } },
  // prototype: mouth_o 1 + mouth_a .35 + eyeBig 1 + browArch .9 was the weakest at 93 px -> wider "o" (mouth_a .5),
  // brows fully up, and a "!" mark (the reliable cue at 93 px)
  surprised: { label: 'Surpris', emoji: '😮', vrm: { mouth_o: 1.0, mouth_a: 0.5 }, yw: { yw_eyeBig: 1.0, yw_browArch: 1.0 }, indicator: '!' },
  wink: { label: 'Clin d’œil', emoji: '😉', vrm: { Blink_L: 1.0, happy: 0.45 } },
};
/** Timing (s). Hold ≈ 2.5 s then a smooth return to the normal face. */
export const TIMING = { duration: 2.5, fadeIn: 0.18, fadeOut: 0.5, morphGlide: 10 } as const;
/** Share of the lip flap (speech bubble) kept on mouth keys during an expression, so talking still reads. */
export const TALK_KEEP = 0.7;
