/** World locations registry. 'home' (the player's apartment) and 'beach' (Yoo Plage, a public spot) are
 *  playable; the others are declared so the world system, navigation menu and save format know about them. */
export interface LocationDef { id: string; name: string; kind: 'apartment' | 'public'; status: 'playable' | 'planned'; icon: string; blurb?: string;
  /** false = never saved as the current location (a reload brings the player back to the last remembered place) */
  remember?: boolean }
export const LOCATIONS: LocationDef[] = [
  { id: 'home', name: 'Mon appart', kind: 'apartment', status: 'playable', icon: '🏠', blurb: 'Ton chez-toi à décorer' },
  { id: 'beach', name: 'Yoo Plage', kind: 'public', status: 'playable', icon: '🏖️', blurb: 'Ponton, café & piste de danse' },
  { id: 'club', name: 'Yoo Games Club', kind: 'public', status: 'playable', icon: '🎲', blurb: 'Dominos · mode local contre des bots', remember: false },
  { id: 'cafe', name: 'Café', kind: 'public', status: 'planned', icon: '☕' },
  { id: 'disco', name: 'Disco', kind: 'public', status: 'planned', icon: '🪩' },
  { id: 'mall', name: 'Boutiques', kind: 'public', status: 'planned', icon: '🛍️' },
];
export const locationById = (id: string) => LOCATIONS.find((l) => l.id === id);
export const isPlayable = (id: string) => locationById(id)?.status === 'playable';
export const remembered = (id: string) => locationById(id)?.remember !== false;
