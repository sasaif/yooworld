import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  canVisit, districtById, districtSummary, featuredPlaces, mapPlaceById, placeForLocation, placesIn, visitLabel,
  PLAYER_MAP, PLAYER_MAP_DISTRICTS, PLAYER_MAP_PLACES, MAP_STATUS, type DistrictId,
} from '../src/data/playerMap';
import { camToPoint, camToRect, clampCam, fitCam, L2_TOP, l2Strip, maxScale, pctToPx, zoomAt } from '../src/ui/map/mapCamera';
import { CITY_NAV, mapNavigation } from '../src/ui/map/mapNavigation';
import { isPlayable, LOCATIONS } from '../src/data/locations';

const inMap = (p: { x: number; y: number }) => p.x > 0 && p.x < 100 && p.y > 0 && p.y < 100;
const D = (id: DistrictId) => placesIn(id).map((p) => p.id);

describe('player map: level 1 districts', () => {
  it('has exactly the 6 approved districts, in order, with name-only badges', () => {
    expect(PLAYER_MAP_DISTRICTS.map((d) => d.id)).toEqual(['residential', 'center', 'work', 'fun', 'beach', 'nature']);
    expect(PLAYER_MAP_DISTRICTS.map((d) => d.name)).toEqual(['Résidentiel', 'Centre-ville', 'Travail', 'Loisirs', 'Plage', 'Nature']);
    for (const d of PLAYER_MAP_DISTRICTS) {
      expect(inMap(d.badge)).toBe(true);
      expect(d.zones.length).toBeGreaterThan(0);
      for (const z of [...d.zones, d.focus]) {
        expect(z.w).toBeGreaterThan(0); expect(z.h).toBeGreaterThan(0);
        expect(z.x).toBeGreaterThanOrEqual(0); expect(z.y).toBeGreaterThanOrEqual(0);
        expect(z.x + z.w).toBeLessThanOrEqual(100); expect(z.y + z.h).toBeLessThanOrEqual(100);
      }
    }
  });

  it('district tap zones do not overlap each other', () => {
    const zs = PLAYER_MAP_DISTRICTS.flatMap((d) => d.zones.map((z) => ({ d: d.id, ...z })));
    for (const a of zs) for (const b of zs) {
      if (a === b || a.d === b.d) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.d} vs ${b.d}`).toBe(false);
    }
  });

  it('shows Usine and Ferme as the only featured (big) pins, both in Travail and Bientôt — no Gold promise', () => {
    expect(featuredPlaces().map((p) => p.id).sort()).toEqual(['factory', 'farm']);
    for (const p of featuredPlaces()) {
      expect(p.district).toBe('work'); expect(p.status).toBe('soon');
      expect(inMap(p.label)).toBe(true);
      expect(p.blurb).not.toMatch(/paie|Gold|gold|récompense|payé/i);
    }
  });
});

describe('player map: level 2 destinations', () => {
  it('keeps every former place (21) with a unique id, a district, a thumb and a code label position', () => {
    expect(PLAYER_MAP_PLACES).toHaveLength(21);
    expect(new Set(PLAYER_MAP_PLACES.map((p) => p.id)).size).toBe(21);
    for (const p of PLAYER_MAP_PLACES) {
      expect(districtById(p.district), p.id).toBeTruthy();
      expect(Object.keys(MAP_STATUS)).toContain(p.status);
      expect(inMap(p.label), p.id).toBe(true); expect(inMap(p.anchor), p.id).toBe(true);
      expect(fs.existsSync('public' + p.thumb), p.thumb).toBe(true);
    }
  });

  it('maps destinations to districts as approved', () => {
    expect(D('residential')).toEqual(['home']);
    expect(D('center')).toEqual(['club', 'cafe', 'plaza', 'promenade', 'festival']);
    expect(D('work')).toEqual(['factory', 'farm', 'depot', 'workshop']);
    expect(D('fun')).toEqual(['disco', 'museum', 'park', 'minigolf', 'restaurant', 'hotel']);
    expect(D('beach')).toEqual(['beach', 'pier']);
    expect(D('nature')).toEqual(['gardens', 'camping', 'zoo']);
    expect(mapPlaceById('pier')!.status).toBe('future');
    for (const id of ['museum', 'park', 'minigolf', 'zoo', 'camping']) expect(mapPlaceById(id)!.status).toBe('future');
  });

  it('playable ⇔ a real playable scene: exactly Mon appart, Yoo Plage and the Games Club', () => {
    const playable = PLAYER_MAP_PLACES.filter((p) => p.status === 'playable');
    expect(playable.map((p) => p.id).sort()).toEqual(['beach', 'club', 'home']);
    for (const p of PLAYER_MAP_PLACES) {
      const real = !!p.travel && isPlayable(p.travel);
      expect(p.status === 'playable', p.id).toBe(real);
    }
    // every playable scene in the game is reachable from the map
    for (const l of LOCATIONS.filter((l) => l.status === 'playable')) expect(placeForLocation(l.id)?.id, l.id).toBeTruthy();
  });

  it('Visiter / Tu y es / Bientôt / Plus tard labels', () => {
    expect(visitLabel(mapPlaceById('beach')!, 'home')).toBe('Visiter');
    expect(visitLabel(mapPlaceById('home')!, 'home')).toBe('Tu y es');
    expect(canVisit(mapPlaceById('home')!, 'home')).toBe(false);
    expect(visitLabel(mapPlaceById('factory')!, 'home')).toBe('Bientôt');
    expect(visitLabel(mapPlaceById('pier')!, 'home')).toBe('Plus tard');
    for (const p of PLAYER_MAP_PLACES.filter((x) => x.status !== 'playable')) for (const l of ['home', 'beach', 'club']) expect(canVisit(p, l)).toBe(false);
  });

  it('Games Club: in Centre-ville, first card, visitable from home and beach, "Tu y es" inside', () => {
    const club = mapPlaceById('club')!;
    expect(club.district).toBe('center'); expect(club.travel).toBe('club');
    expect(placesIn('center')[0].id).toBe('club');
    expect(canVisit(club, 'home')).toBe(true); expect(canVisit(club, 'beach')).toBe(true);
    expect(visitLabel(club, 'club')).toBe('Tu y es');
    expect(districtSummary('center')).toEqual({ playable: 1, soon: 3, future: 1 });
  });

  it('player-facing text says YoLand, never YooWorld, and promises no pay', () => {
    const txt = fs.readFileSync('src/data/playerMapLocations.json', 'utf8') + fs.readFileSync('src/ui/map/PlayerMap.tsx', 'utf8');
    expect(txt).not.toMatch(/YooWorld/);
    expect(txt).toMatch(/YoLand/);
    expect(fs.readFileSync('src/data/playerMapLocations.json', 'utf8')).not.toMatch(/paie|en ligne/i);
  });
});

describe('player map art', () => {
  it('uses the clean text-free art and keeps the original as fallback (both files present, same size)', () => {
    expect(PLAYER_MAP.src).toBe('/playermap/map_clean.webp');
    expect(PLAYER_MAP.fallback).toBe('/playermap/map.webp');
    expect(PLAYER_MAP.width).toBe(1672); expect(PLAYER_MAP.height).toBe(941);
    for (const f of [PLAYER_MAP.src, PLAYER_MAP.fallback]) {
      const b = fs.readFileSync('public' + f);
      expect(b.subarray(0, 4).toString()).toBe('RIFF'); expect(b.subarray(8, 12).toString()).toBe('WEBP');
      expect(b.length).toBeLessThan(700_000);
    }
  });
});

describe('player map: level-2 framing', () => {
  for (const [vw, vh] of [[852, 393], [1440, 900]]) {
    it(`every district focus fits above the card strip at ${vw}×${vh}`, () => {
      const W = PLAYER_MAP.width, H = PLAYER_MAP.height, fit = fitCam(vw, vh, W, H);
      const area = { x: 0, y: L2_TOP, w: vw, h: vh - L2_TOP - l2Strip(vw, vh) };
      for (const d of PLAYER_MAP_DISTRICTS) {
        const c = clampCam(camToRect(d.focus, area, W, H, Math.min(1, fit.s * 2.2), fit.s), vw, vh - l2Strip(vw, vh), W, H);
        expect(c.s).toBeGreaterThanOrEqual(fit.s - 1e-9);
        // the non-future pins of the district land inside the view, above the strip
        for (const p of placesIn(d.id).filter((x) => x.status !== 'future')) {
          const x = c.x + p.label.x / 100 * W * c.s, y = c.y + p.label.y / 100 * H * c.s;
          expect(x, `${d.id}/${p.id} x`).toBeGreaterThan(0); expect(x, `${d.id}/${p.id} x`).toBeLessThan(vw);
          expect(y, `${d.id}/${p.id} y`).toBeGreaterThan(L2_TOP - 20); expect(y, `${d.id}/${p.id} y`).toBeLessThan(vh - l2Strip(vw, vh));
        }
      }
    });
  }
  it('camToRect centres the rect in the area and respects maxS', () => {
    const c = camToRect({ x: 25, y: 25, w: 50, h: 50 }, { x: 0, y: 0, w: 400, h: 200 }, 1000, 1000, 10);
    expect(c.s).toBeCloseTo(0.4, 6);
    expect(c.x + 500 * c.s).toBeCloseTo(200, 6); expect(c.y + 500 * c.s).toBeCloseTo(100, 6);
    expect(camToRect({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 400, h: 200 }, 1000, 1000, 1).s).toBe(1);
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

// The component uses this exact reducer for district taps, card / pin selection, tabs, back and reopening.
describe('player map: ephemeral two-level navigation', () => {
  it('city → district → select location → back → city, with no third level', () => {
    let s = mapNavigation(CITY_NAV, { type: 'district', id: 'center' });
    expect(s).toEqual({ district: 'center', selected: null });
    s = mapNavigation(s, { type: 'select', id: 'club' });
    expect(s).toEqual({ district: 'center', selected: 'club' });
    expect(mapNavigation(s, { type: 'city' })).toEqual(CITY_NAV);
  });
  it('featured Usine / Ferme pins preselect the card in Travail', () => {
    for (const id of ['factory', 'farm']) expect(mapNavigation(CITY_NAV, { type: 'district', id: 'work', selected: id })).toEqual({ district: 'work', selected: id });
  });
  it('switching district clears the previous selection; cannot select a hidden or future location', () => {
    const s = mapNavigation({ district: 'work', selected: 'factory' }, { type: 'district', id: 'center' });
    expect(s.selected).toBe(null);
    expect(mapNavigation(s, { type: 'select', id: 'factory' })).toEqual(s);
    expect(mapNavigation(s, { type: 'select', id: 'festival' })).toEqual(s);
    expect(mapNavigation(s, { type: 'select', id: 'club' }).selected).toBe('club');
  });
  it('blank tap deselects; reopen resets to the city', () => {
    const s = { district: 'center' as const, selected: 'club' };
    expect(mapNavigation(s, { type: 'select', id: null })).toEqual({ district: 'center', selected: null });
    expect(mapNavigation(s, { type: 'city' })).toEqual(CITY_NAV);
  });
});
