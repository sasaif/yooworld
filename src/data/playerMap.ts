import { isPlayable } from './locations';
import data from './playerMapLocations.json';

export type MapStatus = 'open' | 'jalon' | 'soon';
export type MapPlace = {
  id: string;
  kind: 'place' | 'district';
  name: string;
  icon: string;
  status: MapStatus;
  thumb: string;
  blurb: string;
  inside?: string;
  travel?: string;
  current?: boolean;
  anchor: { x: number; y: number };
  dot: { x: number; y: number; side: 'left' | 'right' };
  hit: { x: number; y: number; w: number; h: number };
};

export const MAP_STATUS: Record<MapStatus, { label: string; cls: string }> = {
  open: { label: 'Ouvert', cls: 'open' },
  jalon: { label: 'Jalon 1', cls: 'jalon' },
  soon: { label: 'Bientôt', cls: 'soon' },
};

export const PLAYER_MAP = data.map as { width: number; height: number; src: string };
export const PLAYER_MAP_UI = data.ui as {
  close: { cx: number; cy: number; r: number };
  zoomIn: { x: number; y: number; w: number; h: number };
  zoomOut: { x: number; y: number; w: number; h: number };
  hits: { close: { x: number; y: number; w: number; h: number }; zoomIn: { x: number; y: number; w: number; h: number }; zoomOut: { x: number; y: number; w: number; h: number } };
};
export const PLAYER_MAP_PLACES: MapPlace[] = data.locations as MapPlace[];

export const mapPlaceById = (id: string) => PLAYER_MAP_PLACES.find((p) => p.id === id);

/** Visiter is only offered for currently open, built places that the game can travel to. */
export function canVisit(place: MapPlace, currentLocation: string): boolean {
  return place.status === 'open' && !!place.travel && place.travel !== currentLocation && isPlayable(place.travel);
}

export function visitLabel(place: MapPlace, currentLocation: string): string {
  if (place.travel === currentLocation && place.status === 'open') return 'Tu y es';
  if (!canVisit(place, currentLocation)) return 'Bientôt';
  return 'Visiter';
}
