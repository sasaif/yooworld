/** Visual size / framing variants for the A/B comparison asked by the owner (?v=1|2|3). Pure + unit-tested.
 *  scale   = avatar model scale vs the authored 0.96 m model (door opening 1.18 m, fridge 1.10 m)
 *  zoomMul = multiplier on the fitted "whole apartment" zoom (1 = room fitted to the screen)
 *  follow  = how much the camera target leans towards the room centre while following (0 = centred on the avatar) */
export type VariantId = 1 | 2 | 3;
export interface Variant { id: VariantId; label: string; scale: number; zoomMul: number; follow: number }
export const VARIANTS: Record<VariantId, Variant> = {
  1: { id: 1, label: 'V1 · actuelle (≈75 px)', scale: 1.1, zoomMul: 1, follow: 0.22 },
  // 85 px on iPhone landscape: +3.6 % model scale (1.10 -> 1.14, still under the door) and +9.4 % camera zoom
  2: { id: 2, label: 'V2 · avatars ≈85 px', scale: 1.14, zoomMul: 1.094, follow: 0.22 },
  // V2 avatar size + closer framing centred on the avatars (crops a little of the room edges; the camera follows)
  3: { id: 3, label: 'V3 · caméra rapprochée', scale: 1.14, zoomMul: 1.2, follow: 0.12 },
};
export const DEFAULT_VARIANT: VariantId = 3;
export function parseVariant(search: string): VariantId {
  const v = Number(new URLSearchParams(search).get('v'));
  return v === 1 || v === 2 || v === 3 ? v : DEFAULT_VARIANT;
}
export const VARIANT: Variant = VARIANTS[typeof location !== 'undefined' ? parseVariant(location.search) : DEFAULT_VARIANT];
