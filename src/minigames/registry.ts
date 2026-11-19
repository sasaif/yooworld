/**
 * Yoo Games Club catalogue. Adding a game = a rules module + a bot + one entry here (and its table overlay); the club,
 * lobby, seats, turn engine and results screen are shared. Only 'playable' games can be started.
 */
export interface GameDef { id: string; name: string; icon: string; seats: { min: number; max: number }; status: 'playable' | 'soon'; blurb: string }
export const GAMES: GameDef[] = [
  { id: 'dominoes', name: 'Dominos', icon: '🁫', seats: { min: 2, max: 4 }, status: 'playable', blurb: 'Double-six, jeu de la pioche' },
  { id: 'belote', name: 'Belote', icon: '🃏', seats: { min: 4, max: 4 }, status: 'soon', blurb: 'Belote classique, 2 équipes' },
  { id: 'checkers', name: 'Dames', icon: '⛀', seats: { min: 2, max: 2 }, status: 'soon', blurb: 'Bientôt' },
];
export const gameById = (id: string) => GAMES.find((g) => g.id === id);
/** The one honest label of Local mode tables. Never "multijoueur" / "en ligne" until a real server room exists. */
export const LOCAL_BADGE = 'Mode local · contre des bots';
