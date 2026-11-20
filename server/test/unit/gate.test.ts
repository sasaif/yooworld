import { describe, it, expect } from 'vitest';
import { createEconomyGate, toGateError } from '../../src/core/economy';
import { PRODUCT_RULES } from '../../src/core/productRules';

describe('toGateError', () => {
  it('maps business errors (P0001 + HINT) to non-retryable codes', () => {
    expect(toGateError({ code: 'P0001', hint: 'insufficient', message: 'x' })).toMatchObject({ ok: false, code: 'insufficient', retryable: false });
  });
  it('maps serialization / deadlock / connection errors to retryable', () => {
    for (const code of ['40001', '40P01', '57P01', '08006']) expect(toGateError({ code })).toMatchObject({ code: 'busy', retryable: true });
    expect(toGateError({ code: 'ECONNREFUSED' })).toMatchObject({ code: 'unavailable', retryable: true });
  });
  it('maps permission denied and unknown errors', () => {
    expect(toGateError({ code: '42501' })).toMatchObject({ code: 'forbidden', retryable: false });
    expect(toGateError(new Error('boom'))).toMatchObject({ code: 'internal', retryable: false });
  });
});

describe('createEconomyGate', () => {
  it('issues exactly one SQL call per operation, to an eco.* function, with bound parameters', async () => {
    const calls: { text: string; params?: unknown[] }[] = [];
    const gate = createEconomyGate({ query: async (text, params) => { calls.push({ text, params }); return { rows: [{ r: { ok: true } }] }; } });
    await gate.shopBuy('p1', 'sofa', 'DIAMOND', 'key-12345678');
    await gate.tradeLock('t1', 'p1', { a: 'p1', b: 'p2', version: 3, hash: 'h', lines: [{ side: 'a', item: 'i1' }] }, 'key-abcdefgh');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ text: 'select eco.shop_buy($1, $2, $3, $4) as r', params: ['key-12345678', 'p1', 'sofa', 'DIAMOND'] });
    expect(calls[1].text).toBe('select eco.trade_lock($1, $2, $3, $4, $5, $6, $7, $8) as r');
    expect(calls[1].params?.[7]).toBe('[{"side":"a","item":"i1"}]');
  });
  it('returns GateResult errors instead of throwing', async () => {
    const gate = createEconomyGate({ query: async () => { throw Object.assign(new Error('no'), { code: 'P0001', hint: 'sold_out' }); } });
    expect(await gate.shopBuy('p', 'x', 'GOLD', 'key-12345678')).toEqual({ ok: false, code: 'sold_out', retryable: false, message: 'no' });
  });
});

describe('product rules registry', () => {
  it('flags every undecided rule as pending_approval and keeps the owner rules', () => {
    const byKey = Object.fromEntries(PRODUCT_RULES.map((r) => [r.key, r.status]));
    expect(byKey['items.diamond_tradable_by_default']).toBe('owner_rule');
    expect(byKey['diamonds.never_transferable']).toBe('owner_rule');
    expect(byKey['item.diamond_hold_days']).toBe('owner_rule');
    expect(byKey['gift.*']).toBe('pending_approval');
  });
});
