import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import bounds from '../src/data/furnitureBounds.json';
import { INTERACTIONS, PRESETS, legacySeat, validateRegistry } from '../src/data/interactionRegistry';
import { FURNITURE } from '../src/data/furniture';
import { defaultApartment } from '../src/data/defaultApartment';
import { computeSeats, freeSeat, syncWorld } from '../src/game/apartment/worldSync';
import { makeChar, world } from '../src/game/world';
import { approachOf, beginSeat, lieCurves, newSeatMotion, newSeatPose, seatPose, stepSeat, turnDuration } from '../src/game/interact/seatMotion';

describe('interaction registry (data-driven furniture interactions)', () => {
  it('is valid: slots inside the models, presets known, durations and spacing sane', () => {
    expect(validateRegistry(bounds as never)).toEqual([]);
  });
  it('covers every seat of the catalogue: chairs, stools, sofas, armchair, desk chair, bed', () => {
    for (const id of ['chair', 'chairDesk', 'stoolBar', 'loungeSofa', 'loungeDesignSofa', 'loungeSofaCorner', 'loungeChair', 'bedDouble']) expect(INTERACTIONS[id]).toBeDefined();
    for (const d of Object.values(FURNITURE)) if (d.interaction === 'sit' || d.interaction === 'bed') expect(INTERACTIONS[d.id], d.id).toBeDefined();
  });
  it('individually configured presets per furniture type', () => {
    expect(INTERACTIONS.stoolBar.sit[0].preset).toBe('stool'); expect(INTERACTIONS.chairDesk.sit[0].preset).toBe('deskChair');
    expect(INTERACTIONS.loungeChair.sit[0].preset).toBe('armchair'); expect(INTERACTIONS.bedDouble.sit[0].preset).toBe('bedEdge');
    expect(PRESETS.lie.recline).toBeGreaterThan(0.7);
  });
  it('multi-slot sofas (3 seats on the design sofa) and a double bed with 2 lying spots', () => {
    expect(INTERACTIONS.loungeDesignSofa.sit).toHaveLength(3); expect(INTERACTIONS.loungeSofa.sit).toHaveLength(2);
    expect(INTERACTIONS.bedDouble.lie).toHaveLength(2);
  });
  it('legacy catalogue `seat` is derived from the registry (one source of truth)', () => {
    expect(FURNITURE.stoolBar.seat).toEqual(legacySeat('stoolBar')); expect(FURNITURE.bedDouble.seat!.lie!.slots).toEqual([-0.24, 0.24]);
  });
  it('slot occupancy: two avatars can share the sofa and the double bed, a third one cannot lie down', () => {
    const apt = defaultApartment('t'); world.chars = { f: makeChar('f', 'A', 3, 3), m: makeChar('m', 'B', 3.5, 3), x: makeChar('x', 'C', 3.2, 3) }; syncWorld(apt, FURNITURE);
    const bed = apt.items.find((i) => i.defId === 'bedDouble')!; const at = new THREE.Vector3(3, 0, 4);
    const a = freeSeat(bed.uid, at, 'f', 'lie')!; world.chars.f.sitOn = a; const b = freeSeat(bed.uid, at, 'm', 'lie')!; world.chars.m.sitOn = b;
    expect(a.id).not.toBe(b.id); expect(freeSeat(bed.uid, at, 'x', 'lie')).toBeUndefined(); expect(freeSeat(bed.uid, at, 'x', 'sit')).toBeUndefined();
    const sofa = apt.items.find((i) => i.defId === 'loungeSofa')!; world.chars.f.sitOn = undefined; world.chars.m.sitOn = undefined;
    const s1 = freeSeat(sofa.uid, at, 'f')!; world.chars.f.sitOn = s1; const s2 = freeSeat(sofa.uid, at, 'm')!; expect(s2.id).not.toBe(s1.id);
  });
  it('every seat of the starter flat has a preset and an approach point on a free nav cell (blocked fronts -> side approach)', () => {
    const apt = defaultApartment('t'); world.chars = {}; syncWorld(apt, FURNITURE);
    for (const s of world.seats) { expect(s.preset).toBeDefined(); const [i, j] = world.nav!.toCell(s.front.x, s.front.z); expect(world.nav!.free(i, j), s.id).toBe(true); }
    expect(computeSeats(apt, FURNITURE).length).toBe(world.seats.length);
  });
});

describe('seat transitions (state machine, 60 fps steps)', () => {
  const apt = defaultApartment('t'); world.chars = {}; syncWorld(apt, FURNITURE);
  const sofa = world.seats.find((s) => s.preset === 'sofa')!; const lie = world.seats.find((s) => s.pose === 'lie')!;
  const run = (seat: typeof sofa, outAt = Infinity, frames = 400) => {
    const m = newSeatMotion(), o = newSeatPose(); const start = approachOf(seat, new THREE.Vector3()).addScaledVector(new THREE.Vector3(Math.sin(seat.yaw), 0, Math.cos(seat.yaw)), 0.12);
    beginSeat(m, seat, start, seat.yaw + Math.PI); let prev = { p: start.clone(), yaw: seat.yaw + Math.PI, w: 0, pitch: 0 }; const mx = { p: 0, yaw: 0, w: 0, pitch: 0 }; const phases: string[] = [];
    for (let f = 0; f < frames; f++) {
      const free = stepSeat(m, 1 / 60, f >= outAt); if (free) { phases.push('free'); break; } seatPose(m, o); if (phases[phases.length - 1] !== m.phase) phases.push(m.phase);
      mx.p = Math.max(mx.p, o.root.distanceTo(prev.p)); mx.yaw = Math.max(mx.yaw, Math.abs(Math.atan2(Math.sin(o.yaw - prev.yaw), Math.cos(o.yaw - prev.yaw))));
      mx.w = Math.max(mx.w, Math.abs(o.sitW - prev.w)); mx.pitch = Math.max(mx.pitch, Math.abs(o.pitch - prev.pitch)); prev = { p: o.root.clone(), yaw: o.yaw, w: o.sitW, pitch: o.pitch };
    }
    return { mx, phases, m };
  };
  it('sit down: turn -> down -> seated, no per-frame jump (root < 6 cm, yaw < 15°, weight < 0.1)', () => {
    const r = run(sofa); expect(r.phases).toEqual(['turn', 'down', 'seated']);
    expect(r.mx.p).toBeLessThan(0.06); expect(r.mx.yaw).toBeLessThan((15 * Math.PI) / 180); expect(r.mx.w).toBeLessThan(0.1);
  });
  it('lie: sits on the edge first, then reclines; get up reverses through the edge sit', () => {
    const r = run(lie, 200, 600); expect(r.phases).toEqual(['turn', 'down', 'recline', 'lying', 'unrecline', 'up', 'free']);
    expect(r.mx.pitch).toBeLessThan(0.05); expect(r.mx.p).toBeLessThan(0.06);
  });
  it('interrupted half-way through sitting down: stands back up from the current pose (no snap)', () => {
    const m = newSeatMotion(), o = newSeatPose(); beginSeat(m, sofa, approachOf(sofa, new THREE.Vector3()), sofa.yaw);
    let f = 0; while (!(m.phase === 'down' && m.sp >= 0.5) && f++ < 200) stepSeat(m, 1 / 60, false);
    seatPose(m, o); const w0 = o.sitW; stepSeat(m, 1 / 60, true); seatPose(m, o);
    expect(m.phase).toBe('up'); expect(Math.abs(o.sitW - w0)).toBeLessThan(0.1);
    let n = 0; while (!stepSeat(m, 1 / 60, true) && n++ < 200); expect(n).toBeLessThan(40); // ≈ half of sitOut
  });
  it('lie curves: legs straighten before the torso tips back; hips scoot last', () => {
    const c = lieCurves(0.3); expect(c.legs).toBeGreaterThan(c.pitch); expect(c.slide).toBe(0);
    expect(lieCurves(1)).toEqual({ legs: 1, pitch: 1, slide: 1 });
  });
  it('turn duration grows with the angle, never instant', () => {
    expect(turnDuration(0, 0, PRESETS.chair)).toBeGreaterThan(0.1); expect(turnDuration(Math.PI, 0, PRESETS.chair)).toBeCloseTo(PRESETS.chair.turn);
  });
});
