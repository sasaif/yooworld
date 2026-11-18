import { describe, expect, it } from 'vitest';
import { FaceAnimator, morphIndex } from '../src/render/avatar/face';

const idle = { emote: false, talking: false, sitting: false, walking: false };
describe('face animator', () => {
  it('blinks within a few seconds and reopens the eyes', () => {
    const f = new FaceAnimator(() => 0.5); let closed = 0, maxB = 0;
    for (let i = 0; i < 60 * 6; i++) { const w = f.update(1 / 60, idle); maxB = Math.max(maxB, w.Blink_L); if (w.Blink_L > 0.9) closed++; }
    expect(maxB).toBeGreaterThan(0.9); expect(closed).toBeLessThan(30); // a blink is short
    expect(f.update(1 / 60, idle).Blink_L).toBeLessThan(0.9);
  });
  it('smiles when dancing and moves the mouth when talking', () => {
    const f = new FaceAnimator(() => 0.5); let mouth = 0, joy = 0;
    for (let i = 0; i < 120; i++) { const w = f.update(1 / 60, { ...idle, emote: true, talking: true }); mouth = Math.max(mouth, w.mouth_a); joy = w.joy; }
    expect(joy).toBeGreaterThan(0.7); expect(mouth).toBeGreaterThan(0.3);
  });
  it('weights stay in [0,1]', () => {
    const f = new FaceAnimator(); for (let i = 0; i < 2000; i++) { const w = f.update(0.016, { emote: i % 500 < 250, talking: i % 300 < 100, sitting: i % 700 < 300, walking: false }); Object.values(w).forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }); }
  });
  it('maps prefixed blendshape names', () => {
    expect(morphIndex({ 'blendShape2.Blink_L': 0, 'blendShape2.joy': 5 })).toEqual({ Blink_L: 0, joy: 5 });
  });
});
