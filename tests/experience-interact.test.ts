import { describe, expect, it, beforeEach } from 'vitest';
import { legDrop } from '../src/data/furnitureReshape';
import * as THREE from 'three';
import { FURNITURE } from '../src/data/furniture';
import { defaultApartment } from '../src/data/defaultApartment';
import { computeSeats, freeSeat, seatFacing, syncWorld } from '../src/game/apartment/worldSync';
import { BUTT, HIP_H, LIE_LIFT, LIE_PITCH, hipsY, legacySitY, lieRoot, sitRoot } from '../src/game/interact/anchors';
import { actionsFor } from '../src/game/interact/interactions';
import { makeChar, world } from '../src/game/world';

const SCALE = 1.14; // V3 default avatar scale
describe('seat anchors (sit / lie bug fixes)', () => {
  const apt = defaultApartment('t'); const seats = computeSeats(apt, FURNITURE);
  // Option C (Nov 2026): the legs of the chairs, stool and sofas were shortened (data/furnitureReshape.ts); measured cushion
  // heights of the original models: sofa 0.276, chair 0.288, desk chair 0.28, stool 0.522 → minus the declared leg drop
  it('every seat of the starter flat has a measured anchor and surface height (original cushion − declared leg drop)', () => {
    for (const s of seats) { expect(s.hip).toBeDefined(); expect(s.h).toBeGreaterThan(0.19); }
    expect(FURNITURE.chair.seat!.h).toBeCloseTo(0.288 - legDrop('chair'), 6); expect(FURNITURE.loungeSofa.seat!.h).toBeCloseTo(0.276 - legDrop('loungeSofa'), 6);
    expect(FURNITURE.stoolBar.seat!.h).toBeCloseTo(0.522 - legDrop('stoolBar'), 6);
  });
  it('the reshaped seats: chair 0.195, desk chair 0.195, bar stool 0.422, sofa / armchair 0.216 m', () => {
    expect(FURNITURE.chair.seat!.h).toBeCloseTo(0.195, 3); expect(FURNITURE.chairDesk.seat!.h).toBeCloseTo(0.195, 3); expect(FURNITURE.stoolBar.seat!.h).toBeCloseTo(0.422, 3);
    expect(FURNITURE.loungeSofa.seat!.h).toBeCloseTo(0.216, 3); expect(FURNITURE.loungeChair.seat!.h).toBeCloseTo(0.216, 3);
  });
  it('hips rest exactly BUTT above the real cushion height, whatever the seat (sofa 0.216, chair 0.195, stool 0.422, bed 0.30)', () => {
    for (const [defId, h] of [['loungeSofa', 0.276 - legDrop('loungeSofa')], ['chair', 0.288 - legDrop('chair')], ['stoolBar', 0.522 - legDrop('stoolBar')], ['bedDouble', 0.3]] as const) {
      const lay = { ...apt, items: [{ uid: 'x', defId, x: 8, z: 8, rot: 0 as const }] }; const s = computeSeats(lay, FURNITURE).find((q) => q.pose === 'sit')!;
      const root = sitRoot(s, SCALE, 0.13, new THREE.Vector3()); expect(hipsY(root.y, SCALE)).toBeCloseTo(h + BUTT, 6);
    }
  });
  it('the old bug: a single height for every seat put the hips 0.25 m under the bar-stool cushion', () => {
    expect(legacySitY(SCALE) + HIP_H * SCALE).toBeLessThan(0.522 - 0.2); // the original 0.522 m stool
    expect(legacySitY(SCALE) + HIP_H * SCALE).toBeLessThan(FURNITURE.stoolBar.seat!.h! - 0.1); // still 0.1 m under the lowered one
  });
  it('wooden chair: hips over the 0.24 m seat, not in front of it (old: 0.18 m in front of the centre)', () => {
    const lay = { ...apt, items: [{ uid: 'c', defId: 'chair', x: 8, z: 8, rot: 1 as const }] }; const s = computeSeats(lay, FURNITURE)[0];
    const root = sitRoot(s, SCALE, 0.13, new THREE.Vector3()); const centre = new THREE.Vector3(8 * 0.3 + 0.15, 0, 8 * 0.3 + 0.15);
    expect(Math.hypot(root.x - centre.x, root.z - centre.z)).toBeLessThan(FURNITURE.chair.size.d / 2);
  });
  it('the bed offers 2 lying spots (feet at the foot end, on the mattress) besides the 2 edge seats', () => {
    const bed = apt.items.find((i) => i.defId === 'bedDouble')!; const bs = seats.filter((s) => s.id.startsWith(bed.uid + ':'));
    expect(bs.filter((s) => s.pose === 'lie')).toHaveLength(2); expect(bs.filter((s) => s.pose === 'sit')).toHaveLength(2);
    const lie = bs.find((s) => s.pose === 'lie')!; expect(lieRoot(lie, SCALE, new THREE.Vector3()).y).toBeCloseTo(0.3 + LIE_LIFT * SCALE, 6);
    expect(LIE_PITCH).toBeLessThan(-1.2); expect(LIE_PITCH).toBeGreaterThan(-Math.PI / 2);
  });
  it('a bed slot is one place: lying on spot 0 also takes the edge seat 0', () => {
    world.chars = { f: makeChar('f', 'A', 3, 3), m: makeChar('m', 'B', 3.5, 3) }; syncWorld(apt, FURNITURE);
    const bed = apt.items.find((i) => i.defId === 'bedDouble')!;
    const l0 = freeSeat(bed.uid, new THREE.Vector3(3, 0, 4), 'm', 'lie')!; world.chars.m.sitOn = l0;
    const s = freeSeat(bed.uid, new THREE.Vector3(3, 0, 4), 'f', 'sit')!; expect(s.id.replace(':', ':L')).not.toBe(l0.id);
  });
});

describe('interaction registry', () => {
  it('bed: S’allonger + S’asseoir; TV: Regarder la télé; stool: S’asseoir; every item can be moved', () => {
    const ids = (d: string) => actionsFor(FURNITURE[d]).map((a) => a.id);
    expect(ids('bedDouble')).toEqual(expect.arrayContaining(['lie', 'sitEdge', 'move']));
    expect(ids('televisionModern')).toEqual(expect.arrayContaining(['watch', 'tv']));
    expect(ids('stoolBar')).toContain('sit'); for (const d of Object.keys(FURNITURE)) expect(ids(d)).toContain('move');
  });
  it('labels follow the on/off state', () => {
    expect(actionsFor(FURNITURE.televisionModern, true).find((a) => a.id === 'tv')!.label).toMatch(/Éteindre/);
    expect(actionsFor(FURNITURE.lampRoundFloor, false).find((a) => a.id === 'light')!.label).toMatch(/Allumer/);
  });
});

describe('watch TV', () => {
  beforeEach(() => { world.chars = { f: makeChar('f', 'A', 3, 3), m: makeChar('m', 'B', 3.5, 3) }; });
  it('in the starter flat the armchair faces the TV and is chosen', () => {
    const apt = defaultApartment('t'); syncWorld(apt, FURNITURE);
    const tv = apt.items.find((i) => i.defId === 'televisionModern')!; const tvPos = new THREE.Vector3(0.3, 0, 1.65);
    const s = seatFacing(tvPos, new THREE.Vector3(3, 0, 3), 'f')!; const chair = apt.items.find((i) => i.defId === 'loungeChair')!;
    expect(s.id.startsWith(chair.uid + ':')).toBe(true); expect(tv).toBeDefined();
  });
  it('no seat facing the TV -> none (the game walks in front of it instead)', () => {
    const apt = { ...defaultApartment('t'), items: defaultApartment('t').items.filter((i) => i.defId !== 'loungeChair' && i.defId !== 'chair') }; syncWorld(apt, FURNITURE);
    expect(seatFacing(new THREE.Vector3(0.3, 0, 1.65), new THREE.Vector3(3, 0, 3), 'f')).toBeUndefined();
  });
});
