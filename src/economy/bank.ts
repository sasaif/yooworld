import type { WalletState } from './ledger';
import { emptyWallet } from './ledger';
import type { Trade } from './trading';
/** Whole local economy state (one per device in LocalDevEconomy; owned by the server later). */
export interface OwnedItem { itemId: string; acquiredAt: number; txId: string; currency: 'gold' | 'diamond' | 'free'; price: number;
  /** items bought with Diamonds are bound to the purchasing account (never tradable / giftable) */
  bound: boolean }
export interface Account {
  id: string; label: string; /** dev/test account (never a real player) */ test: true;
  gold: WalletState<'gold'>; diamond: WalletState<'diamond'>;
  owned: Record<string, OwnedItem>;
  rewards: RewardState;
}
export interface RewardState { lastDaily: number; day: string; earnedToday: Record<string, number>; carry: Record<string, number> }
export interface EconomyState { version: 1; accounts: Record<string, Account>; trades: Record<string, Trade>; seq: number }

export const TEST_PLAYER = 'test-player';
export const TEST_FRIEND = 'test-friend';
/** TEST balances requested for development (clearly labelled in the UI). */
export const TEST_BALANCES = { [TEST_PLAYER]: { gold: 5000, diamond: 100 }, [TEST_FRIEND]: { gold: 2000, diamond: 0 } } as const;

export function newAccount(id: string, label: string, gold: number, diamond: number, at: number): Account {
  let g = emptyWallet('gold'), d = emptyWallet('diamond');
  if (gold) g = { ...g, balance: gold, entries: [{ txId: `seed:${id}:gold`, kind: 'test_grant', delta: gold, balanceAfter: gold, at, memo: 'Solde de TEST' }] };
  if (diamond) d = { ...d, balance: diamond, entries: [{ txId: `seed:${id}:diamond`, kind: 'test_grant', delta: diamond, balanceAfter: diamond, at, memo: 'Solde de TEST' }] };
  return { id, label, test: true, gold: g, diamond: d, owned: {}, rewards: { lastDaily: 0, day: '', earnedToday: {}, carry: {} } };
}
export function initialState(at = Date.now()): EconomyState {
  return { version: 1, seq: 0, trades: {}, accounts: {
    [TEST_PLAYER]: newAccount(TEST_PLAYER, 'Joueur test (toi)', TEST_BALANCES[TEST_PLAYER].gold, TEST_BALANCES[TEST_PLAYER].diamond, at),
    [TEST_FRIEND]: newAccount(TEST_FRIEND, 'Compte test B', TEST_BALANCES[TEST_FRIEND].gold, TEST_BALANCES[TEST_FRIEND].diamond, at),
  } };
}
