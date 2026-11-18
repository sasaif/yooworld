/** Procedural facial animation driven by the avatar's VRM-style blendshapes (pure, unit-tested).
 *  Juanita / Juan ship Blink_L/R, happy, joy, angry, sorrow and mouth_a/e/i/o/u morph targets. */
export interface FaceInput { emote: boolean; talking: boolean; sitting: boolean; walking: boolean }
export type FaceKey = 'Blink_L' | 'Blink_R' | 'happy' | 'joy' | 'mouth_a' | 'mouth_o' | 'mouth_i';
export type FaceWeights = Record<FaceKey, number>;

const BLINK = 0.14; // s, full close+open
export class FaceAnimator {
  private t = 0; private next: number; private blinkAt = -1; private w: FaceWeights = { Blink_L: 0, Blink_R: 0, happy: 0, joy: 0, mouth_a: 0, mouth_o: 0, mouth_i: 0 };
  constructor(private rnd: () => number = Math.random) { this.next = 0.8 + rnd() * 2.5; }
  update(dt: number, s: FaceInput): FaceWeights {
    this.t += dt;
    if (this.blinkAt < 0 && this.t >= this.next) { this.blinkAt = this.t; }
    let blink = 0;
    if (this.blinkAt >= 0) {
      const k = (this.t - this.blinkAt) / BLINK; blink = k < 0.5 ? k * 2 : Math.max(0, 2 - k * 2);
      if (k >= 1) { this.blinkAt = -1; this.next = this.t + 1.8 + this.rnd() * 3.2 - (this.rnd() < 0.15 ? 1.6 : 0); } // sometimes a double blink
    }
    // mood: a soft smile at rest, a big grin when dancing, relaxed when sitting
    const want = { happy: s.emote ? 0.0 : s.sitting ? 0.35 : 0.22, joy: s.emote ? 0.85 : 0 };
    const ease = (a: number, b: number, r: number) => a + (b - a) * Math.min(1, dt * r);
    this.w.happy = ease(this.w.happy, want.happy, 4); this.w.joy = ease(this.w.joy, want.joy, 5);
    // lip flap while a speech bubble is shown
    const talk = s.talking ? Math.max(0, Math.sin(this.t * 17)) * 0.55 + Math.max(0, Math.sin(this.t * 7.3 + 1)) * 0.25 : 0;
    this.w.mouth_a = ease(this.w.mouth_a, talk, 18); this.w.mouth_o = ease(this.w.mouth_o, s.talking ? Math.max(0, Math.sin(this.t * 5.1)) * 0.3 : 0, 10);
    this.w.mouth_i = ease(this.w.mouth_i, s.walking ? 0.1 : 0, 3);
    // joy already closes the eyes: don't stack a blink on top
    const b = blink * (1 - this.w.joy);
    this.w.Blink_L = b; this.w.Blink_R = b;
    return this.w;
  }
}
/** Map canonical keys to morph indices of a mesh (names may be prefixed, e.g. "blendShape2.Blink_L"). */
export function morphIndex(dict: Record<string, number>): Partial<Record<FaceKey, number>> {
  const out: Partial<Record<FaceKey, number>> = {};
  for (const [name, i] of Object.entries(dict)) { const k = name.split('.').pop() as FaceKey; out[k] = i; }
  return out;
}
