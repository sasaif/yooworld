import type { ApartmentLayout } from '../game/apartment/ApartmentModel';
import type { Inventory } from '../game/inventory/Inventory';
export interface Appearance { body: string; hairTint?: string; outfit?: Record<string, string> } // slots: top, bottom, shoes, hat, ...
export interface Profile { version: 1; id: string; name: string; appearance: Appearance; homeId: string; friends: string[]; createdAt: number;
  /** last location the player was in ('home' | 'beach' …); missing in older saves = 'home' */
  location?: string }

/** Persistence boundary. The game only talks to this interface: swap LocalStorageRepository for an
 *  HTTP/WebSocket-backed implementation later without touching game features. All methods are async. */
export interface GameRepository {
  loadProfile(): Promise<Profile | null>;
  saveProfile(p: Profile): Promise<void>;
  loadApartment(id: string): Promise<ApartmentLayout | null>;
  saveApartment(a: ApartmentLayout): Promise<void>;
  loadInventory(ownerId: string): Promise<Inventory | null>;
  saveInventory(inv: Inventory): Promise<void>;
}
