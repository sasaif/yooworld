/**
 * Product rules — the server-side source of truth is eco.config (Postgres). This file documents the
 * rules and their approval status so code and reports never drift. 'pending_approval' = default chosen
 * by engineering, NOT decided by Alessandro; it must be confirmed before production.
 */
export type RuleStatus = 'owner_rule' | 'pending_approval' | 'approved' | 'technical';
export interface ProductRule { key: string; status: RuleStatus; summary: string }

export const PRODUCT_RULES: readonly ProductRule[] = [
  { key: 'diamonds.never_transferable', status: 'owner_rule', summary: 'Diamonds never move between two players (enforced by a deferred DB trigger).' },
  { key: 'items.diamond_tradable_by_default', status: 'owner_rule', summary: 'Diamond-bought items are TRADABLE unless item_definitions.tradable = false. Never bound silently.' },
  { key: 'item.diamond_hold_days', status: 'owner_rule', summary: 'Owner rule 2026-11-20: NO hold (0). Diamond-bought items are tradable immediately; the hold mechanism is kept (value > 0 re-enables it).' },
  { key: 'room.public_soft_cap / hard_cap', status: 'pending_approval', summary: 'Public shard 25 soft / 30 hard (configurable 20–30, pending iPhone measurements).' },
  { key: 'room.apartment_visitors', status: 'pending_approval', summary: 'Apartment visitors 10 (+ owner); no realtime room for a player alone.' },
  { key: 'reward_rules.farm_task', status: 'pending_approval', summary: 'Farm task 15 Gold / 45 s min / 30 per day.' },
  { key: 'admin.adjust_max_gold', status: 'pending_approval', summary: 'Max 100000 per admin_adjust (two admins).' },
  { key: 'prestige.not_buyable', status: 'owner_rule', summary: 'Prestige grants from monetary event types are refused by the DB.' },
  { key: 'vip.no_prestige_no_economic_edge', status: 'owner_rule', summary: 'No economy function reads VIP; VIP events are monetary (no Prestige).' },
  { key: 'test_gold.isolated', status: 'owner_rule', summary: 'Outside prod every currency is *_TEST; prod refuses *_TEST wallets and test grants.' },
  { key: 'gift.*', status: 'pending_approval', summary: 'Gift limits (age 7 d, 1000/gift, 2000 sent/day, 5000 received/day, 10 gifts/day).' },
  { key: 'trade.min_account_age_days', status: 'pending_approval', summary: 'Account age before trading (default 7 days).' },
  { key: 'reward_rules.daily / factory_task', status: 'pending_approval', summary: 'Daily 150 Gold, factory task 20 Gold / 30 s min / 40 per day.' },
  { key: 'event.vip_*', status: 'pending_approval', summary: 'VIP event safeguard: 24/day, 5 active.' },
] as const;
