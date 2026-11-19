import { describe, expect, it } from 'vitest';
import { createExpressionBus, ExpressionLayer, expressionFromText, faceMorphIndex, installChatExpressions, PRESETS, EXPRESSIONS, syncExpressionBadge, TIMING, writeFaceMorphs } from '../src/avatar/expressions';
import { FaceAnimator } from '../src/render/avatar/face';
import { moodItems } from '../src/ui/mood/moodItems';

const clock = () => { let t = 0; return { now: () => t, adv: (s: number) => { t += s * 1000; } }; };
const idleBase = { Blink_L: 0, Blink_R: 0, happy: 0.22, joy: 0, mouth_a: 0, mouth_o: 0, mouth_i: 0 };
function run(layer: ExpressionLayer, c: ReturnType<typeof clock>, secs: number, base: Record<string, number> = idleBase, look?: Record<string, number>, dt = 1 / 60) {
  let w: Record<string, number> = {}; for (let i = 0; i < Math.round(secs / dt); i++) { c.adv(dt); w = { ...layer.apply(base, dt, look) }; } return w;
}

describe('emoji -> expression', () => {
  it('maps the relevant chat emojis', () => {
    expect(expressionFromText('trop drôle 😂')).toBe('happy'); expect(expressionFromText('😠')).toBe('angry'); expect(expressionFromText('oh non 😢')).toBe('sad');
    expect(expressionFromText('quoi 😮 ?!')).toBe('surprised'); expect(expressionFromText('à plus 😉')).toBe('wink'); expect(expressionFromText('Salut ☺️')).toBe('happy');
  });
  it('maps ASCII smileys only as standalone tokens', () => {
    expect(expressionFromText('cool :)')).toBe('happy'); expect(expressionFromText(':( bof')).toBe('sad'); expect(expressionFromText('ok ;)')).toBe('wink');
    expect(expressionFromText('hein :O !')).toBe('surprised'); expect(expressionFromText('>:( grr')).toBe('angry'); expect(expressionFromText('mdr xD')).toBe('happy');
    expect(expressionFromText('va sur http://yoo.world')).toBeNull(); expect(expressionFromText('a:)b')).toBeNull(); expect(expressionFromText('10:00')).toBeNull();
  });
  it('ignores unrelated emojis and plain text; the last relevant one wins', () => {
    for (const t of ['Salut ! 👋', 'Bienvenue chez moi 🏠', 'On danse ? 🎉', 'Trop cool !', 'Petite sieste… 😴', '', 'Un smoothie ? 🥭']) expect(expressionFromText(t)).toBeNull();
    expect(expressionFromText('triste 😢 mais 😂')).toBe('happy'); expect(expressionFromText(':) puis 😠')).toBe('angry');
  });
});

describe('expression bus', () => {
  it('triggers with a 2.5 s default and rejects unknown input', () => {
    const c = clock(); const bus = createExpressionBus(c.now); const seen: string[] = []; const off = bus.subscribe((e) => seen.push(e.expr));
    const e = bus.trigger('f', 'happy', { source: 'menu' })!; expect(e.until - e.at).toBe(2500); expect(bus.get('f')?.expr).toBe('happy');
    expect(bus.trigger('f', 'nope' as never)).toBeNull(); expect(bus.trigger('', 'sad')).toBeNull(); off(); bus.trigger('f', 'sad'); expect(seen).toEqual(['happy']);
  });
  it('chat bridge: relevant emoji -> sender expression, unknown sender ignored', () => {
    const c = clock(); const bus = createExpressionBus(c.now); let cb: (m: { from: string; text: string }) => void = () => {};
    const off = installChatExpressions({ onMessage: (f) => { cb = f; return () => { cb = () => {}; }; } }, bus, (f) => (f === 'f' || f === 'm' ? f : null));
    cb({ from: 'f', text: 'coucou 😉' }); expect(bus.get('f')?.expr).toBe('wink'); expect(bus.get('f')?.source).toBe('chat');
    cb({ from: 'm', text: 'Salut ! 👋' }); expect(bus.get('m')).toBeUndefined(); cb({ from: 'ghost', text: '😠' }); expect(bus.get('ghost')).toBeUndefined();
    off(); cb({ from: 'm', text: '😠' }); expect(bus.get('m')).toBeUndefined();
  });
});

describe('expression layer', () => {
  it('fades in, holds ~2.5 s, then returns smoothly to the normal face', () => {
    const c = clock(); const bus = createExpressionBus(c.now); const L = new ExpressionLayer('f', bus);
    expect(run(L, c, 0.5)).toMatchObject({ happy: 0.22, angry: 0 }); // nothing triggered: base passes through
    bus.trigger('f', 'angry'); let w = run(L, c, 0.3); expect(w.angry).toBeGreaterThan(0.85); expect(w.happy).toBeLessThan(0.02); expect(L.current).toBe('angry');
    w = run(L, c, 2.0); expect(w.angry).toBeCloseTo(0.9, 2); // still held at 2.3 s
    // during the fade-out: strictly between, monotonic, no jump > 0.1 per frame
    let prev = w.angry; let maxStep = 0; for (let i = 0; i < 60; i++) { const x = run(L, c, 1 / 60).angry; maxStep = Math.max(maxStep, Math.abs(x - prev)); expect(x).toBeLessThanOrEqual(prev + 1e-9); prev = x; }
    expect(maxStep).toBeLessThan(0.1);
    w = run(L, c, 0.5); expect(w.angry).toBe(0); expect(w.happy).toBeCloseTo(0.22, 5); expect(L.current).toBeNull();
    const total = TIMING.duration + TIMING.fadeOut; expect(total).toBeGreaterThan(2.5); expect(total).toBeLessThan(3.5);
  });
  it('suppresses automatic blinks while shown (wink keeps one eye open) and lets them back after', () => {
    const c = clock(); const bus = createExpressionBus(c.now); const L = new ExpressionLayer('f', bus); const blinking = { ...idleBase, Blink_L: 1, Blink_R: 1 };
    bus.trigger('f', 'wink'); let w = run(L, c, 0.4, blinking); expect(w.Blink_L).toBeCloseTo(1, 5); expect(w.Blink_R).toBeLessThan(0.01);
    bus.trigger('f', 'surprised'); w = run(L, c, 1.0, blinking); expect(w.Blink_L).toBeLessThan(0.01); expect(w.Blink_R).toBeLessThan(0.01);
    w = run(L, c, 3.2, blinking); expect(w.Blink_L).toBe(1); expect(w.Blink_R).toBe(1);
  });
  it('works with the real FaceAnimator: no blink ever overlaps a held expression', () => {
    const c = clock(); const bus = createExpressionBus(c.now); const L = new ExpressionLayer('f', bus); const f = new FaceAnimator(() => 0.1); // blinks often
    const s = { emote: false, talking: false, sitting: false, walking: false }; let sawBlinkAfter = false;
    bus.trigger('f', 'happy');
    for (let i = 0; i < 60 * 8; i++) { c.adv(1 / 60); const w = L.apply(f.update(1 / 60, s), 1 / 60); const t = (i + 1) / 60;
      if (t > 0.2 && t < 2.5) { expect(w.Blink_L).toBeLessThan(0.01); expect(w.happy).toBeGreaterThan(0.95); }
      if (t > 3.1 && w.Blink_L > 0.5) sawBlinkAfter = true; }
    expect(sawBlinkAfter).toBe(true);
  });
  it('keeps the lip flap while talking', () => {
    const c = clock(); const bus = createExpressionBus(c.now); const L = new ExpressionLayer('f', bus); bus.trigger('f', 'angry');
    const w = run(L, c, 0.5, { ...idleBase, mouth_a: 0.6 }); expect(w.mouth_a).toBeGreaterThan(0.4);
  });
  it('glides between two expressions instead of snapping', () => {
    const c = clock(); const bus = createExpressionBus(c.now); const L = new ExpressionLayer('f', bus);
    bus.trigger('f', 'sad'); run(L, c, 0.5); bus.trigger('f', 'happy'); const w = run(L, c, 1 / 60); expect(w.sorrow).toBeGreaterThan(0.6); expect(w.happy).toBeLessThan(0.4);
    const w2 = run(L, c, 0.8); expect(w2.happy).toBeGreaterThan(0.95); expect(w2.sorrow).toBeLessThan(0.05);
  });
  it('surprised: procedural morphs are added on top of the look and restored after; shows "!"', () => {
    const c = clock(); const bus = createExpressionBus(c.now); const L = new ExpressionLayer('m', bus); const look = { eyeBig: 0, browArch: 0.4 };
    bus.trigger('m', 'surprised'); let w = run(L, c, 0.4, idleBase, look); expect(w.yw_eyeBig).toBeCloseTo(1, 3); expect(w.yw_browArch).toBe(1); expect(w.mouth_o).toBeCloseTo(1, 3);
    expect(L.indicator).toBe('!'); const el = { textContent: '', style: { opacity: '' } } as unknown as HTMLElement; syncExpressionBadge(el, L); expect(el.textContent).toBe('!'); expect(el.style.opacity).toBe('1');
    w = run(L, c, 3, idleBase, look); expect(w.yw_eyeBig).toBe(0); expect(w.yw_browArch).toBeCloseTo(0.4, 6); expect(L.indicator).toBeNull(); syncExpressionBadge(el, L); expect(el.style.opacity).toBe('0');
  });
  it('every preset only uses morphs that exist on both avatars, weights in [0,1]', () => {
    const NAMES = ['Blink_L', 'Blink_R', 'angry', 'sorrow', 'happy', 'joy', 'mouth_a', 'mouth_e', 'mouth_i', 'mouth_o', 'mouth_u', 'yw_eyeBig', 'yw_browArch'];
    for (const e of EXPRESSIONS) { const p = PRESETS[e]; for (const [k, v] of Object.entries({ ...p.vrm, ...p.yw })) { expect(NAMES).toContain(k); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } }
    const c = clock(); const bus = createExpressionBus(c.now); const L = new ExpressionLayer('f', bus);
    for (let i = 0; i < 2000; i++) { if (i % 97 === 0) bus.trigger('f', EXPRESSIONS[i % 5]); c.adv(0.016); const w = L.apply({ ...idleBase, Blink_L: (i % 9) / 8, mouth_a: (i % 5) / 4 }, 0.016, { eyeBig: 1, browArch: 1 }); for (const v of Object.values(w)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } }
  });
  it('writes frames into prefixed blendshape names and procedural morphs', () => {
    const mesh = { morphTargetDictionary: { 'blendShape2.Blink_L': 0, 'blendShape2.angry': 2, yw_eyeBig: 3 }, morphTargetInfluences: [0, 0, 0, 0] };
    const idx = faceMorphIndex([mesh]); expect(idx[0]).toEqual({ Blink_L: 0, angry: 2, yw_eyeBig: 3 });
    writeFaceMorphs([mesh], idx, { Blink_L: 0.5, angry: 1, yw_eyeBig: 0.25, sorrow: 1 }); expect(mesh.morphTargetInfluences).toEqual([0.5, 0, 1, 0.25]);
  });
});

describe('mood menu entries', () => {
  it('lists the five approved expressions with emoji and accessible labels', () => {
    const m = moodItems(); expect(m.map((i) => i.id)).toEqual(['happy', 'angry', 'sad', 'surprised', 'wink']);
    for (const i of m) { expect(i.emoji.length).toBeGreaterThan(0); expect(i.aria).toMatch(/^Humeur : /); expect(expressionFromText(i.emoji)).toBe(i.id); }
  });
});
