import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitZoom, projectedRoomSize, zoomLimits } from '../src/render/cameraFit';

const ISO = new THREE.Vector3(1, 1.05, 1.2).normalize();
const room = { w: 7.2, d: 6, wallH: 1.55 };
describe('camera fit', () => {
  it('the iso room is wider than tall on screen', () => {
    const s = projectedRoomSize(room, ISO); expect(s.w).toBeGreaterThan(s.h); expect(s.w).toBeGreaterThan(7);
  });
  it('fills a landscape phone better than the old fixed zoom (70)', () => {
    const z = fitZoom(852, 393, room, ISO, 40);
    expect(z).toBeGreaterThan(70 * 1.2);
    // the whole room width stays (almost) on screen
    expect(projectedRoomSize(room, ISO).w * z).toBeLessThan(852 * 1.15);
  });
  it('adapts to rotation and resize', () => {
    const land = fitZoom(915, 412, room, ISO), port = fitZoom(412, 915, room, ISO);
    expect(land).not.toBeCloseTo(port, 0);
    expect(fitZoom(1440, 900, room, ISO)).toBeGreaterThan(fitZoom(1024, 768, room, ISO));
  });
  it('zoom limits bracket the fit', () => {
    const l = zoomLimits(100); expect(l.min).toBeLessThan(100); expect(l.max).toBeGreaterThan(300);
  });
});

import { AVATARS, AVATAR_SCALE } from '../src/data/avatars';
describe('avatar scale vs room', () => {
  it('avatars are 1.05-1.15x and stay under the door opening (1.18 m)', () => {
    expect(AVATAR_SCALE).toBeGreaterThanOrEqual(1.05); expect(AVATAR_SCALE).toBeLessThanOrEqual(1.15);
    Object.values(AVATARS).forEach((a) => expect(0.97 * a.scale).toBeLessThan(1.18));
  });
  it('on an iPhone in landscape the avatar is >= 25% taller on screen than before (zoom 70, scale 1)', () => {
    const z = fitZoom(852, 393, room, ISO); expect((z * AVATAR_SCALE) / 70).toBeGreaterThan(1.25);
  });
});
