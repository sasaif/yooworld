import { describe, expect, it } from 'vitest';
import { canVisit, mapPlaceById, PLAYER_MAP, PLAYER_MAP_PLACES, PLAYER_MAP_UI, visitLabel } from '../src/data/playerMap';
import { camToPoint, clampCam, fitCam, maxScale, pctToPx, zoomAt } from '../src/ui/map/mapCamera';
import { isPlayable } from '../src/data/locations';

describe('player map data', () => {
  it('lists 25 places with unique ids and hit / dot / anchor', () => {
    expect(PLAYER_MAP_PLACES).toHaveLength(25);
    expect(new Set(PLAYER_MAP_PLACES.map((p) => p.id)).size).toBe(25);
    for (const p of PLAYER_MAP_PLACES) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.hit.w).toBeGreaterThan(0); expect(p.hit.h).toBeGreaterThan(0);
      expect(p.dot.x).toBeGreaterThan(0); expect(p.anchor.x).toBeGreaterThan(0);
      expect(['open', 'jalon', 'soon']).toContain(p.status);
    }
  });

  it('only Mon appart and Yoo Plage are open and visitable', () => {
    const open = PLAYER_MAP_PLACES.filter((p) => p.status === 'open');
    expect(open.map((p) => p.id).sort()).toEqual(['beach', 'home']);
    expect(canVisit(mapPlaceById('home')!, 'beach')).toBe(true);
    expect(canVisit(mapPlaceById('beach')!, 'home')).toBe(true);
    expect(canVisit(mapPlaceById('home')!, 'home')).toBe(false);
    expect(canVisit(mapPlaceById('beach')!, 'beach')).toBe(false);
    expect(visitLabel(mapPlaceById('home')!, 'home')).toBe('Tu y es');
    expect(visitLabel(mapPlaceById('beach')!, 'home')).toBe('Visiter');
    for (const p of open) {
      expect(p.travel).toBeTruthy();
      expect(isPlayable(p.travel!)).toBe(true);
    }
  });

  it('keeps Games Club as Jalon 1 (not visitable from the map)', () => {
    const club = mapPlaceById('club')!;
    expect(club.status).toBe('jalon');
    expect(club.travel).toBeUndefined();
    expect(canVisit(club, 'home')).toBe(false);
    expect(visitLabel(club, 'home')).toBe('Bientôt');
  });

  it('does not offer Visiter for Bientôt places, even if a scene id exists later', () => {
    const soon = PLAYER_MAP_PLACES.filter((p) => p.status === 'soon');
    expect(soon.length).toBe(22);
    for (const p of soon) expect(canVisit(p, 'home')).toBe(false);
  });

  it('places the Nature status dot to the right of the painted label, not over the N', () => {
    const n = mapPlaceById('nature')!;
    // painted "Nature" pill sits roughly at 16–24 % x, ~50 % y; the previous 23.86 % dot sat on its right edge
    expect(n.dot.x).toBeGreaterThan(25);
    expect(n.dot.x).toBeLessThan(30);
    expect(n.dot.y).toBeGreaterThan(48);
    expect(n.dot.y).toBeLessThan(54);
  });

  it('serves the WebP (not the 3 MB PNG) and has baked chrome hit targets', () => {
    expect(PLAYER_MAP.src).toBe('/playermap/map.webp');
    expect(PLAYER_MAP.width).toBe(1672);
    expect(PLAYER_MAP.height).toBe(941);
    expect(PLAYER_MAP_UI.hits.close.w).toBeGreaterThanOrEqual(44);
    expect(PLAYER_MAP_UI.hits.zoomIn.h).toBeGreaterThanOrEqual(44);
    expect(PLAYER_MAP_UI.hits.zoomOut.h).toBeGreaterThanOrEqual(44);
  });
});

describe('player map camera', () => {
  const W = 1672, H = 941, vw = 852, vh = 393;

  it('opens in a full-city fit (the whole map, including Yoo Plage, is visible)', () => {
    const c = fitCam(vw, vh, W, H);
    expect(c.s).toBeCloseTo(Math.min(vw / W, vh / H), 6);
    // height-limited on iPhone 15 landscape: map fills the height, letterboxed on the sides
    expect(c.y).toBeCloseTo(0, 6);
    expect(c.x).toBeGreaterThan(0);
    const left = -c.x / c.s, right = (vw - c.x) / c.s, top = -c.y / c.s, bot = (vh - c.y) / c.s;
    expect(left).toBeLessThanOrEqual(0.5);
    expect(top).toBeLessThanOrEqual(0.5);
    expect(right).toBeGreaterThanOrEqual(W - 0.5);
    expect(bot).toBeGreaterThanOrEqual(H - 0.5);
    const beach = mapPlaceById('beach')!;
    const by = pctToPx(beach.anchor.y, H);
    expect(by).toBeGreaterThan(top); expect(by).toBeLessThan(bot);
  });

  it('clamps pan so the map cannot leave the view', () => {
    const fit = fitCam(vw, vh, W, H);
    const loose = clampCam({ ...fit, x: 400, y: 400 }, vw, vh, W, H);
    // at fit scale the map already fits in height, so y stays the letterbox origin
    expect(loose.y).toBeCloseTo(fit.y, 6);
    const zoomed = clampCam({ s: fit.s * 2, x: 200, y: 200 }, vw, vh, W, H);
    expect(zoomed.x).toBeLessThanOrEqual(0);
    expect(zoomed.x).toBeGreaterThanOrEqual(vw - W * zoomed.s);
    expect(zoomed.y).toBeLessThanOrEqual(0);
    expect(zoomed.y).toBeGreaterThanOrEqual(vh - H * zoomed.s);
  });

  it('zooms around the pointer and stays within fit…3.2×', () => {
    const fit = fitCam(vw, vh, W, H);
    const mid = zoomAt(fit, vw / 2, vh / 2, fit.s * 2, fit.s, maxScale(fit));
    expect(mid.s).toBeCloseTo(fit.s * 2, 6);
    const tooFar = zoomAt(fit, vw / 2, vh / 2, fit.s * 10, fit.s, maxScale(fit));
    expect(tooFar.s).toBeCloseTo(maxScale(fit), 6);
    const tooSmall = zoomAt({ ...fit, s: fit.s * 2 }, vw / 2, vh / 2, fit.s * 0.1, fit.s, maxScale(fit));
    expect(tooSmall.s).toBeCloseTo(fit.s, 6);
    // a point under the cursor stays under the cursor
    const lx = 200, ly = 100;
    const z = zoomAt(fit, lx, ly, fit.s * 1.5, fit.s, maxScale(fit));
    const mx = (lx - fit.x) / fit.s, my = (ly - fit.y) / fit.s;
    expect(z.x + mx * z.s).toBeCloseTo(lx, 6);
    expect(z.y + my * z.s).toBeCloseTo(ly, 6);
  });

  it('can centre on a place (used by Visiter before the fade)', () => {
    const fit = fitCam(vw, vh, W, H);
    const beach = mapPlaceById('beach')!;
    const c = camToPoint(beach.anchor.x, beach.anchor.y, fit.s * 2.6, vw, vh, W, H);
    expect(c.x + pctToPx(beach.anchor.x, W) * c.s).toBeCloseTo(vw / 2, 6);
    expect(c.y + pctToPx(beach.anchor.y, H) * c.s).toBeCloseTo(vh / 2, 6);
  });
});
