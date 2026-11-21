import { describe, expect, it } from 'vitest';
import { CHAT_LAYOUT_DEFAULT, PANEL_KB_MIN_H, chatLayoutFrom, dockWidth, keyboardPanel, rightDockRect, type PanelViewport, type Rect, type Zone } from '../src/ui/chat/panelLayout';

// zones shaped like the live DOM at each size (joystick, Run, dock, top chips) — see tools/e2e-chat-right-dock.mjs
const zonesSEp: Zone[] = [{ l: 18, t: 517, r: 150, b: 649 }, { l: 158, t: 593, r: 210, b: 645 }, { l: 6, t: 10, r: 370, b: 40 }];
const SEp: PanelViewport = { vw: 375, vh: 667, topMin: 46, dock: { l: 164, r: 372, t: 595 }, avoid: zonesSEp };
const SEl: PanelViewport = { vw: 667, vh: 375, topMin: 40, dock: { l: 158, r: 509, t: 322 }, avoid: [{ l: 14, t: 239, r: 138, b: 363 }, { l: 146, t: 310, r: 196, b: 360 }, { l: 400, t: 6, r: 660, b: 34 }] };
const IP15p: PanelViewport = { vw: 393, vh: 852, topMin: 98, dock: { l: 128, r: 386, t: 762 }, avoid: [{ l: 18, t: 680, r: 150, b: 812 }, { l: 10, t: 69, r: 386, b: 92 }] };
const IP15l: PanelViewport = { vw: 852, vh: 393, topMin: 44, sar: 59, dock: { l: 318, r: 534, t: 340 }, avoid: [{ l: 73, t: 262, r: 197, b: 386 }, { l: 520, t: 6, r: 793, b: 38 }] };
const ALL = [SEp, SEl, IP15p, IP15l];
const hit = (r: Rect, z: Zone) => r.x < z.r && r.x + r.w > z.l && r.y < z.b && r.y + r.h > z.t;

describe('chat right-dock fallback (plan B, OFF by default)', () => {
  it('flag: OFF by default, ?chatLayout=right turns it on, float forces the current panel', () => {
    expect(CHAT_LAYOUT_DEFAULT).toBe('float');
    expect(chatLayoutFrom('')).toBe('float');
    expect(chatLayoutFrom('?fresh=1&lieu=appart')).toBe('float');
    expect(chatLayoutFrom('?chatLayout=right')).toBe('right-dock');
    expect(chatLayoutFrom('?a=1&chatLayout=right-dock')).toBe('right-dock');
    expect(chatLayoutFrom('?chatLayout=float', 'right-dock')).toBe('float');
    expect(chatLayoutFrom('?chatLayout=nope')).toBe('float');
  });
  it('width ≈ min(42vw, 260) portrait, min(34vw, 260) landscape', () => {
    expect(dockWidth(SEp)).toBe(158); expect(dockWidth(IP15p)).toBe(165);
    expect(dockWidth(SEl)).toBe(227); expect(dockWidth(IP15l)).toBe(260);
    expect(dockWidth({ vw: 1440, vh: 900 })).toBe(260);
  });
  it('column flush right (safe-area aware), under the chips, above the dock, clear of every control', () => {
    for (const vp of ALL) {
      const r = rightDockRect(vp);
      expect(r.x + r.w).toBe(vp.vw - Math.max(4, vp.sar ?? 0));
      expect(r.y).toBeGreaterThanOrEqual(vp.topMin);
      expect(r.y + r.h).toBeLessThanOrEqual(vp.dock!.t);
      for (const z of vp.avoid!) expect(hit(r, z)).toBe(false);
      expect(r.h).toBeGreaterThan(vp.vh * 0.5);
    }
  });
  it('soft zones (avatar) never move the column', () => {
    const a = rightDockRect(SEp); const b = rightDockRect({ ...SEp, avoid: [...zonesSEp, { l: 200, t: 200, r: 360, b: 400, soft: true }] });
    expect(b).toEqual(a);
  });
  it('a control in the right column trims it (upper half -> top, lower half -> bottom)', () => {
    const low = rightDockRect({ ...SEp, avoid: [...zonesSEp, { l: 300, t: 500, r: 370, b: 540 }] });
    expect(low.y + low.h).toBeLessThanOrEqual(494);
    const high = rightDockRect({ ...SEp, avoid: [...zonesSEp, { l: 300, t: 60, r: 370, b: 100 }] });
    expect(high.y).toBeGreaterThanOrEqual(106);
  });
  it('too short: narrows to pass beside a tall control instead of collapsing', () => {
    const vp: PanelViewport = { vw: 375, vh: 667, topMin: 46, avoid: [{ l: 190, t: 40, r: 215, b: 640 }] };
    const r = rightDockRect(vp);
    expect(r.x).toBeGreaterThanOrEqual(221); expect(r.w).toBeGreaterThanOrEqual(148); expect(r.h).toBeGreaterThan(400);
  });
  it('keyboard: the column keeps its x / width and sits right above the keyboard', () => {
    for (const vp of ALL) {
      const r = rightDockRect(vp); const vvH = Math.round(vp.vh * 0.55);
      const k = keyboardPanel(r, vp, vvH, r.h);
      expect(k.x).toBe(r.x); expect(k.w).toBe(r.w);
      expect(k.y + k.h).toBeLessThanOrEqual(vvH); expect(k.h).toBeGreaterThanOrEqual(Math.min(PANEL_KB_MIN_H, vvH - 8));
    }
  });
});
