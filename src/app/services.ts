import { world } from '../game/world';
import { GameController } from '../game/GameController';
import { LocalStorageRepository, MemoryRepository } from '../persistence/LocalStorageRepository';
import { OfflineTransport } from '../net/NetworkTransport';
/** Composition root: pick implementations here (server repo / real transport later). */
const fresh = new URLSearchParams(location.search).has('shot') || new URLSearchParams(location.search).has('fresh');
export const game = new GameController(fresh ? new MemoryRepository() : new LocalStorageRepository(localStorage), new OfflineTransport());
(window as unknown as { game: GameController }).game = game; // debug handle
(window as unknown as { __world: unknown }).__world = world; // debug / e2e handle
