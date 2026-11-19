import { assertAmount, EconomyError, type Currency } from './money';
/** One append-only ledger per account AND per currency. Gold and Diamond ledgers never share entries.
 *  Every entry carries a transaction id; re-applying the same (txId, kind) is a no-op (idempotent),
 *  which is what prevents duplicated credits when a request is retried. Balances can never go negative. */
export type GoldKind = 'test_grant' | 'reward' | 'purchase' | 'furniture' | 'trade_escrow' | 'trade_release' | 'trade_receive' | 'refund';
export type DiamondKind = 'test_grant' | 'dev_grant' | 'purchase' | 'iap_grant' | 'refund';
export type KindOf<C extends Currency> = C extends 'gold' ? GoldKind : DiamondKind;
export interface LedgerEntry<C extends Currency = Currency> { txId: string; kind: KindOf<C>; delta: number; balanceAfter: number; at: number; memo?: string }
/** `entries` = the most recent LEDGER_LIVE entries; older ones move to `archive` (never truncated, P0.B).
 *  Idempotency (hasTx) and audit() always cover archive + live entries. */
export interface WalletState<C extends Currency = Currency> { currency: C; balance: number; entries: LedgerEntry<C>[]; archive?: LedgerEntry<C>[] }
export const LEDGER_LIVE = 500;

const DIAMOND_KINDS: readonly DiamondKind[] = ['test_grant', 'dev_grant', 'purchase', 'iap_grant', 'refund'];
const GOLD_KINDS: readonly GoldKind[] = ['test_grant', 'reward', 'purchase', 'furniture', 'trade_escrow', 'trade_release', 'trade_receive', 'refund'];
const CREDIT_KINDS = new Set<string>(['test_grant', 'dev_grant', 'reward', 'trade_release', 'trade_receive', 'refund', 'iap_grant']);

export const emptyWallet = <C extends Currency>(currency: C, balance = 0): WalletState<C> => ({ currency, balance, entries: [] });
export const hasTx = (w: WalletState, txId: string, kind?: string) => { const m = (e: LedgerEntry) => e.txId === txId && (!kind || e.kind === kind); return w.entries.some(m) || !!w.archive?.some(m); };
/** Full history, oldest first (archive + live). */
export const history = <C extends Currency>(w: WalletState<C>): LedgerEntry<C>[] => [...(w.archive ?? []), ...w.entries];

/** Pure: returns a new wallet with the entry applied, or throws. */
export function post<C extends Currency>(w: WalletState<C>, kind: KindOf<C>, amount: number, txId: string, at: number, memo?: string): WalletState<C> {
  assertAmount(amount);
  const allowed: readonly string[] = w.currency === 'gold' ? GOLD_KINDS : DIAMOND_KINDS;
  // Diamonds have no trade/escrow/transfer kinds at all: any attempt is rejected here as well as by the types.
  if (!allowed.includes(kind)) throw new EconomyError('not_transferable', `Opération « ${kind} » interdite pour ${w.currency}`);
  if (!txId) throw new EconomyError('duplicate_tx', 'txId manquant');
  if (hasTx(w, txId, kind)) return w; // idempotent replay
  const delta = CREDIT_KINDS.has(kind) ? amount : -amount;
  const balance = w.balance + delta;
  if (balance < 0) throw new EconomyError('insufficient_funds', `Solde ${w.currency} insuffisant`);
  if (!Number.isSafeInteger(balance)) throw new EconomyError('invalid_amount', 'Dépassement');
  const e = { txId, kind, delta, balanceAfter: balance, at, memo } as LedgerEntry<C>;
  const all = [...w.entries, e];
  if (all.length <= LEDGER_LIVE) return { ...w, balance, entries: all };
  // archive, never truncate: the oldest entries move to `archive` (still used by hasTx/audit)
  const cut = all.length - LEDGER_LIVE;
  return { ...w, balance, entries: all.slice(cut), archive: [...(w.archive ?? []), ...all.slice(0, cut)] };
}
/** Audit: the balance must equal the sum of deltas over the full history (archive + live entries). */
export const audit = (w: WalletState, opening = 0) => history(w).reduce((s, e) => s + e.delta, opening) === w.balance;
