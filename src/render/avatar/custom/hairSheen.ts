import type * as THREE from 'three';
import { storage } from '../../../persistence/storage';
/** Phase B (test build): subtle "doll" sheen on hair — a soft highlight ring around the crown, a faint strand
 *  ripple and a light rim, plus a gentle darkening towards the underside. Pure shader math on the existing hair
 *  material: same atlas texture, same mesh, 0 extra textures, 0 extra draw calls. Every avatar's hair material
 *  shares ONE extra program (same customProgramCacheKey). Fallback = the original look: `?hairsheen=0` in the URL
 *  or the pref `hairSheen = '0'` (storage.prefs) (read once at material creation). */
export const HAIR_SHEEN_KEY = 'yw-hair-sheen-v2';
export const HAIR_SHEEN_GLSL = /* glsl */ `
  {
    vec3 ywN = normalize( normal );
    vec3 ywV = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
    float ywRing = exp( -pow( ( ywN.y - 0.52 ) / 0.11, 2.0 ) );
    float ywStrand = 0.72 + 0.28 * sin( vMapUv.x * 210.0 + vMapUv.y * 37.0 );
    vec3 ywHl = mix( vec3( 1.0, 0.96, 0.98 ), diffuseColor.rgb, 0.35 );
    outgoingLight += ywHl * ywRing * ywStrand * 0.24;
    float ywRim = pow( 1.0 - clamp( abs( dot( ywN, ywV ) ), 0.0, 1.0 ), 3.0 );
    outgoingLight += ywHl * ywRim * 0.12;
    outgoingLight *= mix( 0.80, 1.0, smoothstep( -0.65, 0.15, ywN.y ) );
  }
`;
export function hairSheenEnabled(): boolean {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('hairsheen') === '0') return false;
    if (storage.prefs.getItem('hairSheen') === '0') return false; // yw.hairSheen in prod, yw:e:<env>:hairSheen elsewhere
  } catch { /* privacy mode etc. → default */ }
  return true;
}
/** Patch a MeshLambertMaterial in place (call once, before first render). Returns whether the sheen is on. */
export function applyHairSheen(mat: THREE.MeshLambertMaterial, on = hairSheenEnabled()): boolean {
  if (!on) return false;
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', HAIR_SHEEN_GLSL + '\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => HAIR_SHEEN_KEY;
  mat.userData.ywHairSheen = true; return true;
}
