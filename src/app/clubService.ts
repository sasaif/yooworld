import { game } from './services';
import { ClubController } from '../game/club/ClubController';
/** Yoo Games Club tables (Local mode against bots; nothing saved, no Gold / XP). Kept out of services.ts on purpose. */
export const club = new ClubController(game);
(window as unknown as Record<string, unknown>).club = club; // debug / e2e handle
