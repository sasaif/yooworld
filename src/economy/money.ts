/** Currencies. GOLD = soft currency (earned in game, tradable between players).
 *  DIAMOND = premium currency (real-money only, account-bound: never transferable, tradable or giftable).
 *  There is deliberately NO conversion function between the two, in either direction. */
export type Currency = 'gold' | 'diamond';
export const CURRENCIES: readonly Currency[] = ['gold', 'diamond'];
export const CURRENCY_ICON: Record<Currency, string> = { gold: '🪙', diamond: '💎' };
export const CURRENCY_LABEL: Record<Currency, string> = { gold: 'Or', diamond: 'Diamants' };
export type Price = { currency: Currency; amount: number };
export type Totals = Record<Currency, number>;
export const zeroTotals = (): Totals => ({ gold: 0, diamond: 0 });

export class EconomyError extends Error {
  constructor(readonly code: EconomyErrorCode, message?: string) { super(message ?? code); this.name = 'EconomyError'; }
}
export type EconomyErrorCode =
  | 'invalid_amount' | 'insufficient_funds' | 'unknown_item' | 'already_owned' | 'duplicate_in_cart' | 'not_for_sale'
  | 'unknown_account' | 'duplicate_tx' | 'not_transferable' | 'trade_state' | 'trade_not_participant' | 'trade_self'
  | 'reward_cooldown' | 'reward_cap' | 'dev_only' | 'server_required' | 'empty_cart' | 'not_owned' | 'wrong_body';

/** Amounts are positive safe integers (no fractions, no NaN/Infinity, no negatives, no overflow). */
export function assertAmount(n: unknown): asserts n is number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) throw new EconomyError('invalid_amount', `Montant invalide : ${String(n)}`);
}
export const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ');
