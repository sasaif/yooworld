import type { ExpressionBus } from './bus';
import { PRESETS, TALK_KEEP, TIMING, VRM_KEYS, YW_KEYS, type ExprKey, type Expression, type VrmKey, type YwKey } from './presets';
/** Per-avatar expression layer, applied on top of FaceAnimator's output each frame (pure logic, unit-tested).
 *  - envelope: fade in 0.18 s, hold until the event ends (2.5 s), smooth fade out 0.5 s; re-triggers never pop
 *  - a new expression while one is shown glides between the two (no snap)
 *  - automatic blinking is scaled by (1 - amount): no blink fights a wink / squint / wide eyes; it comes back after
 *  - lip flap while talking is kept on the mouth keys (TALK_KEEP)
 *  - procedural `yw_*` morphs are written as look value + delta*amount, so the look's own eye/brow shape is restored. */
export type FaceFrame = Partial<Record<string, number>>;
const ss = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const zero = (): Record<ExprKey, number> => Object.fromEntries([...VRM_KEYS, ...YW_KEYS].map((k) => [k, 0])) as Record<ExprKey, number>;
const MOUTH = new Set<string>(['mouth_a', 'mouth_e', 'mouth_i', 'mouth_o', 'mouth_u']);

export class ExpressionLayer {
  /** linear envelope 0..1 (output amount = smoothstep of it) */ private lin = 0;
  private seq = -1; private expr: Expression | null = null; private T = zero(); private out: Record<string, number> = {};
  constructor(readonly charId: string, private bus: ExpressionBus) {}
  /** current expression (null once fully faded out) */ get current(): Expression | null { return this.lin > 0 ? this.expr : null; }
  get amount() { return ss(this.lin); }
  /** mark to show above the name tag, or null */ get indicator(): string | null { return this.expr && this.amount > 0.35 ? PRESETS[this.expr].indicator ?? null : null; }

  apply<B extends Partial<Record<string, number>>>(base: B, dt: number, lookMorph?: Partial<Record<string, number>>): B & Record<ExprKey, number> {
    const ev = this.bus.get(this.charId); const now = this.bus.now();
    if (ev && ev.seq !== this.seq) { this.seq = ev.seq; if (this.lin <= 0) this.T = targetOf(ev.expr); this.expr = ev.expr; }
    const want = ev && now < ev.until ? 1 : 0;
    this.lin = want ? Math.min(1, this.lin + dt / TIMING.fadeIn) : Math.max(0, this.lin - dt / TIMING.fadeOut);
    if (this.expr) { const tgt = targetOf(this.expr); const g = 1 - Math.exp(-dt * TIMING.morphGlide); for (const k in tgt) { const kk = k as ExprKey; this.T[kk] += (tgt[kk] - this.T[kk]) * g; } }
    const a = this.amount; const o = this.out;
    for (const k in base) o[k] = base[k] as number;
    for (const k of VRM_KEYS) {
      const b = (base as Partial<Record<VrmKey, number>>)[k] ?? 0; let t = this.T[k];
      if (MOUTH.has(k)) t = Math.max(t, b * TALK_KEEP);
      o[k] = clamp(b + (t - b) * a); // blinks included: b*(1-a) + t*a -> auto blink suppressed while shown
    }
    for (const k of YW_KEYS) { const lk = k.slice(3); const b = lookMorph?.[lk] ?? 0; o[k] = clamp(b + this.T[k] * a); }
    return o as B & Record<ExprKey, number>;
  }
}
function targetOf(e: Expression): Record<ExprKey, number> { const t = zero(); const p = PRESETS[e]; for (const k in p.vrm) t[k as VrmKey] = p.vrm[k as VrmKey]!; for (const k in p.yw ?? {}) t[k as YwKey] = p.yw![k as YwKey]!; return t; }
const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Morph-name -> index maps of the face meshes (names may be prefixed: "blendShape2.Blink_L" -> "Blink_L"; "yw_eyeBig" stays). */
export function faceMorphIndex(meshes: { morphTargetDictionary?: Record<string, number> }[]): Record<string, number>[] {
  return meshes.map((m) => { const out: Record<string, number> = {}; for (const [name, i] of Object.entries(m.morphTargetDictionary ?? {})) out[name.split('.').pop()!] = i; return out; });
}
/** Write a face frame into the meshes' influences (keys absent from a mesh are skipped). */
export function writeFaceMorphs(meshes: { morphTargetInfluences?: number[] }[], idx: Record<string, number>[], w: FaceFrame) {
  for (let i = 0; i < meshes.length; i++) { const inf = meshes[i].morphTargetInfluences; const ix = idx[i]; if (!inf || !ix) continue; for (const k in w) { const j = ix[k]; if (j !== undefined) inf[j] = w[k]!; } }
}
/** Sync the small DOM mark above the name tag (e.g. "!" for surprised). Cheap: touches the DOM only on change. */
export function syncExpressionBadge(el: HTMLElement | null, layer: Pick<ExpressionLayer, 'indicator'>) {
  if (!el) return; const t = layer.indicator ?? '';
  if (el.textContent !== t) el.textContent = t;
  const on = t ? '1' : '0'; if (el.style.opacity !== on) el.style.opacity = on;
}
