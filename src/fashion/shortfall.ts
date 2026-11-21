import { CURRENCY_ICON, fmt, zeroTotals, type Totals } from '../economy/money';
/** What is missing to pay `cost` with `balance` (per currency, never negative). Pure, unit-tested. */
export function shortfall(cost: Totals, balance: Totals): Totals {
  const m = zeroTotals(); m.gold = Math.max(0, cost.gold - balance.gold); m.diamond = Math.max(0, cost.diamond - balance.diamond); return m;
}
export const hasShortfall = (m: Totals) => m.gold > 0 || m.diamond > 0;
/** « Il te manque 50 💎 » / « Il te manque 120 🪙 et 50 💎 » ('' when nothing is missing) — shown instead of a negative
 *  « Après achat » balance (QA fashion-glam 21/11). */
export function shortfallText(m: Totals): string {
  const parts = [m.gold > 0 && `${fmt(m.gold)} ${CURRENCY_ICON.gold}`, m.diamond > 0 && `${fmt(m.diamond)} ${CURRENCY_ICON.diamond}`].filter(Boolean);
  return parts.length ? `Il te manque ${parts.join(' et ')}` : '';
}
