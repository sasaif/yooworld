import type { WalletState } from './ledger';
import { emptyWallet, hasTx, history, post } from './ledger';
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
export const TEST_BALANCES = { [TEST_PLAYER]: { gold: 5000, diamond: 100000 }, [TEST_FRIEND]: { gold: 2000, diamond: 0 } } as const;
/** One-shot, versioned top-up of the TEST player's diamonds for local saves created with the old 100 💎 seed
 *  (asked by Alessandro on 2026-11-21: 100 000 💎 on his test account). LOCAL-DEV economy only (never RemoteEconomy):
 *  a single `test_grant` ledger entry whose txId is the version marker, so it is applied at most once per save and
 *  stays auditable. Only the TEST player's diamond wallet changes; gold, items, other accounts and save keys are untouched. */
export const TEST_TOPUP = { txId: 'topup:test-player:diamond:v1-2026-11-21', account: TEST_PLAYER, diamond: TEST_BALANCES[TEST_PLAYER].diamond } as const;
export function applyTestTopUp(s: EconomyState, at: number): EconomyState {
  const a = s.accounts[TEST_TOPUP.account]; if (!a || a.test !== true || !a.diamond) return s;
  if (hasTx(a.diamond, TEST_TOPUP.txId, 'test_grant')) return s; // already applied (even if diamonds were spent since)
  // saves seeded with the new 100 000 💎 balance never need it (otherwise spending would be refilled on the next load)
  if (history(a.diamond).some((e) => e.txId === `seed:${a.id}:diamond` && e.delta >= TEST_TOPUP.diamond)) return s;
  const delta = TEST_TOPUP.diamond - a.diamond.balance; if (delta <= 0) return s;
  const diamond = post(a.diamond, 'test_grant', delta, TEST_TOPUP.txId, at, 'Solde de TEST porté à 100 000 💎');
  return { ...s, accounts: { ...s.accounts, [a.id]: { ...a, diamond } } };
}

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
