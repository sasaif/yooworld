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
export const PLAYER_MAP = data.map as { width: number; height: number; src: string; fallback: string };
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
