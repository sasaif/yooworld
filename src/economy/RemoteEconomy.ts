import { EconomyError } from './money';
import type { EconomyService, EconomySnapshot } from './EconomyService';
/** FUTURE server-authoritative economy (not deployed — there is no backend yet).
 *  Contract (see docs/08-avatar-fashion-economy.md §API):
 *    GET  /economy/me                       -> balances, ledgers (paged), owned items, looks
 *    POST /economy/checkout {items, key}    -> server prices items from ITS catalogue, debits atomically (SQL tx), grants
 *    POST /economy/rewards/daily            -> server clock + cooldown
 *    POST /trades, /trades/:id/offer|accept|confirm|reject   -> escrow + double confirmation server-side
 *    POST /diamonds/orders {packId}         -> creates a payment order with the provider; diamonds are granted ONLY
 *                                              by the provider webhook after signature verification
 *  Every mutating call carries an Idempotency-Key. The client never sends balances or prices. */
export class RemoteEconomy implements EconomyService {
  readonly mode = 'remote' as const;
  constructor(readonly baseUrl: string) {}
  private no(): never { throw new EconomyError('server_required', 'Serveur économie non disponible (prototype local uniquement)'); }
  snapshot(): EconomySnapshot { return this.no(); }
  subscribe() { return () => {}; }
  currentAccount() { return this.no(); }
  switchAccount() { this.no(); }
  owns() { return this.no(); }
  async checkout() { return this.no(); }
  async spendGold() { return this.no(); }
  async claimDaily() { return this.no(); }
  async reportActivity() { return this.no(); }
  async saveLook() { return this.no(); }
  loadLook() { return this.no(); }
  async openTrade() { return this.no(); }
  async setOffer() { return this.no(); }
  async acceptTrade() { return this.no(); }
  async confirmTrade() { return this.no(); }
  async rejectTrade() { return this.no(); }
  /** never available against a real server: diamonds come only from verified payments */
  async devGrantDiamonds(): Promise<void> { throw new EconomyError('dev_only', 'Interdit hors mode DEV'); }
}
