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
}
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

export const rectFromPrefs = (p: PanelPrefs | null, vp: PanelViewport): Rect =>
  clampPanel(p ? { x: vp.vw - p.dr - p.w, y: p.top, w: p.w, h: p.h } : defaultPanel(vp), vp);
export const prefsFromRect = (r: Rect, vp: Pick<PanelViewport, 'vw'>): PanelPrefs => ({ dr: Math.round(vp.vw - r.x - r.w), top: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

/** Size steps (− / +): scale around the bottom-right corner (the composer stays where the thumb is). */
export function stepPanel(r: Rect, dir: -1 | 1, vp: Pick<PanelViewport, 'vw' | 'vh'>): Rect {
  const k = dir > 0 ? 1.14 : 1 / 1.14;
  const w = r.w * k, h = r.h * k;
  return clampPanel({ x: r.x + r.w - w, y: r.y + r.h - h, w, h }, vp);
}

/** Drag by the header. */
export const movePanel = (r: Rect, dx: number, dy: number, vp: Pick<PanelViewport, 'vw' | 'vh'>) => clampPanel({ ...r, x: r.x + dx, y: r.y + dy }, vp);
/** Resize grip in the TOP-LEFT corner (the panel lives on the right; the composer corner stays put). */
export function resizePanel(r: Rect, dx: number, dy: number, vp: Pick<PanelViewport, 'vw' | 'vh'>): Rect {
  const mx = panelMax(vp as PanelViewport); const right = r.x + r.w, bottom = r.y + r.h;
  const w = Math.min(Math.max(r.w - dx, PANEL_MIN.w), mx.w, right - PANEL_MARGIN);
  const h = Math.min(Math.max(r.h - dy, PANEL_MIN.h), mx.h, bottom - PANEL_MARGIN);
  return clampPanel({ x: right - w, y: bottom - h, w, h }, vp);
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
