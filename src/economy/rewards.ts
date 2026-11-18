import { EconomyError } from './money';
import { post } from './ledger';
import type { EconomyState } from './bank';
/** Gold earning rules (pure). Documented in docs/08-avatar-fashion-economy.md.
 *  Real rewards must be validated by the server later (activity proofs, server clock). */
export const REWARDS = {
  daily: { gold: 150, cooldownMs: 20 * 3600_000 },
  /** activities pay per full period, with a daily cap per activity */
  dance: { gold: 5, periodS: 30, capPerDay: 120 },
  sit: { gold: 2, periodS: 30, capPerDay: 40 },
  visit_beach: { gold: 25, periodS: 0, capPerDay: 25 },
} as const;
export type Activity = 'dance' | 'sit' | 'visit_beach';
const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);

export function claimDaily(s: EconomyState, accountId: string, at: number): EconomyState {
  const a = s.accounts[accountId]; if (!a) throw new EconomyError('unknown_account');
  if (at - a.rewards.lastDaily < REWARDS.daily.cooldownMs) throw new EconomyError('reward_cooldown', 'Récompense déjà réclamée');
  const gold = post(a.gold, 'reward', REWARDS.daily.gold, `daily:${accountId}:${dayKey(at)}`, at, 'Récompense du jour');
  return { ...s, accounts: { ...s.accounts, [accountId]: { ...a, gold, rewards: { ...a.rewards, lastDaily: at } } } };
}
export const dailyReadyIn = (s: EconomyState, accountId: string, at: number) => Math.max(0, s.accounts[accountId].rewards.lastDaily + REWARDS.daily.cooldownMs - at);

/** Accumulate activity seconds; pays whole periods, respects the daily cap. Returns state + gold paid. */
export function addActivity(s: EconomyState, accountId: string, act: Activity, seconds: number, at: number): { state: EconomyState; paid: number } {
  const a = s.accounts[accountId]; if (!a) throw new EconomyError('unknown_account');
  const rule = REWARDS[act]; const day = dayKey(at);
  let r = a.rewards.day === day ? a.rewards : { ...a.rewards, day, earnedToday: {}, carry: {} };
  const earned = r.earnedToday[act] ?? 0; if (earned >= rule.capPerDay) return { state: s, paid: 0 };
  let periods = 1, carry = 0;
  if (rule.periodS > 0) { const total = (r.carry[act] ?? 0) + Math.max(0, seconds); periods = Math.floor(total / rule.periodS); carry = total - periods * rule.periodS; }
  else if (earned > 0) return { state: s, paid: 0 };
  const pay = Math.min(periods * rule.gold, rule.capPerDay - earned);
  r = { ...r, carry: { ...r.carry, [act]: carry }, earnedToday: { ...r.earnedToday, [act]: earned + pay } };
  let gold = a.gold;
  if (pay > 0) gold = post(gold, 'reward', pay, `act:${accountId}:${act}:${day}:${earned + pay}`, at, act === 'dance' ? 'Danse' : act === 'sit' ? 'Détente' : 'Visite de Yoo Plage');
  return { state: { ...s, accounts: { ...s.accounts, [accountId]: { ...a, gold, rewards: r } } }, paid: pay };
}
