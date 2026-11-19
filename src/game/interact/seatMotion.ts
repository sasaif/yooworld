import * as THREE from 'three';
import type { Seat } from '../world';
import { PRESETS, type PosePreset } from '../../data/interactionRegistry';
import { posedRoot, sitHip } from './anchors';
/**
 * Sit / lie / stand-up transitions as a small state machine (pure, allocation-free per step, unit-tested in
 * tests/interaction-motion.test.ts). The renderer only reads the outputs; nothing here touches Three.js objects.
 *
 *   arrive ─► turn ─► down ─► seated                       (chair, stool, sofa, armchair, bed edge)
 *                          └► recline ─► lying            (bed: sit on the edge first, then lie back and scoot up)
 *   stand-up = the same curves played backwards from wherever the avatar is (lying ─► unrecline ─► up ─► free), so an
 *   interruption (joystick, tap) half-way through sitting down simply reverses from the current pose: no snap.
 *
 * Progress values are linear in time and eased on output:
 *  - turn: walk the last few cm to the approach point while turning round to face away from the seat;
 *  - sp (0 standing at the approach point … 1 seated): root slides under the seat, hips go onto the cushion while the
 *    knees bend (the SitPose layer weight = ease(sp));
 *  - lp (0 sitting on the bed edge … 1 lying): legs straighten first, then the torso tips back, then the hips scoot
 *    up the mattress (staggered sub-curves so the shins never drag through the foot of the bed).
 */
export type SeatPhase = 'none' | 'turn' | 'down' | 'seated' | 'recline' | 'lying' | 'unrecline' | 'up';
export interface SeatMotion { phase: SeatPhase; seat: Seat | null; t: number; turnDur: number; sp: number; lp: number; yaw0: number; from: THREE.Vector3 }
export const newSeatMotion = (): SeatMotion => ({ phase: 'none', seat: null, t: 0, turnDur: 0, sp: 0, lp: 0, yaw0: 0, from: new THREE.Vector3() });
export const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const presetOf = (seat: Seat): PosePreset => PRESETS[seat.preset ?? (seat.pose === 'lie' ? 'lie' : seat.kind === 'stool' ? 'stool' : seat.kind === 'sofa' ? 'sofa' : seat.kind === 'bed' ? 'bedEdge' : 'chair')];
/** Seats that use the procedural pose + transitions (measured hips point & cushion height). */
export const motionSeat = (seat: Seat) => !!seat.hip && seat.h !== undefined && (seat.pose !== 'lie' || !!seat.edgeHip);

/** Turn duration: proportional to the angle (≤ preset.turn for a half turn), never instant. */
export function turnDuration(dyaw: number, dist: number, p: PosePreset) { return Math.max(0.18, p.turn * Math.abs(dyaw) / Math.PI, dist / 0.7); }

/** Arrived next to the seat: start the turn. */
export function beginSeat(m: SeatMotion, seat: Seat, pos: THREE.Vector3, yaw: number) {
  const p = presetOf(seat); m.seat = seat; m.phase = 'turn'; m.t = 0; m.sp = 0; m.lp = 0; m.yaw0 = yaw; m.from.copy(pos).setY(0);
  m.turnDur = turnDuration(wrapAngle(seat.yaw - yaw), m.from.distanceTo(approachOf(seat, _a)), p);
}
/**
 * Advance by dt. `out` = the player asked to get up (joystick, tap elsewhere). Returns true on the frame the avatar is
 * free again (phase back to 'none').
 */
export function stepSeat(m: SeatMotion, dt: number, out: boolean): boolean {
  if (!m.seat || m.phase === 'none') return false;
  const p = presetOf(m.seat); const lie = m.seat.pose === 'lie';
  if (out) {
    if (m.phase === 'turn') { m.phase = 'none'; return true; }
    if (m.lp > 0) { m.phase = 'unrecline'; m.lp = Math.max(0, m.lp - dt / p.unrecline!); return false; }
    m.phase = 'up'; m.sp = Math.max(0, m.sp - dt / p.sitOut);
    if (m.sp <= 0) { m.phase = 'none'; return true; }
    return false;
  }
  if (m.phase === 'turn') { m.t += dt; if (m.t >= m.turnDur) { m.phase = 'down'; m.sp = Math.min(1, (m.t - m.turnDur) / p.sitIn); } return false; }
  if (m.phase === 'down' || m.phase === 'up') { m.phase = 'down'; m.sp = Math.min(1, m.sp + dt / p.sitIn); if (m.sp >= 1) m.phase = lie ? 'recline' : 'seated'; return false; }
  if (lie && (m.phase === 'recline' || m.phase === 'unrecline')) { m.phase = 'recline'; m.lp = Math.min(1, m.lp + dt / p.recline!); if (m.lp >= 1) m.phase = 'lying'; }
  return false;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _h = new THREE.Vector3(), _f = new THREE.Vector3();
/** Floor point where the avatar stands, back to the seat, before sitting down. */
export function approachOf(seat: Seat, out: THREE.Vector3) {
  if (seat.approach) return out.copy(seat.approach).setY(0);
  const hip = seat.edgeHip ?? seat.hip!; return out.copy(hip).addScaledVector(_f.set(Math.sin(seat.yaw), 0, Math.cos(seat.yaw)), presetOf(seat).approach).setY(0);
}
/** The sitting part of a seat (a lying spot is entered through its bed-edge seat). */
function sitPart(seat: Seat, hip: THREE.Vector3) { if (seat.pose === 'lie') { hip.copy(seat.edgeHip!); hip.y = seat.edgeH! + 0.078; return hip; } return sitHip(seat, hip); }
/** Lying sub-curves of lp: legs straighten, torso tips back, hips scoot up the bed. */
const BED_CURVE = { legs: [0, 0.55], pitch: [0.05, 0.85], slide: [0.3, 1] } as const;
const sub = (lp: number, [a, b]: readonly [number, number]) => smooth(clamp01((lp - a) / (b - a)));
/** Lying sub-curves of lp (per preset: the transat lifts the legs before the hips scoot back). */
export const lieCurves = (lp: number, p?: PosePreset) => { const c = p?.lieCurve ?? BED_CURVE; return { legs: sub(lp, c.legs), pitch: sub(lp, c.pitch), slide: sub(lp, c.slide) }; };

export interface SeatPose { root: THREE.Vector3; yaw: number; sitW: number; hip: THREE.Vector3; legs: number; pitch: number; slide: number }
export const newSeatPose = (): SeatPose => ({ root: new THREE.Vector3(), yaw: 0, sitW: 0, hip: new THREE.Vector3(), legs: 0, pitch: 0, slide: 0 });
/**
 * Outputs for the current state: root (floor point under the avatar: name tag, shadow, camera follow), yaw, seated
 * layer weight, the sitting hips point on the cushion (lying: the bed-edge point; the renderer blends it towards the
 * lying hips with `slide`), lying curves (`pitch` 0..1 of the full lie tilt).
 */
export function seatPose(m: SeatMotion, o: SeatPose): SeatPose {
  const seat = m.seat!; approachOf(seat, _a);
  if (m.phase === 'turn') {
    const k = smooth(m.t / m.turnDur); o.root.lerpVectors(m.from, _a, k); o.yaw = m.yaw0 + wrapAngle(seat.yaw - m.yaw0) * k;
    o.sitW = 0; o.legs = 0; o.pitch = 0; o.slide = 0; sitPart(seat, o.hip); return o;
  }
  const e = smooth(m.sp); sitPart(seat, o.hip);
  if (seat.pose === 'lie') { _h.copy(seat.edgeHip!); _b.copy(_h).addScaledVector(_f.set(Math.sin(seat.yaw), 0, Math.cos(seat.yaw)), 0.05).setY(0); }
  else posedRoot(seat, _b);
  o.root.lerpVectors(_a, _b, e); o.yaw = seat.yaw; o.sitW = e;
  const c = lieCurves(m.lp, presetOf(seat)); o.legs = c.legs; o.pitch = c.pitch; o.slide = c.slide;
  return o;
}
