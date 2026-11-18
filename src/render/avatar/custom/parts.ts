/** Body-part labels produced offline by tools/fashion/build_parts.py (vertex / triangle / atlas texel). */
export const PART = {
  NONE: 0, SKIN_HEAD: 1, SKIN_HAND: 2, LEG: 3, TOP_TORSO: 4, TOP_UPPER: 5, TOP_FORE: 6, TOP_CUFF: 7, TOP_COLLAR: 8, TOP_HEM: 9, TEE: 10, SHORTS: 11,
  SHOE: 12, SOLE: 13, HAIR: 14, BROW: 15, EYE: 16, EYEBALL: 17, MOUTH_IN: 18, TEETH: 19, BAG: 20, BAG_STRAP: 21, LASH: 22, HAIR_BUN: 23,
} as const;
export type V3 = [number, number, number];
export type V2 = [number, number];
export interface Features {
  eyeP: V3; eyeN: V3; mouth: V3; nose: V3; chin: V3; earP: V3; earN: V3; browP: V3; browN: V3; cheekP: V3; cheekN: V3;
  headTop: V3; headCenter: V3; headR: number; neck: V3; chestFront: number; torsoBack: number; torsoHalfW: number; topY: V2;
  hipsY: number; hipsHalfW: number; hipsFront: number; hipsBack: number; wristP: V3; wristN: V3; legY: V2;
  mouthUV: V2; noseUV: V2; eyePUV: V2; eyeNUV: V2; cheekPUV: V2; cheekNUV: V2; chinUV: V2;
}
export interface PartsData { vertexCount: number; triCount: number; vertexPart: Uint8Array; triPart: Uint8Array; features: Features; ibm: Record<string, number[]> }
export const b64ToBytes = (s: string) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
export function decodeParts(raw: { vertexCount: number; triCount: number; vertexPart: string; triPart: string; features: Features; ibm: Record<string, number[]> }): PartsData {
  return { ...raw, vertexPart: b64ToBytes(raw.vertexPart), triPart: b64ToBytes(raw.triPart) };
}
const cache = new Map<string, Promise<PartsData>>();
export function loadParts(url: string) {
  let p = cache.get(url);
  if (!p) { p = fetch(url).then((r) => { if (!r.ok) throw new Error('parts ' + r.status); return r.json(); }).then(decodeParts); cache.set(url, p); }
  return p;
}
/** Atlas label mask (1024², R channel = label). */
let maskP: Promise<{ size: number; data: Uint8Array }> | null = null;
export function loadMask(url: string) {
  if (!maskP) maskP = new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d', { willReadFrequently: true })!; x.imageSmoothingEnabled = false; x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, img.width, img.height).data; const out = new Uint8Array(img.width * img.height); for (let i = 0; i < out.length; i++) out[i] = d[i * 4]; res({ size: img.width, data: out }); };
    img.onerror = rej; img.src = url;
  });
  return maskP;
}
