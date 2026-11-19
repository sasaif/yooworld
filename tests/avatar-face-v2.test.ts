import { describe, expect, it } from 'vitest';
import { CATALOGUE, ITEMS, isFree } from '../src/fashion/catalogue';
import { DEFAULT_LOOK, equip, parseLook, sanitizeLook, serializeLook } from '../src/fashion/look';
import { validateCatalogue } from '../src/fashion/schema';
import { resolveLook } from '../src/render/avatar/custom/spec';
import { FACE_V2_IDS, FACE_V2_ITEMS } from '../src/avatar/face/items';
import { CATCHLIGHTS, IRIS_V2, paintSmile, paintSparkleEyes, scaleIrisPixels, type Ctx2D } from '../src/avatar/face/faceV2';

/** ids that existed at 119643c (snapshot of the face slots): must never disappear or change slot */
const LEGACY = { eyes: ['eyes_round', 'eyes_almond', 'eyes_sleepy', 'eyes_big', 'eyes_cat'], mouth: ['mouth_base', 'mouth_small', 'mouth_wide', 'mouth_full', 'mouth_heart'] };
const LEGACY_DEFAULTS = {
  f: '{"v":1,"body":"f","slots":{"skin":"skin_peach","faceShape":"face_round","eyes":"eyes_round","eyeColor":"eyecol_plum","brows":"brow_natural","nose":"nose_base","mouth":"mouth_base","hair":"hair_buns","hairColor":"haircol_pink","details.blush":"det_blush","top":"tee_cheese","jacket":"jacket_green","pants":"pants_shorts_black","shoes":"shoes_lime","acc.bag":"acc_backpack"}}',
  m: '{"v":1,"body":"m","slots":{"skin":"skin_peach","faceShape":"face_round","eyes":"eyes_round","eyeColor":"eyecol_brown","brows":"brow_thick","nose":"nose_base","mouth":"mouth_base","hair":"hair_quiff","hairColor":"haircol_brown","beard":"beard_none","top":"tee_cheese","jacket":"jacket_green","pants":"pants_black","shoes":"shoes_lime"}}',
};

describe('face v2 items: additive and save-compatible', () => {
  it('adds only new, free ids in the existing slots; catalogue stays valid', () => {
    expect(validateCatalogue(CATALOGUE)).toEqual([]);
    for (const it of FACE_V2_ITEMS) { expect(ITEMS[it.id]).toBe(it); expect(isFree(it)).toBe(true); expect(LEGACY.eyes.concat(LEGACY.mouth)).not.toContain(it.id); }
    expect(ITEMS[FACE_V2_IDS.smile].slot).toBe('mouth'); expect(ITEMS[FACE_V2_IDS.sparkle].slot).toBe('eyes');
    for (const id of LEGACY.eyes) expect(ITEMS[id].slot).toBe('eyes'); for (const id of LEGACY.mouth) expect(ITEMS[id].slot).toBe('mouth');
  });
  it('defaults for existing/new players are unchanged (byte-identical serialisation)', () => {
    expect(serializeLook(DEFAULT_LOOK.f)).toBe(LEGACY_DEFAULTS.f); expect(serializeLook(DEFAULT_LOOK.m)).toBe(LEGACY_DEFAULTS.m);
    expect(resolveLook(DEFAULT_LOOK.f).faceV2).toBeUndefined(); expect(resolveLook(DEFAULT_LOOK.m).faceV2).toBeUndefined();
  });
  it('old saves load unchanged; new options round-trip through the v1 schema', () => {
    for (const s of Object.values(LEGACY_DEFAULTS)) expect(serializeLook(parseLook(s))).toBe(s);
    const l = equip(equip(DEFAULT_LOOK.m, FACE_V2_IDS.smile), FACE_V2_IDS.sparkle); const saved = serializeLook(l);
    expect(JSON.parse(saved).v).toBe(1); const back = parseLook(saved); expect(back.slots.mouth).toBe('mouth_smile'); expect(back.slots.eyes).toBe('eyes_sparkle');
    expect(resolveLook(back).faceV2).toEqual({ smile: true, sparkle: true }); expect(resolveLook(equip(DEFAULT_LOOK.f, FACE_V2_IDS.smile)).faceV2).toEqual({ smile: true, sparkle: false });
    // an older build that does not know the new ids falls back to the defaults (sanitizeLook), never crashes
    const unknown = sanitizeLook({ v: 1, body: 'f', slots: { mouth: 'mouth_from_the_future' } }); expect(unknown.slots.mouth).toBe('mouth_base');
  });
  it('both bodies may use them (no body lock)', () => { for (const it of FACE_V2_ITEMS) expect(it.body).toBeUndefined(); });
});

/** recording Canvas 2D mock */
function mockCtx(size: number) {
  const data = new Uint8ClampedArray(size * size * 4).fill(200); const calls: string[] = []; const fills: string[] = [];
  const grad = { addColorStop: () => {} } as unknown as CanvasGradient;
  const x = {
    fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1, lineCap: 'butt', globalAlpha: 1, globalCompositeOperation: 'source-over',
    save: () => calls.push('save'), restore: () => calls.push('restore'), beginPath: () => calls.push('beginPath'), moveTo: () => {}, lineTo: () => {}, quadraticCurveTo: () => {},
    ellipse: (cx: number, cy: number) => calls.push(`ellipse ${cx.toFixed(1)} ${cy.toFixed(1)}`), arc: (cx: number, cy: number) => calls.push(`arc ${cx.toFixed(1)} ${cy.toFixed(1)}`),
    fill() { fills.push(String(this.fillStyle)); calls.push('fill'); }, stroke: () => calls.push('stroke'), createRadialGradient: () => grad,
    getImageData: (sx: number, sy: number, w: number, h: number) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) d.set(data.subarray(((sy + y) * size + sx) * 4, ((sy + y) * size + sx + w) * 4), y * w * 4); return { data: d, width: w, height: h } as ImageData; },
    putImageData: (img: ImageData, dx: number, dy: number) => { calls.push(`put ${dx} ${dy} ${img.width}x${img.height}`); },
  };
  return { x: x as unknown as Ctx2D, calls, fills };
}
describe('face v2 painters', () => {
  it('smile: skin patch + mouth + tongue + 2 upturned corners, centred on the mouth UV, balanced save/restore', () => {
    const { x, calls, fills } = mockCtx(1024); paintSmile(x, [0.206, 0.862], 1024, '#efc3a5');
    expect(calls.filter((c) => c === 'fill').length).toBe(3); expect(calls.filter((c) => c === 'stroke').length).toBe(2);
    expect(calls).toContain('ellipse 210.9 882.7'); expect(calls.filter((c) => c === 'save').length).toBe(calls.filter((c) => c === 'restore').length);
    expect(fills[1]).toBe('rgba(120,38,62,0.96)');
    const lip = mockCtx(1024); paintSmile(lip.x, [0.206, 0.862], 1024, '#efc3a5', '#ff0000'); expect(lip.fills[1]).not.toBe('rgba(120,38,62,0.96)');
  });
  it('sparkle eyes: rewrites only the iris window and adds the 3 catchlights; scales with atlas size', () => {
    const { x, calls } = mockCtx(1024); paintSparkleEyes(x, 1024);
    const put = calls.find((c) => c.startsWith('put'))!; const [, dx, dy] = put.split(' ').map(Number); expect(Math.abs(dx - (IRIS_V2.x - 32))).toBeLessThan(3); expect(Math.abs(dy - (IRIS_V2.y - 32))).toBeLessThan(3);
    expect(calls.filter((c) => c.startsWith('ellipse') || c.startsWith('arc')).length).toBe(CATCHLIGHTS.length);
    const half = mockCtx(512); paintSparkleEyes(half.x, 512); expect(half.calls).toContain(`ellipse ${(555 / 2 - 4.5).toFixed(1)} ${(150 / 2 - 5).toFixed(1)}`);
  });
  it('iris scaling is pure: enlarges a dark disc by ×1.18 and leaves pixels outside untouched', () => {
    const w = 80, h = 80, cx = 40, cy = 40, r = 20; const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); const v = d < r ? 20 : 240; src[i] = src[i + 1] = src[i + 2] = v; src[i + 3] = 255; }
    const copy = new Uint8ClampedArray(src); const out = scaleIrisPixels(src, w, h, cx, cy, r, 1.18); expect(src).toEqual(copy);
    const px = (b: Uint8ClampedArray, x: number, y: number) => b[(y * w + x) * 4];
    expect(px(src, 40 + 21, 40)).toBe(240); expect(px(out, 40 + 21, 40)).toBeLessThan(60); // now inside the bigger iris
    expect(px(out, 40 + 30, 40)).toBe(240); expect(px(out, 2, 2)).toBe(240); expect(px(out, 40, 40)).toBe(20);
  });
});
