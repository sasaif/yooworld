import { describe, expect, it } from 'vitest';
import {
  PANEL_MIN, clampPanel, defaultPanel, keyboardPanel, movePanel, parsePrefs, prefsFromRect, rectFromPrefs, resizePanel, stepPanel,
  type PanelViewport, type Rect,
} from '../src/ui/chat/panelLayout';
import { CHAT_UI_PREFIX, chatUi, chatUiKey } from '../src/persistence/storage';
import { isProdKey, looksLikeFullKey } from '../src/persistence/saveEnv';

const IP15: PanelViewport = { vw: 852, vh: 393, topMin: 44, dock: { l: 286, r: 566, t: 338 } };
const SE: PanelViewport = { vw: 667, vh: 375, topMin: 44, dock: { l: 165, r: 503, t: 322 } };
const DESK: PanelViewport = { vw: 1440, vh: 900, topMin: 60, dock: { l: 520, r: 920, t: 820 } };
const inside = (r: Rect, vp: PanelViewport) => r.x >= 0 && r.y >= 0 && r.x + r.w <= vp.vw && r.y + r.h <= vp.vh;
const area = (r: Rect, vp: PanelViewport) => (100 * r.w * r.h) / (vp.vw * vp.vh);

describe('vertical chat panel layout', () => {
  it('default: narrow readable column on the right, under the HUD, above the dock, ≤ 22 % on phones', () => {
    for (const vp of [IP15, SE]) {
      const r = defaultPanel(vp);
      expect(r.w).toBeGreaterThanOrEqual(228); expect(r.w).toBeLessThanOrEqual(264);
      expect(r.h).toBeGreaterThanOrEqual(r.w); // vertical (taller than wide)
      expect(area(r, vp)).toBeLessThanOrEqual(22);
      expect(r.y).toBeGreaterThanOrEqual(vp.topMin);
      expect(inside(r, vp)).toBe(true);
      expect(r.x + r.w).toBeGreaterThan(vp.vw - 20); // right column
    }
    const d = defaultPanel(DESK);
    expect(d.w).toBeGreaterThanOrEqual(280); expect(d.w).toBeLessThanOrEqual(320); expect(d.h).toBeGreaterThan(d.w);
  });

  it('drag is clamped to the viewport (the composer can never leave the screen)', () => {
    const r = defaultPanel(IP15);
    for (const [dx, dy] of [[-5000, 0], [5000, 0], [0, -5000], [0, 5000], [3000, 3000]]) {
      const m = movePanel(r, dx, dy, IP15); expect(inside(m, IP15)).toBe(true); expect(m.w).toBe(r.w); expect(m.h).toBe(r.h);
    }
  });

  it('resize grip + − / + steps stay within min / max and on screen', () => {
    const r = defaultPanel(SE);
    const big = resizePanel(r, -2000, -2000, SE); expect(inside(big, SE)).toBe(true); expect(big.w).toBeGreaterThan(r.w);
    const small = resizePanel(r, 2000, 2000, SE); expect(small.w).toBe(PANEL_MIN.w); expect(small.h).toBe(PANEL_MIN.h); expect(inside(small, SE)).toBe(true);
    let s = r; for (let i = 0; i < 10; i++) s = stepPanel(s, 1, SE); expect(inside(s, SE)).toBe(true);
    let t = r; for (let i = 0; i < 10; i++) t = stepPanel(t, -1, SE); expect(t.w).toBe(PANEL_MIN.w); expect(t.h).toBe(PANEL_MIN.h);
    expect(stepPanel(r, 1, SE).w).toBeGreaterThan(r.w); expect(stepPanel(r, -1, SE).w).toBeLessThan(r.w);
  });

  it('persisted position / size round-trips and is re-clamped on a smaller screen (rotation / other phone)', () => {
    const r = movePanel(defaultPanel(IP15), -300, 20, IP15);
    const p = prefsFromRect(r, IP15);
    expect(parsePrefs(JSON.stringify(p))).toEqual(p);
    expect(rectFromPrefs(p, IP15)).toEqual(r);
    const onSe = rectFromPrefs({ ...p, w: 900, h: 900 }, SE); expect(inside(onSe, SE)).toBe(true);
    expect(parsePrefs('{bad')).toBeNull(); expect(parsePrefs('{"dr":1}')).toBeNull(); expect(rectFromPrefs(null, SE)).toEqual(clampPanel(defaultPanel(SE), SE));
  });

  it('keyboard: the card docks above the keyboard inside the visual viewport, under the HUD when there is room', () => {
    for (const [vp, vvH] of [[IP15, 203], [SE, 195], [IP15, 140], [IP15, 100], [DESK, 620]] as const) {
      const k = keyboardPanel(defaultPanel(vp), vp, vvH, 150);
      expect(k.y).toBeGreaterThanOrEqual(0); expect(k.y + k.h).toBeLessThanOrEqual(vvH);
      if (vvH - 4 - vp.topMin >= 96) expect(k.y).toBeGreaterThanOrEqual(vp.topMin);
    }
  });

  it('persists only under its own ywchatui.<env>. key, outside every save keyspace', () => {
    const k = chatUiKey('panel');
    expect(k.startsWith(CHAT_UI_PREFIX)).toBe(true); expect(CHAT_UI_PREFIX).toBe('ywchatui.');
    expect(isProdKey(k)).toBe(false); expect(looksLikeFullKey(k)).toBe(false);
    expect(k.startsWith('yooworld:') || k.startsWith('yw.') || k.startsWith('yw:')).toBe(false);
    chatUi.setItem('panel', '{"dr":1,"top":2,"w":240,"h":260}');
    expect(parsePrefs(chatUi.getItem('panel'))).toEqual({ dr: 1, top: 2, w: 240, h: 260 });
    chatUi.removeItem('panel'); expect(chatUi.getItem('panel')).toBeNull();
  });
});
