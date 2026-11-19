/**
 * Furniture interaction registry (data only, unit-tested in tests/interaction-registry.test.ts).
 *
 * One entry per furniture type: which interactions it offers and, for every slot, where the body goes and which pose
 * preset (bone directions + transition timings) is used. Adding a new chair = one entry here + its cushion height
 * (tools/seat_heights.py); nothing in the renderer or the UI has to change.
 *
 * Units: metres / seconds / radians. Local frame of the model: x = right, z = forward (the side you sit facing).
 *  - sit slot: `x` lateral offset, `hipZ` forward position of the hips on the cushion, `h` real cushion height;
 *  - lie slot: `x` lateral offset, `footZ` local z of the feet, `h` mattress top; `edge` = index of the sit slot used to
 *    get onto the bed (you first sit on the edge, then lie back) — it is also "the same place" for occupancy.
 */
export type PresetId = 'stool' | 'chair' | 'deskChair' | 'sofa' | 'armchair' | 'bedEdge' | 'lie' | 'lounger';
export type SeatKind = 'chair' | 'stool' | 'sofa' | 'bed';
export type InteractionKind = 'sit' | 'lie' | 'watch' | 'use';
/** Bone directions of the seated layer (render/avatar/sitPose.ts). */
export interface SitStyle { droop: number; shinBack: number; splay: number; footDown: number; lean: number }
export interface PosePreset {
  kind: SeatKind; style: SitStyle;
  /** standing point (root) in front of the hips before sitting down, m along the seat's forward axis */
  approach: number;
  /** where the feet end up: on the floor, or dangling (chibi legs too short for a high or deep seat) */
  feet: 'floor' | 'dangle';
  /** durations (s): turn to face away from the seat (max, scaled by the angle), sit down, stand up */
  turn: number; sitIn: number; sitOut: number;
  /** lying only: recline from the bed edge onto the back / sit back up */
  recline?: number; unrecline?: number;
  /** Backrest pitch from upright (negative = reclined), independent of the flat leg support. */
  liePitch?: number;
  /** lying sub-curves as [start, end] fractions of the recline (default = bed: legs 0–0.55, back 0.05–0.85, hips 0.3–1) */
  lieCurve?: { legs: [number, number]; pitch: [number, number]; slide: [number, number] };
  /** Extra pelvis clearance during mount/dismount, metres (high stool front edge). */
  clearance?: number;
}
const D = Math.PI / 180;
export const PRESETS: Record<PresetId, PosePreset> = {
  lounger: { kind: 'bed', style: { droop: 0, shinBack: 0, splay: 0.06, footDown: 0, lean: 0 }, approach: 0.3, feet: 'floor', turn: 0.45, sitIn: 0.65, sitOut: 0.65, recline: 1.1, unrecline: 0.95, liePitch: -(Math.PI / 2 - 0.98), lieCurve: { legs: [0, 0.4], pitch: [0.1, 0.9], slide: [0.35, 1] } },
  stool: { clearance: 0.09, kind: 'stool', style: { droop: 2 * D, shinBack: 5 * D, splay: 0.12, footDown: 12 * D, lean: 3 * D }, approach: 0.28, feet: 'dangle', turn: 0.45, sitIn: 0.7, sitOut: 0.55 },
  chair: { kind: 'chair', style: { droop: 4 * D, shinBack: -4 * D, splay: 0.08, footDown: 0, lean: 0 }, approach: 0.2, feet: 'dangle', turn: 0.45, sitIn: 0.55, sitOut: 0.5 },
  deskChair: { kind: 'chair', style: { droop: 4 * D, shinBack: -4 * D, splay: 0.1, footDown: 0, lean: 0 }, approach: 0.22, feet: 'dangle', turn: 0.45, sitIn: 0.55, sitOut: 0.5 },
  sofa: { kind: 'sofa', style: { droop: 0, shinBack: -12 * D, splay: 0.1, footDown: 0, lean: -4 * D }, approach: 0.24, feet: 'floor', turn: 0.45, sitIn: 0.6, sitOut: 0.5 },
  armchair: { kind: 'sofa', style: { droop: 0, shinBack: -12 * D, splay: 0.1, footDown: 0, lean: -5 * D }, approach: 0.24, feet: 'floor', turn: 0.45, sitIn: 0.6, sitOut: 0.5 },
  bedEdge: { kind: 'bed', style: { droop: 2 * D, shinBack: -8 * D, splay: 0.08, footDown: 0, lean: 0 }, approach: 0.22, feet: 'floor', turn: 0.45, sitIn: 0.55, sitOut: 0.5 },
  lie: { kind: 'bed', style: { droop: 2 * D, shinBack: -8 * D, splay: 0.08, footDown: 0, lean: 0 }, approach: 0.22, feet: 'floor', turn: 0.45, sitIn: 0.55, sitOut: 0.5, recline: 1.1, unrecline: 0.9 },
};
export interface SitSlot { x: number; hipZ: number; h: number; preset: PresetId }
export interface LieSlot { x: number; footZ: number; h: number; edge: number }
export interface FurnitureInteractions {
  interactions: InteractionKind[];
  /** legacy `seat.depth`: where the "seat point" is (used to aim at a TV and to place the walk-to point) */
  depth?: number;
  sit: SitSlot[]; lie?: LieSlot[];
}
const sofa = (xs: number[], hipZ: number, h: number, preset: PresetId = 'sofa'): SitSlot[] => xs.map((x) => ({ x, hipZ, h, preset }));
export const INTERACTIONS: Record<string, FurnitureInteractions> = {
  loungeSofa: { interactions: ['sit', 'watch'], sit: sofa([-0.27, 0.27], 0.17, 0.276) },
  loungeDesignSofa: { interactions: ['sit', 'watch'], sit: sofa([-0.4, 0, 0.4], 0.17, 0.276) },
  loungeSofaCorner: { interactions: ['sit', 'watch'], sit: sofa([-0.32, 0.18], -0.16, 0.276) },
  loungeChair: { interactions: ['sit', 'watch'], sit: sofa([0], 0.17, 0.276, 'armchair') },
  chair: { interactions: ['sit', 'watch'], depth: 0.05, sit: [{ x: 0, hipZ: 0.12, h: 0.288, preset: 'chair' }] },
  chairDesk: { interactions: ['sit', 'watch', 'use'], sit: [{ x: 0, hipZ: 0.12, h: 0.28, preset: 'deskChair' }] },
  stoolBar: { interactions: ['sit'], sit: [{ x: 0, hipZ: 0.09, h: 0.522, preset: 'stool' }] },
  bedDouble: {
    interactions: ['sit', 'lie'], depth: 0.42,
    sit: [{ x: -0.25, hipZ: 0.62, h: 0.3, preset: 'bedEdge' }, { x: 0.25, hipZ: 0.62, h: 0.3, preset: 'bedEdge' }],
    lie: [{ x: -0.24, footZ: 0.42, h: 0.3, edge: 0 }, { x: 0.24, footZ: 0.42, h: 0.3, edge: 1 }],
  },
};
/** Legacy `FurnitureDef.seat` shape derived from the registry (kept for the catalogue, menus and old tests). */
export function legacySeat(id: string) {
  const c = INTERACTIONS[id]; const s0 = c.sit[0];
  return {
    slots: c.sit.map((s) => s.x), depth: c.depth, hipZ: s0.hipZ, h: s0.h, kind: PRESETS[s0.preset].kind,
    lie: c.lie ? { slots: c.lie.map((l) => l.x), footZ: c.lie[0].footZ, h: c.lie[0].h } : undefined,
  };
}
/** Static checks (unit tests): returns a list of problems, empty when the registry is valid. */
export function validateRegistry(sizes: Record<string, { w: number; d: number; h: number }>): string[] {
  const err: string[] = [];
  for (const [id, c] of Object.entries(INTERACTIONS)) {
    const sz = sizes[id]; if (!sz) { err.push(`${id}: unknown furniture`); continue; }
    if (!c.sit.length) err.push(`${id}: no sit slot`);
    if (c.interactions.includes('lie') !== !!c.lie?.length) err.push(`${id}: 'lie' interaction and lie slots disagree`);
    for (const [k, s] of c.sit.entries()) {
      const p = PRESETS[s.preset]; if (!p) { err.push(`${id}:${k}: unknown preset ${s.preset}`); continue; }
      if (Math.abs(s.x) > sz.w / 2) err.push(`${id}:${k}: slot outside the width`);
      if (Math.abs(s.hipZ) > sz.d / 2 + 0.05) err.push(`${id}:${k}: hips outside the depth`);
      if (!(s.h > 0.15 && s.h <= sz.h)) err.push(`${id}:${k}: cushion height ${s.h} not inside the model (0.15..${sz.h})`);
      if (!(p.sitIn >= 0.3 && p.sitIn <= 1 && p.sitOut >= 0.3 && p.sitOut <= 1 && p.turn > 0 && p.turn <= 0.8)) err.push(`${id}:${k}: transition durations out of range`);
      if (!(p.approach >= 0.12 && p.approach <= 0.4)) err.push(`${id}:${k}: approach distance out of range`);
    }
    // neighbours on a multi-seat sofa must not overlap (chibi body ≈ 0.34 m wide at scale 1.14)
    const xs = c.sit.map((s) => s.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < 0.34) err.push(`${id}: slots ${xs[i - 1]} / ${xs[i]} too close`);
    for (const [k, l] of (c.lie ?? []).entries()) {
      if (l.edge !== k || !c.sit[l.edge]) err.push(`${id}:L${k}: edge must be the sit slot with the same index`);
      if (!(PRESETS.lie.recline! >= 0.8 && PRESETS.lie.recline! <= 1.3)) err.push(`${id}:L${k}: recline duration out of range`);
      if (Math.abs(l.footZ) > sz.d / 2) err.push(`${id}:L${k}: feet off the bed`);
    }
  }
  return err;
}

/** Measured procedural transat, shared by beach seats and regression tests. Local +z points to the sea.
 * Mounted like the bed: sit on the foot end (entryZ, feet on the sand), then legs up onto the fabric, lie back
 * against the backrest (0.98 rad above the seat) while the hips scoot back to hipZ. Reclined 34°, the buttocks sit lower than the upright hips bone, so
 * the hips bone is lieClear above the fabric (in-game vertex probe: seat and backrest contact within 1 cm, Nov 2026). */
export const LOUNGER_ANCHOR = { h: 0.2275, hipZ: 0.03, entryZ: 0.36, lieClear: 0.133, front: 0.74, backAngle: 0.98 } as const;
