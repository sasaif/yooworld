/** Pure camera math for the 2D player map (unit-tested; no DOM). */

export type Cam = { x: number; y: number; s: number };

export function fitCam(vw: number, vh: number, mw: number, mh: number): Cam {
  const s = Math.min(vw / mw, vh / mh);
  return { s, x: (vw - mw * s) / 2, y: (vh - mh * s) / 2 };
}

export function clampCam(c: Cam, vw: number, vh: number, mw: number, mh: number): Cam {
  const ww = mw * c.s, hh = mh * c.s;
  const x = ww <= vw ? (vw - ww) / 2 : Math.min(0, Math.max(vw - ww, c.x));
  const y = hh <= vh ? (vh - hh) / 2 : Math.min(0, Math.max(vh - hh, c.y));
  return { s: c.s, x, y };
}

export function maxScale(fit: Cam, factor = 3.2) { return fit.s * factor; }

/** Zoom around a point in view coordinates (clientX/Y relative to the view origin). */
export function zoomAt(cam: Cam, lx: number, ly: number, ns: number, minS: number, maxS: number): Cam {
  const s = Math.max(minS, Math.min(maxS, ns));
  const k = s / cam.s;
  return { s, x: lx - (lx - cam.x) * k, y: ly - (ly - cam.y) * k };
}

/** Center the camera on a point given in map-percentage coordinates. */
export function camToPoint(xPct: number, yPct: number, s: number, vw: number, vh: number, mw: number, mh: number): Cam {
  return { s, x: vw / 2 - (xPct / 100) * mw * s, y: vh / 2 - (yPct / 100) * mh * s };
}

export function pctToPx(pct: number, total: number) { return pct / 100 * total; }
