/** Shared economy types (client <-> API). Phase B: the client does NOT use these yet (no client economy change). */
export type Currency = 'GOLD' | 'DIAMOND';

export type GateErrorCode =
  | 'insufficient' | 'already_claimed' | 'too_fast' | 'daily_cap' | 'sold_out' | 'not_for_sale'
  | 'not_owner' | 'not_tradable' | 'item_state' | 'on_hold' | 'unknown_item' | 'unknown_player' | 'unknown_trade'
  | 'self' | 'frozen' | 'account_age' | 'blocked' | 'amount' | 'cap_count' | 'cap_sent' | 'cap_received'
  | 'no_item' | 'bad_lines' | 'trade_exists' | 'bad_state' | 'expired' | 'not_participant' | 'invariant'
  | 'bad_session' | 'session_ended' | 'inactive' | 'bad_currency' | 'bad_key' | 'key_reuse' | 'forbidden_env'
  | 'config_missing' | 'diamond_transfer' | 'unbalanced' | 'busy' | 'unavailable' | 'internal';

export type GateResult<T = Record<string, unknown>> =
  | ({ ok: true; replayed?: boolean } & T)
  | { ok: false; code: GateErrorCode | string; retryable: boolean; message?: string };

export interface TradeLine { side: 'a' | 'b'; item?: string; gold?: number }
export interface TradeSnapshot { a: string; b: string; version: number; hash: string; lines: TradeLine[] }
