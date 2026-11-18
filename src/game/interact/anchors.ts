import * as THREE from 'three';
import type { Seat } from '../world';
/**
 * Seat / bed anchors: where the avatar root goes so the body rests ON the furniture (pure, unit-tested).
 * Measured in the game (tools/seat_heights.py + an in-game probe of the SitDown clip, Nov 2026):
 *  - at the end of SitDown the hips bone is HIP_H × scale above the root (0.312 m at scale 1.14) and HIP_FWD × scale in front;
 *  - BUTT = thickness under the hips bone that should touch the cushion.
 * Before: every seat used one height tuned for the 0.276 m sofa cushion and the hips 0.17 m in front of the seat point,
 * so on the wooden chair (0.24 m deep) the avatar sat in the air in front of it, on the bar stool (0.52 m) it sank to the
 * floor through the stool, and on the bed edge (0.30 m) the legs went into the bed frame.
 */
export const HIP_H = 0.2737, HIP_FWD = 0.006, BUTT = 0.045;
/** Lying on the back. The chibi head is much deeper than the torso, so lying perfectly flat either sinks the head into
 *  the mattress or floats the body. Calibrated on the in-game vertex cloud (Nov 2026): tilt the body 15° (head end up,
 *  resting on the pillow) and lift the root LIE_LIFT × scale above the mattress -> back of the head on the pillow (0.33 m),
 *  torso on the mattress (0.30 m), nothing below the surface. */
export const LIE_TILT = (3 * Math.PI) / 180, LIE_LIFT = 0.135;
/** Pitch of the avatar group when fully lying (rotation about its local X, Euler order YXZ). */
export const LIE_PITCH = -(Math.PI / 2 - LIE_TILT);
/** Legacy formula (Yoo Plage loungers and any seat without measured data). */
export const legacySitY = (scale: number) => 0.04 - (scale - 1) * 0.22;

const _f = new THREE.Vector3();
/** Root position of a seated avatar. */
export function sitRoot(seat: Seat, scale: number, sitForward: number, out: THREE.Vector3) {
  _f.set(Math.sin(seat.yaw), 0, Math.cos(seat.yaw));
  if (seat.hip && seat.h !== undefined) { out.copy(seat.hip).addScaledVector(_f, -HIP_FWD * scale); out.y = seat.h + BUTT - HIP_H * scale; return out; }
  out.copy(seat.pos).addScaledVector(_f, sitForward * scale); out.y = legacySitY(scale); return out;
}
/** Root (= feet) position of an avatar lying on its back along the bed, head towards the headboard. */
export function lieRoot(seat: Seat, scale: number, out: THREE.Vector3) {
  out.copy(seat.hip ?? seat.pos); out.y = (seat.h ?? 0.3) + LIE_LIFT * scale; return out;
}
/** Seated height of the hips bone for a root position (for tests / debug). */
export const hipsY = (rootY: number, scale: number) => rootY + HIP_H * scale;

/** Procedural seated pose (render/avatar/sitPose.ts): height of the Hips bone above the seat top so that the bottom
 *  of the pelvis and the thighs rest ON the cushion (calibrated on the in-game vertex cloud, tools/pose-probe.mjs). */
export const SEAT_CLEAR = 0.078;
/** Seats with measured data use the procedural pose; legacy ones (Yoo Plage loungers) keep the SitDown clip. */
export const posedSeat = (seat: Seat) => seat.pose !== 'lie' && !!seat.hip && seat.h !== undefined;
/** World point where the Hips bone is planted for the procedural pose. */
export function sitHip(seat: Seat, out: THREE.Vector3) { out.copy(seat.hip!); out.y = seat.h! + SEAT_CLEAR; return out; }
/** Root (feet / shadow) of a posed seated avatar: on the floor, under the thighs. */
export function posedRoot(seat: Seat, out: THREE.Vector3) {
  out.copy(seat.hip!).addScaledVector(_f.set(Math.sin(seat.yaw), 0, Math.cos(seat.yaw)), 0.05); out.y = 0; return out;
}
