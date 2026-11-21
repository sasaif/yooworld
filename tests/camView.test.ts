import { describe, expect, it, beforeEach } from 'vitest';
import { CAM_VIEW_KEY, AVATAR_VIEW_MUL, camViewFollow, camViewZoomMul, loadCamView, nextCamView, saveCamView } from '../src/app/camView';
import { DEFAULT_VARIANT, VARIANTS, parseVariant } from '../src/app/variant';
import { startLocation } from '../src/app/startLocation';
import { fitZoom } from '../src/render/cameraFit';
import * as THREE from 'three';

const kv = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('camera view toggle (Vue appartement / Vue perso)', () => {
  it('cycles room <-> avatar', () => { expect(nextCamView('room')).toBe('avatar'); expect(nextCamView('avatar')).toBe('room'); });
  it('persists the preference and defaults to the full room', () => {
    const s = kv(); expect(loadCamView(s)).toBe('room');
    saveCamView(s, 'avatar'); expect(s.m.get(CAM_VIEW_KEY)).toBe('avatar'); expect(loadCamView(s)).toBe('avatar');
    saveCamView(s, 'room'); expect(loadCamView(s)).toBe('room');
    s.m.set(CAM_VIEW_KEY, 'garbage'); expect(loadCamView(s)).toBe('room');
    expect(loadCamView(null)).toBe('room');
    expect(loadCamView({ getItem: () => { throw new Error('private mode'); } })).toBe('room');
  });
  it('avatar view is closer and centred on the player; room view uses the variant', () => {
    for (const v of Object.values(VARIANTS)) {
      expect(camViewZoomMul('room', v.zoomMul)).toBe(v.zoomMul);
      expect(camViewZoomMul('avatar', v.zoomMul)).toBeGreaterThanOrEqual(AVATAR_VIEW_MUL);
      expect(camViewZoomMul('avatar', v.zoomMul)).toBeGreaterThan(v.zoomMul * 1.4);
      expect(camViewFollow('avatar', v.follow)).toBe(0); expect(camViewFollow('room', v.follow)).toBe(v.follow);
    }
  });
});

describe('size / framing variants (?v=1|2|3)', () => {
  it('parses the URL param with a safe default', () => {
    expect(parseVariant('?v=2')).toBe(2); expect(parseVariant('?fresh&v=3')).toBe(3); expect(parseVariant('?v=1')).toBe(1);
    expect(parseVariant('')).toBe(DEFAULT_VARIANT); expect(parseVariant('?v=9')).toBe(DEFAULT_VARIANT); expect(parseVariant('?v=abc')).toBe(DEFAULT_VARIANT);
  });
  it('keeps avatars proportional: always shorter than the door opening (1.18 m)', () => {
    for (const v of Object.values(VARIANTS)) { expect(0.96 * v.scale).toBeLessThan(1.18); expect(v.scale).toBeGreaterThanOrEqual(1.05); }
  });
  it('V2 ≈ 85 px and V3 closer than V2 on iPhone 15 landscape (V1 = 75 px measured)', () => {
    const iso = new THREE.Vector3(1, 1.05, 1.2).normalize(); const room = { w: 7.2, d: 6, wallH: 1.55 };
    const fit = fitZoom(852, 393, room, iso); const px = (id: 1 | 2 | 3) => 75 * (VARIANTS[id].scale / VARIANTS[1].scale) * VARIANTS[id].zoomMul;
    expect(fit).toBeGreaterThan(80);
    expect(px(2)).toBeGreaterThan(83); expect(px(2)).toBeLessThan(87);
    expect(px(3)).toBeGreaterThan(px(2));
  });
});

describe('start location (Task A: /plage/ must open on the beach)', () => {
  it('deep link ?lieu= wins', () => {
    expect(startLocation('?lieu=plage', undefined, false)).toBe('beach'); expect(startLocation('?lieu=BEACH', 'beach', true)).toBe('beach');
    expect(startLocation('?lieu=appart', 'beach', false)).toBe('home'); expect(startLocation('?lieu=nowhere', undefined, false)).toBeNull();
  });
  it('build default applies once per session, then the saved location', () => {
    expect(startLocation('', 'beach', false)).toBe('beach'); expect(startLocation('', 'plage', false)).toBe('beach');
    expect(startLocation('', 'beach', true)).toBeNull(); expect(startLocation('', undefined, false)).toBeNull();
  });
  it('size comparison links (?v=) open in the apartment unless ?lieu= says otherwise', () => {
    expect(startLocation('?v=2', 'beach', false)).toBe('home'); expect(startLocation('?v=3&lieu=plage', 'beach', false)).toBe('beach');
  });
});

import { LAUNCH_CAM_VIEW, camStore } from '../src/app/camView';
describe('launch framing (owner decision 21/11/2026)', () => {
  it('every launch opens in Vue appartement, whatever was saved', () => {
    expect(LAUNCH_CAM_VIEW).toBe('room'); expect(camStore.get().view).toBe('room');
  });
});
