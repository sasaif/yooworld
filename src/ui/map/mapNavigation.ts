import { districtById, mapPlaceById, type DistrictId } from '../../data/playerMap';

/** Ephemeral (never persisted) two-level navigation. Shared by the component and vitest. */
export type MapNav = { district: DistrictId | null; selected: string | null };
export const CITY_NAV: MapNav = { district: null, selected: null };
export type MapNavAction =
  | { type: 'city' }
  | { type: 'district'; id: DistrictId; selected?: string | null }
  | { type: 'select'; id: string | null };

export function mapNavigation(state: MapNav, action: MapNavAction): MapNav {
  if (action.type === 'city') return CITY_NAV;
  if (action.type === 'district') {
    if (!districtById(action.id)) return state;
    const p = action.selected ? mapPlaceById(action.selected) : undefined;
    return { district: action.id, selected: p?.district === action.id && p.status !== 'future' ? p.id : null };
  }
  if (action.id === null) return { ...state, selected: null };
  const p = mapPlaceById(action.id);
  return p?.district === state.district && p.status !== 'future' ? { ...state, selected: p.id } : state;
}
