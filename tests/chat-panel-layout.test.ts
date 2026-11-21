import { describe, expect, it } from 'vitest';
import {
  PANEL_KB_ROOM_H, PANEL_MIN, clampPanel, defaultPanel, fitPanel, keyboardPanel, movePanel, panelFree, parsePrefs, prefsFromRect, rectFromPrefs, resizePanel, stepPanel,
  type PanelViewport, type Rect, type Zone,
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
      if (vvH - 4 - vp.topMin >= PANEL_KB_ROOM_H) expect(k.y).toBeGreaterThanOrEqual(vp.topMin);
    }
  });
  it('keyboard: never squeezes the card under the HUD below header + one message line + composer (CI 140 px case)', () => {
    for (let vvH = 100; vvH <= 260; vvH += 2) {
      const k = keyboardPanel(defaultPanel(IP15), IP15, vvH, 150);
      expect(k.h).toBeGreaterThanOrEqual(Math.min(PANEL_KB_ROOM_H, vvH - 8)); expect(k.y + k.h).toBeLessThanOrEqual(vvH);
    }
  });

  it('keyboard with a panned visual viewport (iOS scrolls the page): the whole card stays inside the visible band', () => {
    for (const [vvH, top] of [[140, 60], [203, 40], [120, 90]] as const) {
      const k = keyboardPanel(defaultPanel(IP15), IP15, vvH, 150, top);
      expect(k.y).toBeGreaterThanOrEqual(top); expect(k.y + k.h).toBeLessThanOrEqual(top + vvH);
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

  describe('forbidden zones (BUG-V1 / V2)', () => {
    // SE 667x375 controls: joystick, Run/Walk, dock, Mood, top chips, avatar
    const Z: Zone[] = [{ l: 14, t: 237, r: 138, b: 361 }, { l: 143, t: 300, r: 191, b: 348 }, { l: 165, t: 322, r: 503, b: 372 }, { l: 452, t: 322, r: 503, b: 366 },
      { l: 8, t: 8, r: 300, b: 40 }, { l: 400, t: 8, r: 660, b: 40 }, { l: 240, t: 120, r: 330, b: 260 }];
    const vp: PanelViewport = { ...SE, avoid: Z };
    it('a drag onto any control ends on a free spot, same size when one exists', () => {
      const start = defaultPanel(vp);
      for (const z of Z) {
        const r = movePanel(start, (z.l + z.r) / 2 - (start.x + start.w / 2), (z.t + z.b) / 2 - (start.y + start.h / 2), vp);
        expect(panelFree(r, Z)).toBe(true); expect(inside(r, vp)).toBe(true);
      }
    });
    it('a saved forbidden rect is re-placed (and shrunk when nothing fits) on load / resize', () => {
      const r = rectFromPrefs({ dr: 667 - 6 - 300, top: 375 - 6 - 250, w: 300, h: 250 }, vp);
      expect(panelFree(r, Z, 2)).toBe(true); // load re-check uses a 2 px gap (drags keep 6 px)
      const small: PanelViewport = { vw: 568, vh: 320, topMin: 44, avoid: [{ l: 14, t: 190, r: 138, b: 314 }, { l: 150, t: 268, r: 520, b: 316 }, { l: 8, t: 8, r: 560, b: 40 }, { l: 230, t: 90, r: 310, b: 220 }] };
      const f = fitPanel({ x: 0, y: 0, w: 340, h: 300 }, small);
      expect(panelFree(f, small.avoid)).toBe(true); expect(f.w).toBeLessThan(340); expect(f.w).toBeGreaterThanOrEqual(PANEL_MIN.w);
    });
    it('no zones -> unchanged behaviour (plain clamp)', () => {
      const r = { x: -50, y: 500, w: 250, h: 260 };
      expect(fitPanel(r, SE)).toEqual(clampPanel(r, SE));
    });
    it('resizing into a control stops at the previous size instead of jumping', () => {
      const start = { x: 400, y: 60, w: 228, h: 235 };
      const r = resizePanel(start, -200, 0, vp); // grow left into the avatar zone
      expect(panelFree(r, Z)).toBe(true);
    });
  });
  it('BUG-V2b: at 568x320 the controls always win over the avatar safe area (soft zone)', () => {
    // live rects measured on iPhone 15 -> 568x320 (QA v2b_case0): joystick, Marche, dock, Mood + an avatar snapshot taken
    // while the camera was still settling, which left no spot clear of all zones for the saved 225x243 panel
    const ctl: Zone[] = [
      { l: 10, t: 14, r: 92, b: 36 }, { l: 97, t: 11, r: 265, b: 39 }, { l: 276, t: 7, r: 357, b: 43 }, { l: 362, t: 7, r: 438, b: 43 },
      { l: 443, t: 11, r: 478, b: 39 }, { l: 483, t: 6, r: 515, b: 44 }, { l: 520, t: 10, r: 579, b: 40 }, // top chips
      { l: 214, t: 264, r: 502, b: 314 }, { l: 508, t: 270, r: 560, b: 314 }, { l: 14, t: 184, r: 138, b: 308 }, { l: 158, t: 250, r: 206, b: 298 },
    ];
    // avatar snapshot taken in the first frame after the resize (camera aspect not settled yet): far too wide
    const vp: PanelViewport = { vw: 568, vh: 320, topMin: 50, dock: { l: 214, r: 502, t: 264 }, avoid: [...ctl, { l: 205, t: 67, r: 456, b: 222, soft: true }] };
    const r = rectFromPrefs({ dr: 126, top: 88, w: 225, h: 243 }, vp);
    expect(panelFree(r, ctl, 2)).toBe(true);
    expect(inside(r, vp)).toBe(true);
    // with a reachable avatar-free spot the avatar is still avoided
    const vp2: PanelViewport = { ...vp, avoid: [...ctl, { l: 228, t: 82, r: 333, b: 212, soft: true }] }; // settled snapshot
    const r2 = rectFromPrefs({ dr: 126, top: 88, w: 225, h: 243 }, vp2);
    expect(panelFree(r2, vp2.avoid, 2)).toBe(true);
    // nothing fits clear of the controls: least control area wins, not least total area
    const tiny: PanelViewport = { vw: 300, vh: 200, topMin: 8, avoid: [{ l: 0, t: 0, r: 150, b: 200 }, { l: 150, t: 0, r: 300, b: 100, soft: true }] };
    const r3 = fitPanel({ x: 6, y: 6, w: 208, h: 168 }, tiny);
    const hardArea = Math.max(0, Math.min(r3.x + r3.w, 150) - r3.x) * r3.h;
    expect(hardArea).toBeLessThanOrEqual(Math.max(0, 150 - (300 - 6 - r3.w)) * r3.h);
  });
});
