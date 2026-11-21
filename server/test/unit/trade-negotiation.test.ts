// Trade negotiation rules (pure): versioned offers/counter-offers, acceptance of one exact version, settlement
// freeze, failure -> back to negotiation, cancellation, validation.
import { describe, it, expect } from 'vitest';
import * as T from '../../src/core/tradeNegotiation';

const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', X = '00000000-0000-4000-8000-0000000000ff';
const I1 = '10000000-0000-4000-8000-000000000001', I2 = '10000000-0000-4000-8000-000000000002';
const st = (x: T.TradeState | T.TradeErr) => { if (typeof x === 'string') throw new Error(x); return x; };

describe('trade negotiation', () => {
  it('offer -> counter -> accept same version by both -> settling (frozen) -> settled (idempotent)', () => {
    let t = st(T.newTrade('t1', A, B, 0));
    expect(T.accept(t, A, 0, 'e', 1)).toBe('nothing_to_accept');
    t = st(T.offer(t, A, 0, [{ side: 'a', item: I1 }, { side: 'b', gold: 50 }], 1));
    expect(t.version).toBe(1);
    t = st(T.offer(t, B, 1, [{ side: 'a', item: I1 }, { side: 'b', gold: 40 }], 2));              // counter-offer
    expect(t.version).toBe(2); expect(t.proposer).toBe(B);
    expect(T.offer(t, A, 1, [{ side: 'a', item: I1 }], 3)).toBe('stale_version');
    expect(T.accept(t, A, 1, 'e', 3)).toBe('stale_version');
    let r = T.accept(t, A, 2, 'e1', 3); if (typeof r === 'string') throw new Error(r);
    expect(r.settle).toBeNull(); t = r.state;
    r = T.accept(t, B, 2, 'e2', 4); if (typeof r === 'string') throw new Error(r);
    expect(r.settle).toMatchObject({ ecoId: 'e2', settler: B, version: 2 }); t = r.state;
    expect(t.status).toBe('settling');
    expect(T.offer(t, A, 2, [{ side: 'a', item: I2 }], 5)).toBe('bad_state');                    // frozen while settling
    expect(T.accept(t, A, 2, 'e3', 5)).toBe('bad_state');                                        // no second settlement
    expect(T.cancel(t, A, 5)).toBe('bad_state');
    t = st(T.settled(t, 'e2', 42, 6)); expect(t.status).toBe('settled');
    expect(st(T.settled(t, 'e2', 42, 7))).toBe(t);
    expect(T.settled(t, 'other', 1, 7)).toBe('bad_state');
  });
  it('a new offer clears both acceptances; failure returns to open with the reason; outsiders refused', () => {
    let t = st(T.offer(st(T.newTrade('t2', A, B, 0)), A, 0, [{ side: 'a', item: I1 }], 1));
    let r = T.accept(t, A, 1, 'x', 2) as { state: T.TradeState }; t = r.state;
    t = st(T.offer(t, B, 1, [{ side: 'b', item: I2 }], 3));
    expect(t.accepted).toEqual({ a: null, b: null });
    r = T.accept(t, A, 2, 'x', 4) as any; t = r.state; r = T.accept(t, B, 2, 'eco', 5) as any; t = r.state;
    t = st(T.failed(t, 'eco', 'not_owner', 6));
    expect(t).toMatchObject({ status: 'open', lastError: 'not_owner', accepted: { a: null, b: null }, settlement: null });
    expect(T.offer(t, X, 2, [{ side: 'a', item: I1 }], 7)).toBe('not_participant');
    expect(T.accept(t, X, 2, 'z', 7)).toBe('not_participant');
    expect(T.cancel(t, X, 7)).toBe('not_participant');
    t = st(T.cancel(t, B, 8)); expect(t.status).toBe('cancelled');
    expect(T.offer(t, A, 2, [{ side: 'a', item: I1 }], 9)).toBe('bad_state');
    expect(T.newTrade('t3', A, A, 0)).toBe('self');
  });
  it('line validation: at least one item, no duplicates, positive integer gold, max lines, no extra keys', () => {
    expect(T.validLines([{ side: 'a', gold: 5 }])).toBeNull();
    expect(T.validLines([{ side: 'a', item: I1 }, { side: 'b', item: I1 }])).toBeNull();
    expect(T.validLines([{ side: 'a', item: I1 }, { side: 'b', gold: 1.5 }])).toBeNull();
    expect(T.validLines([{ side: 'a', item: I1 }, { side: 'b', gold: -3 }])).toBeNull();
    expect(T.validLines([{ side: 'a', item: I1, diamond: 3 }])).toBeNull();
    expect(T.validLines([{ side: 'c', item: I1 }])).toBeNull();
    expect(T.validLines([{ side: 'a', item: 'not-a-uuid' }])).toBeNull();
    expect(T.validLines(Array.from({ length: 17 }, (_, i) => ({ side: 'a', gold: i + 1 })).concat([{ side: 'a', item: I1 } as any]))).toBeNull();
    expect(T.validLines([{ side: 'a', item: I1 }, { side: 'b', gold: 10 }])).toEqual([{ side: 'a', item: I1 }, { side: 'b', gold: 10 }]);
    expect(T.canonicalOffer({ id: 't', a: A, b: B }, { ecoId: 'e', settler: A, version: 3, lines: [{ side: 'a', item: I1 }], startedAt: 0 })).toBe(JSON.stringify(['t', A, B, 3, [{ side: 'a', item: I1 }]]));
  });
});
