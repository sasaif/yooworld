/**
 * Option C (owner, Nov 2026: "ajuste les meubles, sans allonger les tibias"): the chibi legs are short (ankle 0.09 m +
 * shin 0.08–0.09 m + thigh 0.12–0.15 m), so the seats come down to them instead of the skeleton growing.
 * Only the LEGS / base of each model are shortened: every vertex below `below` (m, kit scale, model resting on y = 0) is
 * scaled down by `drop`, everything above moves down by `drop`. Width, depth, cushion and backrest keep their size, so
 * nothing looks miniature. Seat heights in data/interactionRegistry.ts and the item heights follow from the same table.
 *
 * Bar stool: a foot ring at `ring.y` (top of the tube), radius `ring.r`, joined to the legs, where the feet rest.
 */
export interface LegReshape { below: number; drop: number; ring?: { y: number; r: number; tube: number; cz: number } }
export const LEG_RESHAPE: Record<string, LegReshape> = {
  chair: { below: 0.228, drop: 0.093 },                 // seat 0.288 → 0.195 m
  chairDesk: { below: 0.228, drop: 0.085 },             // seat 0.280 → 0.195 m (gas column + star base)
  stoolBar: { below: 0.426, drop: 0.10, ring: { y: 0.26, r: 0.21, tube: 0.012, cz: 0.07 } }, // seat 0.522 → 0.422 m
  loungeSofa: { below: 0.174, drop: 0.06 },             // cushion 0.276 → 0.216 m (feet + base)
  loungeSofaCorner: { below: 0.174, drop: 0.06 },
  loungeChair: { below: 0.174, drop: 0.06 },
};
export const legDrop = (model: string) => LEG_RESHAPE[model]?.drop ?? 0;
/** new height of a model-space vertex */
export function reshapeY(y: number, r: LegReshape) { return y <= r.below ? y * (r.below - r.drop) / r.below : y - r.drop; }
