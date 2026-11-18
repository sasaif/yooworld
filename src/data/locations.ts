/** World locations registry. Only 'apartment' is playable today; others are declared so the world
 *  system, navigation menu and save format already know about them (Phase 4). */
export interface LocationDef { id: string; name: string; kind: 'apartment' | 'public'; status: 'playable' | 'planned'; icon: string }
export const LOCATIONS: LocationDef[] = [
  { id: 'home', name: 'Mon appart', kind: 'apartment', status: 'playable', icon: '🏠' },
  { id: 'cafe', name: 'Café', kind: 'public', status: 'planned', icon: '☕' },
  { id: 'beach', name: 'Plage', kind: 'public', status: 'planned', icon: '🏖️' },
  { id: 'disco', name: 'Disco', kind: 'public', status: 'planned', icon: '🪩' },
  { id: 'mall', name: 'Boutiques', kind: 'public', status: 'planned', icon: '🛍️' },
];
