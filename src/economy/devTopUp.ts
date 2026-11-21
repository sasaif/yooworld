import { hasTx, history, post } from './ledger';
import { TEST_PLAYER, type EconomyState } from './bank';
/** DEV-ONLY module. Imported only by LocalDevEconomy, and only called behind `if (import.meta.env.DEV)`: in `vite build`
 *  that guard is the constant `false`, so the call is dead code and Rollup drops this whole module from the production
 *  bundle (proved by tools/check-prod-no-dev-topup.mjs, which greps the prod bundle for the markers below).
 *  It never goes through RemoteEconomy / an economy gate / a server ledger: it only edits the TEST player's LOCAL save. */
/** One-shot, versioned top-up of the TEST player's diamonds for local saves created with the old 100 💎 seed
 *  (asked by Alessandro on 2026-11-21: 100 000 💎 on his test account). LOCAL-DEV economy only (never RemoteEconomy):
 *  a single `test_grant` ledger entry whose txId is the version marker, so it is applied at most once per save and
 *  stays auditable. Only the TEST player's diamond wallet changes; gold, items, other accounts and save keys are untouched. */
export const TEST_TOPUP = { txId: 'topup:test-player:diamond:v1-2026-11-21', account: TEST_PLAYER, diamond: 100000 } as const;
export function applyTestTopUp(s: EconomyState, at: number): EconomyState {
  const a = s.accounts[TEST_TOPUP.account]; if (!a || a.test !== true || !a.diamond) return s;
  if (hasTx(a.diamond, TEST_TOPUP.txId, 'test_grant')) return s; // already applied (even if diamonds were spent since)
  // saves seeded with the new 100 000 💎 balance never need it (otherwise spending would be refilled on the next load)
  if (history(a.diamond).some((e) => e.txId === `seed:${a.id}:diamond` && e.delta >= TEST_TOPUP.diamond)) return s;
  const delta = TEST_TOPUP.diamond - a.diamond.balance; if (delta <= 0) return s;
  const diamond = post(a.diamond, 'test_grant', delta, TEST_TOPUP.txId, at, 'Solde de TEST porté à 100 000 💎');
  return { ...s, accounts: { ...s.accounts, [a.id]: { ...a, diamond } } };
}

