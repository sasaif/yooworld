import { isPlayable } from './locations';
import data from './playerMapLocations.json';

/** Two-level player map: 6 districts (level 1) → destinations (level 2). Pure data + helpers (unit-tested). */
export type MapStatus = 'playable' | 'soon' | 'future';
export type DistrictId = 'residential' | 'center' | 'work' | 'fun' | 'beach' | 'nature';
export type Pct = { x: number; y: number };
export type PctRect = { x: number; y: number; w: number; h: number };

export type MapDistrict = {
  id: DistrictId;
  name: string;
  icon: string;
  /** level-1 badge position, map % */
  badge: Pct;
  /** level-1 tap areas, map % (a district may be split on the art, e.g. Loisirs) */
  zones: PctRect[];
  /** level-2 camera rect, map % */
  focus: PctRect;
};

export type MapPlace = {
  id: string;
  district: DistrictId;
  name: string;
  icon: string;
  status: MapStatus;
  thumb: string;
  blurb: string;
  /** locations.ts id; Visiter only when the scene is playable */
  travel?: string;
  /** shown as a big pin on level 1 (Usine, Ferme) */
  featured?: boolean;
  /** "Toi" marker position, map % */
  anchor: Pct;
  /** code-drawn label / pin position, map % */
  label: Pct;
};

export const MAP_STATUS: Record<MapStatus, { label: string; cls: string }> = {
  playable: { label: 'Ouvert', cls: 'open' },
  soon: { label: 'Bientôt', cls: 'soon' },
  future: { label: 'Plus tard', cls: 'future' },
};

/** `src` = clean art (no baked text / buttons); `fallback` = the original labelled art, used if the clean file fails to load. */
/** `hd`: optional 2x tiles of the clean art (2 cols x 2 rows, split at `cols` / `rows` in CSS px), loaded lazily on
 *  level 2 only when the zoom x devicePixelRatio would upscale the 1x art (e.g. iPhone DPR 3). */
export type MapHd = { src: string; cols: number[]; rows: number[] };
export const PLAYER_MAP = data.map as { width: number; height: number; src: string; fallback: string; hd?: MapHd };
export type HdTile = { id: string; src: string; x: number; y: number; w: number; h: number };
/** HD tiles that intersect the visible map rect (map CSS px). */
export function hdTilesFor(view: { x0: number; y0: number; x1: number; y1: number }, hd: MapHd | undefined = PLAYER_MAP.hd): HdTile[] {
  if (!hd) return [];
  const out: HdTile[] = [];
  for (let r = 0; r + 1 < hd.rows.length; r++) for (let c = 0; c + 1 < hd.cols.length; c++) {
    const x = hd.cols[c], y = hd.rows[r], w = hd.cols[c + 1] - x, h = hd.rows[r + 1] - y;
    if (x < view.x1 && x + w > view.x0 && y < view.y1 && y + h > view.y0) out.push({ id: `${r}${c}`, src: hd.src.replace('{r}', String(r)).replace('{c}', String(c)), x, y, w, h });
  }
  return out;
}
export const PLAYER_MAP_DISTRICTS: MapDistrict[] = data.districts as MapDistrict[];
export const PLAYER_MAP_PLACES: MapPlace[] = data.locations as MapPlace[];

export const mapPlaceById = (id: string) => PLAYER_MAP_PLACES.find((p) => p.id === id);
export const districtById = (id: string) => PLAYER_MAP_DISTRICTS.find((d) => d.id === id);
/** Destinations of a district: playable first, then soon, then future (stable within a group). */
const RANK: Record<MapStatus, number> = { playable: 0, soon: 1, future: 2 };
export const placesIn = (id: DistrictId) => PLAYER_MAP_PLACES.filter((p) => p.district === id).sort((a, b) => RANK[a.status] - RANK[b.status]);
export const featuredPlaces = () => PLAYER_MAP_PLACES.filter((p) => p.featured);
/** The destination the player currently stands in (for the "Toi" marker). */
export const placeForLocation = (loc: string) => PLAYER_MAP_PLACES.find((p) => p.travel === loc);

/** Visiter is only offered for playable, built places that the game can travel to. */
export function canVisit(place: MapPlace, currentLocation: string): boolean {
  return place.status === 'playable' && !!place.travel && place.travel !== currentLocation && isPlayable(place.travel);
}

export function visitLabel(place: MapPlace, currentLocation: string): string {
  if (place.status === 'playable' && place.travel === currentLocation) return 'Tu y es';
  if (canVisit(place, currentLocation)) return 'Visiter';
  return place.status === 'future' ? 'Plus tard' : 'Bientôt';
}

export function districtSummary(id: DistrictId) {
  const ps = placesIn(id);
  return { playable: ps.filter((p) => p.status === 'playable').length, soon: ps.filter((p) => p.status === 'soon').length, future: ps.filter((p) => p.status === 'future').length };
}
