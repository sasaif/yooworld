import { EconomyError, assertAmount } from './money';
import { post } from './ledger';
import type { EconomyState } from './bank';
/** Player-to-player GOLD trading (pure state machine). Only Gold can ever be offered:
 *  `TradeOffer` has a single `gold` field and `sanitizeOffer` rejects anything else (e.g. diamonds).
 *
 *   open ──(both accept: offers locked + gold moved to escrow)──▶ locked ──(both confirm)──▶ completed
 *    │  any offer change resets both acceptances                     │
 *    └──── reject / cancel ──▶ rejected | cancelled  ◀──── reject/cancel (escrow released) ┘
 *
 * Anti double-spend: when a trade locks, the offered gold is DEBITED from each wallet into escrow
 * (ledger kind trade_escrow) so it cannot be spent in the shop or offered in another trade.
 * Completion credits the counterparty (trade_receive); cancellation refunds (trade_release).
 * Every ledger post uses `trade:<id>:<step>:<account>` ids, so replaying a step is a no-op. */
export type TradeStatus = 'open' | 'locked' | 'completed' | 'rejected' | 'cancelled';
export interface TradeOffer { gold: number }
export interface TradeSide { account: string; offer: TradeOffer; accepted: boolean; confirmed: boolean }
export interface Trade { id: string; status: TradeStatus; a: TradeSide; b: TradeSide; createdAt: number; updatedAt: number; log: { at: number; who: string; what: string }[] }

export function sanitizeOffer(raw: unknown): TradeOffer {
  const o = (raw ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'gold') throw new EconomyError('not_transferable', k === 'diamond' || k === 'diamonds' ? 'Les diamants ne sont pas échangeables' : `Actif non échangeable : ${k}`);
  const gold = o.gold ?? 0; if (gold !== 0) assertAmount(gold);
  return { gold: gold as number };
}
const side = (t: Trade, who: string) => { if (t.a.account === who) return 'a' as const; if (t.b.account === who) return 'b' as const; throw new EconomyError('trade_not_participant'); };
const touch = (t: Trade, at: number, who: string, what: string): Trade => ({ ...t, updatedAt: at, log: [...t.log, { at, who, what }] });
const put = (s: EconomyState, t: Trade): EconomyState => ({ ...s, trades: { ...s.trades, [t.id]: t } });

export function openTrade(s: EconomyState, from: string, to: string, id: string, at: number): EconomyState {
  if (from === to) throw new EconomyError('trade_self', 'Impossible d’échanger avec soi-même');
  if (!s.accounts[from] || !s.accounts[to]) throw new EconomyError('unknown_account');
  if (s.trades[id]) return s; // idempotent
  const blank = (account: string): TradeSide => ({ account, offer: { gold: 0 }, accepted: false, confirmed: false });
  return put(s, { id, status: 'open', a: blank(from), b: blank(to), createdAt: at, updatedAt: at, log: [{ at, who: from, what: 'demande d’échange' }] });
}
export function setOffer(s: EconomyState, id: string, who: string, raw: unknown, at: number): EconomyState {
  const t = s.trades[id]; if (!t) throw new EconomyError('trade_state'); if (t.status !== 'open') throw new EconomyError('trade_state', 'Offre verrouillée');
  const k = side(t, who); const offer = sanitizeOffer(raw);
  if (offer.gold > s.accounts[who].gold.balance) throw new EconomyError('insufficient_funds', 'Pas assez d’or pour cette offre');
  // any change resets both acceptances (no bait-and-switch)
  const nt: Trade = { ...t, a: { ...t.a, accepted: false }, b: { ...t.b, accepted: false }, [k]: { ...t[k], offer, accepted: false } };
  return put(s, touch(nt, at, who, `offre ${offer.gold} or`));
}
export function acceptTrade(s: EconomyState, id: string, who: string, at: number): EconomyState {
  const t = s.trades[id]; if (!t) throw new EconomyError('trade_state'); if (t.status !== 'open') throw new EconomyError('trade_state');
  const k = side(t, who); let nt: Trade = touch({ ...t, [k]: { ...t[k], accepted: true } }, at, who, 'accepte l’offre');
  if (nt.a.accepted && nt.b.accepted) {
    if (!nt.a.offer.gold && !nt.b.offer.gold) throw new EconomyError('invalid_amount', 'Échange vide');
    let st = s;
    // lock: move each offer to escrow; throws (and nothing changes) if a balance became insufficient meanwhile
    for (const x of [nt.a, nt.b]) if (x.offer.gold) {
      const acc = st.accounts[x.account];
      st = { ...st, accounts: { ...st.accounts, [x.account]: { ...acc, gold: post(acc.gold, 'trade_escrow', x.offer.gold, `trade:${id}:escrow:${x.account}`, at, `Échange ${id} (séquestre)`) } } };
    }
    nt = touch({ ...nt, status: 'locked' }, at, 'système', 'offres verrouillées, or placé sous séquestre');
    return put(st, nt);
  }
  return put(s, nt);
}
export function confirmTrade(s: EconomyState, id: string, who: string, at: number): EconomyState {
  const t = s.trades[id]; if (!t) throw new EconomyError('trade_state');
  if (t.status === 'completed') return s; // idempotent
  if (t.status !== 'locked') throw new EconomyError('trade_state', 'Les deux joueurs doivent d’abord accepter');
  const k = side(t, who); let nt: Trade = touch({ ...t, [k]: { ...t[k], confirmed: true } }, at, who, 'confirme');
  if (!(nt.a.confirmed && nt.b.confirmed)) return put(s, nt);
  let st = s;
  for (const [from, to] of [[nt.a, nt.b], [nt.b, nt.a]] as const) if (from.offer.gold) {
    const acc = st.accounts[to.account];
    st = { ...st, accounts: { ...st.accounts, [to.account]: { ...acc, gold: post(acc.gold, 'trade_receive', from.offer.gold, `trade:${id}:receive:${to.account}`, at, `Échange ${id} (reçu de ${from.account})`) } } };
  }
  nt = touch({ ...nt, status: 'completed' }, at, 'système', 'échange exécuté');
  return put(st, nt);
}
export function rejectTrade(s: EconomyState, id: string, who: string, at: number, cancel = false): EconomyState {
  const t = s.trades[id]; if (!t) throw new EconomyError('trade_state');
  if (t.status === 'rejected' || t.status === 'cancelled') return s;
  if (t.status === 'completed') throw new EconomyError('trade_state', 'Échange déjà exécuté');
  side(t, who); let st = s;
  if (t.status === 'locked') for (const x of [t.a, t.b]) if (x.offer.gold) {
    const acc = st.accounts[x.account];
    st = { ...st, accounts: { ...st.accounts, [x.account]: { ...acc, gold: post(acc.gold, 'trade_release', x.offer.gold, `trade:${id}:release:${x.account}`, at, `Échange ${id} annulé (remboursé)`) } } };
  }
  return put(st, touch({ ...t, status: cancel ? 'cancelled' : 'rejected' }, at, who, cancel ? 'annule' : 'refuse'));
}
