/** Glam eye looks (gothic v2, approved 2026-11-21): a long winged liner painted on the face atlas, on top of the
 *  usual shadow / liner layers of decals.ts. Pure Canvas 2D in atlas space, positions from the eye UV landmarks. */
export function paintWingLiner(x: CanvasRenderingContext2D, eyes: { c: readonly [number, number]; out: number }[], color: string, size: number) {
  const k = size / 1024; x.save(); x.globalAlpha = 0.96; x.fillStyle = color;
  for (const e of eyes) {
    const [ex, ey] = e.c; const o = e.out;
    // thick upper lash line that sweeps out into a sharp wing
    x.beginPath(); x.moveTo(ex - o * 18 * k, ey - 12 * k); x.quadraticCurveTo(ex + o * 6 * k, ey - 17 * k, ex + o * 24 * k, ey - 6 * k);
    x.lineTo(ex + o * 40 * k, ey - 16 * k); x.lineTo(ex + o * 25 * k, ey - 1 * k); x.quadraticCurveTo(ex + o * 6 * k, ey - 12 * k, ex - o * 18 * k, ey - 9 * k); x.closePath(); x.fill();
  }
  x.restore();
}
