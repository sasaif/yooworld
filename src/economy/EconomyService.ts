import type { Look } from '../fashion/types';
import type { Totals } from './money';
import type { Account, EconomyState } from './bank';
import type { Trade, TradeOffer } from './trading';
import type { Activity } from './rewards';
/** The ONLY boundary the UI/game uses for money, ownership, purchases, rewards and trades.
 *  - LocalDevEconomy: development prototype, everything in localStorage, TEST balances, clearly flagged.
 *  - RemoteEconomy  : future server-authoritative implementation (the server owns balances, ledgers,
 *    ownership and trade escrow; the client only sends intents with idempotency keys).
 *  Real currency (Diamonds bought with money) must NEVER be trusted from the client. */
export type EconomyMode = 'local-dev' | 'remote';
export interface EconomySnapshot { mode: EconomyMode; account: Account; accounts: Account[]; trades: Trade[] }
export interface EconomyService {
  readonly mode: EconomyMode;
  /** synchronous read of the last known state (for rendering) + change subscription */
  snapshot(): EconomySnapshot;
  subscribe(cb: () => void): () => void;
  /** which local/remote account is acting (local-dev: switch between the two TEST accounts) */
  currentAccount(): string;
  switchAccount(id: string): void;
  owns(itemId: string, accountId?: string): boolean;
  checkout(itemIds: string[], idempotencyKey: string): Promise<{ granted: string[]; totals: Totals }>;
  /** gold spent on furniture / room finishes (same Gold wallet as the fashion shop) */
  spendGold(amount: number, memo: string, idempotencyKey: string): Promise<void>;
  claimDaily(): Promise<number>;
  reportActivity(act: Activity, seconds: number): Promise<number>;
  saveLook(look: Look): Promise<void>;
  loadLook(body: Look['body']): Look | null;
  // ---- Gold trading (only gold; diamonds are not representable in TradeOffer) ----
  openTrade(withAccount: string, tradeId: string): Promise<Trade>;
  setOffer(tradeId: string, offer: TradeOffer): Promise<Trade>;
  acceptTrade(tradeId: string): Promise<Trade>;
  confirmTrade(tradeId: string): Promise<Trade>;
  rejectTrade(tradeId: string, cancel?: boolean): Promise<Trade>;
  // ---- Diamonds ----
  /** DEV ONLY: grants test diamonds without any payment. Throws 'dev_only' in remote mode. */
  devGrantDiamonds(amount: number): Promise<void>;
  /** raw state (local-dev only, for the dev panel / tests) */
  debugState?(): EconomyState;
}
export const newTxId = (prefix: string) => `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
