/** Movable / resizable vertical chat panel: pure layout maths (unit-tested in tests/chat-panel-layout.test.ts).
 *  The panel is always kept fully inside the viewport, so its composer (input + Envoyer) is always fully visible. */
export interface Rect { x: number; y: number; w: number; h: number }
/** What the user chose (persisted under ywchatui.<env>.panel): distance from the RIGHT edge, top, size. */
export interface PanelPrefs { dr: number; top: number; w: number; h: number }
export interface PanelViewport {
  vw: number; vh: number;
  /** first free y under the top HUD chips */ topMin: number;
  /** dock rectangle (bottom centre) — the default panel sits above it when they share columns */ dock?: { l: number; r: number; t: number } | null;
  /** right safe-area inset */ sar?: number;
  /** forbidden zones (live DOM rects of the joystick, Run/Walk, dock, Mood, top HUD chips + the player-avatar safe
   *  area): the panel never covers them while the keyboard is closed (see fitPanel) */ avoid?: Zone[];
}
export interface Zone { l: number; t: number; r: number; b: number }
export const PANEL_MARGIN = 6;
/** composer + header + one message: below this the panel would clip its input */
export const PANEL_MIN = { w: 208, h: 168 };
/** keyboard open: smallest card (one message line + composer) */
export const PANEL_KB_MIN_H = 96;
/** Landscape phones keep the open panel at ≤ 22 % of the screen by default (it can be enlarged by the user). */
export const PHONE_AREA = 0.215;
export const isPhone = (vp: Pick<PanelViewport, 'vh'>) => vp.vh < 500;

export function panelMax(vp: PanelViewport) {
  return { w: Math.max(PANEL_MIN.w, Math.min(isPhone(vp) ? 340 : 420, Math.round(vp.vw * 0.5))), h: Math.max(PANEL_MIN.h, vp.vh - 2 * PANEL_MARGIN) };
}

/** Default size + spot: right column under the HUD chips, above the dock, narrow and vertical. */
export function defaultPanel(vp: PanelViewport): Rect {
  const m = PANEL_MARGIN, sar = vp.sar ?? 0;
  const w = isPhone(vp) ? Math.max(228, Math.min(264, Math.round(vp.vw * 0.29))) : Math.max(280, Math.min(320, Math.round(vp.vw * 0.22)));
  const x = vp.vw - Math.max(m + 2, sar) - w;
  const sharesDock = !!vp.dock && vp.dock.r > x && vp.dock.l < x + w;
  const bottom = sharesDock ? vp.dock!.t - m : vp.vh - m;
  const avail = Math.max(PANEL_MIN.h, bottom - vp.topMin);
  const h = isPhone(vp) ? Math.min(avail, Math.floor(PHONE_AREA * vp.vw * vp.vh / w)) : Math.min(avail, 460);
  return { x, y: Math.max(m, Math.min(vp.topMin, vp.vh - h - m)), w, h };
}

/** Keep the size within limits and the whole panel on screen. */
export function clampPanel(r: Rect, vp: Pick<PanelViewport, 'vw' | 'vh'>): Rect {
  const m = PANEL_MARGIN; const mx = panelMax(vp as PanelViewport);
  const w = Math.round(Math.min(Math.max(r.w, PANEL_MIN.w), mx.w, vp.vw - 2 * m));
  const h = Math.round(Math.min(Math.max(r.h, PANEL_MIN.h), mx.h, vp.vh - 2 * m));
  const x = Math.round(Math.min(Math.max(r.x, m), vp.vw - w - m));
  const y = Math.round(Math.min(Math.max(r.y, m), vp.vh - h - m));
  return { x, y, w, h };
}

/** Saved / default rect re-applied to the current viewport + zones (load, reload, resize, rotation). A saved rect was
 *  already 6 px clear when it was saved, so a 2 px gap is enough here (sub-pixel / font-settle shifts of the controls
 *  must not make the panel jump across the screen). */
export const rectFromPrefs = (p: PanelPrefs | null, vp: PanelViewport): Rect =>
  fitPanel(p ? { x: vp.vw - p.dr - p.w, y: p.top, w: p.w, h: p.h } : defaultPanel(vp), vp, 2);

/** gap kept between the panel and a forbidden zone */
export const ZONE_GAP = 6;
const hitsZone = (r: Rect, z: Zone, g: number) => r.x < z.r + g && r.x + r.w > z.l - g && r.y < z.b + g && r.y + r.h > z.t - g;
export const panelFree = (r: Rect, zones: readonly Zone[] = [], gap = ZONE_GAP) => !zones.some((z) => hitsZone(r, z, gap));
const overlapArea = (r: Rect, zones: readonly Zone[]) => zones.reduce((a, z) => a + Math.max(0, Math.min(r.x + r.w, z.r) - Math.max(r.x, z.l)) * Math.max(0, Math.min(r.y + r.h, z.b) - Math.max(r.y, z.t)), 0);
/** Nearest position (to x0, y0) where a w x h panel is fully on screen and clear of every zone, or null. Candidates are
 *  the wanted spot, the screen edges and the edges of each zone (the nearest free spot always touches one of them). */
export function nearestFree(w: number, h: number, x0: number, y0: number, vp: Pick<PanelViewport, 'vw' | 'vh'>, zones: readonly Zone[], g = ZONE_GAP): Rect | null {
  const m = PANEL_MARGIN;
  const cx = (x: number) => Math.round(Math.min(Math.max(x, m), vp.vw - w - m)), cy = (y: number) => Math.round(Math.min(Math.max(y, m), vp.vh - h - m));
  const xs = new Set([cx(x0), cx(m), cx(vp.vw)]), ys = new Set([cy(y0), cy(m), cy(vp.vh)]);
  for (const z of zones) { xs.add(cx(z.l - g - w)); xs.add(cx(z.r + g)); ys.add(cy(z.t - g - h)); ys.add(cy(z.b + g)); }
  let best: Rect | null = null, bd = Infinity;
  for (const x of xs) for (const y of ys) {
    const d = (x - x0) ** 2 + (y - y0) ** 2; if (d >= bd) continue;
    const r = { x, y, w, h }; if (panelFree(r, zones, g)) { best = r; bd = d; }
  }
  return best;
}
/** Keep the panel on screen AND off the forbidden zones: same size at the nearest allowed spot; if none fits, shrink
 *  step by step down to PANEL_MIN; if even the minimum cannot be placed, the minimum size at the least-covering spot. */
export function fitPanel(r: Rect, vp: PanelViewport, gap = ZONE_GAP): Rect {
  const c = clampPanel(r, vp); const zones = vp.avoid ?? [];
  if (!zones.length || panelFree(c, zones, gap)) return c;
  for (let i = 0; i <= 6; i++) {
    const k = i / 6; const w = Math.round(c.w + (PANEL_MIN.w - c.w) * k), h = Math.round(c.h + (PANEL_MIN.h - c.h) * k);
    // keep the composer corner (bottom-right) near where it was when shrinking
    const f = nearestFree(w, h, c.x + c.w - w, c.y + c.h - h, vp, zones, gap);
    if (f) return f;
    if (c.w === PANEL_MIN.w && c.h === PANEL_MIN.h) break;
  }
  const w = Math.min(PANEL_MIN.w, vp.vw - 2 * PANEL_MARGIN), h = Math.min(PANEL_MIN.h, vp.vh - 2 * PANEL_MARGIN);
  let best = clampPanel({ x: c.x, y: c.y, w, h }, vp), ba = overlapArea(best, zones);
  for (let x = PANEL_MARGIN; x <= vp.vw - w - PANEL_MARGIN; x += 8) for (let y = PANEL_MARGIN; y <= vp.vh - h - PANEL_MARGIN; y += 8) {
    const t = { x, y, w, h }; const a = overlapArea(t, zones); if (a < ba) { best = t; ba = a; }
  }
  return best;
}
export const prefsFromRect = (r: Rect, vp: Pick<PanelViewport, 'vw'>): PanelPrefs => ({ dr: Math.round(vp.vw - r.x - r.w), top: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

/** Size steps (− / +): scale around the bottom-right corner (the composer stays where the thumb is). */
export function stepPanel(r: Rect, dir: -1 | 1, vp: PanelViewport): Rect {
  const k = dir > 0 ? 1.14 : 1 / 1.14;
  const w = r.w * k, h = r.h * k;
  return fitPanel({ x: r.x + r.w - w, y: r.y + r.h - h, w, h }, vp);
}

/** Drag by the header. */
export const movePanel = (r: Rect, dx: number, dy: number, vp: PanelViewport) => fitPanel({ ...r, x: r.x + dx, y: r.y + dy }, vp);
/** Resize grip in the TOP-LEFT corner (the panel lives on the right; the composer corner stays put). */
export function resizePanel(r: Rect, dx: number, dy: number, vp: PanelViewport): Rect {
  const mx = panelMax(vp as PanelViewport); const right = r.x + r.w, bottom = r.y + r.h;
  const w = Math.min(Math.max(r.w - dx, PANEL_MIN.w), mx.w, right - PANEL_MARGIN);
  const h = Math.min(Math.max(r.h - dy, PANEL_MIN.h), mx.h, bottom - PANEL_MARGIN);
  // growing into a control stops that axis there (the panel does not jump away from the finger): try both axes, then
  // width only, then height only, else keep the current rect
  for (const [ww, hh] of [[w, h], [w, r.h], [r.w, h]]) {
    const c = clampPanel({ x: right - ww, y: bottom - hh, w: ww, h: hh }, vp);
    if (panelFree(c, vp.avoid)) return c;
  }
  return fitPanel(r, vp);
}

/** Keyboard up: the card sits right above the keyboard inside the visual viewport (top `vvTop`, height `vvH`, both in
 *  layout-viewport px: iOS may pan the page when the field gets the focus), keeps the user's column (x), shrinks if
 *  needed, and stays under the top HUD chips when there is room for it. */
export function keyboardPanel(r: Rect, vp: Pick<PanelViewport, 'vw' | 'topMin'>, vvH: number, contentH: number, vvTop = 0): Rect {
  const m = 4; const bottom = vvTop + vvH - m;
  let h = Math.min(r.h, contentH > 0 ? contentH : r.h, vvH - 2 * m);
  const roomUnderHud = bottom - Math.max(vp.topMin, vvTop + m);
  if (roomUnderHud >= PANEL_KB_MIN_H) h = Math.min(h, roomUnderHud);
  h = Math.max(Math.min(PANEL_KB_MIN_H, vvH - 2 * m), Math.round(h));
  const x = Math.round(Math.min(Math.max(r.x, m), vp.vw - r.w - m));
  return { x, y: Math.round(bottom - h), w: r.w, h };
}

export function parsePrefs(raw: string | null): PanelPrefs | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PanelPrefs>;
    const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    return ok(p.dr) && ok(p.top) && ok(p.w) && ok(p.h) ? { dr: p.dr!, top: p.top!, w: p.w!, h: p.h! } : null;
  } catch { return null; }
}
