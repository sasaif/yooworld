import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CATALOGUE, ITEMS } from '../src/fashion/catalogue';
import { DEFAULT_LOOK, equip, parseLook, serializeLook } from '../src/fashion/look';
import { validateCatalogue } from '../src/fashion/schema';
import { resolveLook, hasHat } from '../src/render/avatar/custom/spec';
import { applyHairSheen, hairSheenEnabled, HAIR_SHEEN_KEY } from '../src/render/avatar/custom/hairSheen';

const LEGACY_HAIR = ['hair_buns', 'hair_quiff', 'hair_bob', 'hair_buzz', 'hair_pigtails', 'hair_manbun', 'hair_pony', 'hair_long', 'hair_afro', 'hair_mohawk'];
describe('Phase B hair items: additive', () => {
  it('adds hair_braids + hair_bun_high, keeps every legacy hair id and the defaults', () => {
    expect(validateCatalogue(CATALOGUE)).toEqual([]);
    for (const id of LEGACY_HAIR) expect(ITEMS[id]?.slot).toBe('hair');
    expect(ITEMS.hair_braids.render.hair).toBe('braids'); expect(ITEMS.hair_bun_high.render.hair).toBe('bun_high');
    expect(DEFAULT_LOOK.f.slots.hair).toBe('hair_buns'); expect(DEFAULT_LOOK.m.slots.hair).toBe('hair_quiff');
    expect(CATALOGUE.filter((i) => i.slot === 'hair').map((i) => i.id).slice(0, LEGACY_HAIR.length)).toEqual(LEGACY_HAIR);
  });
  it('round-trips through the v1 save on both bodies and resolves to the new styles', () => {
    for (const b of ['f', 'm'] as const) for (const [id, st] of [['hair_braids', 'braids'], ['hair_bun_high', 'bun_high']] as const) {
      const l = equip(DEFAULT_LOOK[b], id); const s = serializeLook(l); expect(JSON.parse(s).v).toBe(1);
      expect(parseLook(s).slots.hair).toBe(id); expect(resolveLook(l).hair).toBe(st);
    }
    const hatted = equip(equip(DEFAULT_LOOK.f, 'hair_bun_high'), 'acc_cap'); expect(hasHat(resolveLook(hatted))).toBe(true);
  });
});
describe('hair sheen shader', () => {
  const lambertFrag = THREE.ShaderLib.lambert.fragmentShader;
  it('injects before opaque_fragment, shares one program key, adds no texture', () => {
    const tex = new THREE.Texture(); const a = new THREE.MeshLambertMaterial({ map: tex }), b = new THREE.MeshLambertMaterial({ map: tex });
    expect(applyHairSheen(a, true)).toBe(true); applyHairSheen(b, true);
    expect(a.customProgramCacheKey()).toBe(HAIR_SHEEN_KEY); expect(b.customProgramCacheKey()).toBe(a.customProgramCacheKey());
    const sh = { fragmentShader: lambertFrag, vertexShader: '', uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    a.onBeforeCompile(sh, undefined as unknown as THREE.WebGLRenderer);
    expect(sh.fragmentShader.indexOf('ywRing')).toBeGreaterThan(0); expect(sh.fragmentShader.indexOf('ywRing')).toBeLessThan(sh.fragmentShader.indexOf('#include <opaque_fragment>'));
    expect(Object.keys(sh.uniforms)).toEqual([]); expect(a.map).toBe(tex); expect(a.emissiveMap).toBeNull();
  });
  it('fallback leaves the material exactly as before', () => {
    const m = new THREE.MeshLambertMaterial(); const before = m.customProgramCacheKey(); const obc = m.onBeforeCompile;
    expect(applyHairSheen(m, false)).toBe(false); expect(m.customProgramCacheKey()).toBe(before); expect(m.onBeforeCompile).toBe(obc);
  });
  it('flag: ?hairsheen=0 or localStorage yw.hairSheen=0 turns it off', () => {
    expect(hairSheenEnabled()).toBe(true);
    vi.stubGlobal('location', { search: '?lieu=appart&hairsheen=0' }); expect(hairSheenEnabled()).toBe(false); vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'yw.hairSheen' ? '0' : null) }); expect(hairSheenEnabled()).toBe(false); vi.unstubAllGlobals();
  });
});
