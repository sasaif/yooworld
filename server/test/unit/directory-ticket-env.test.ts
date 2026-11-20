import { describe, it, expect } from 'vitest';
import { DirectoryCore } from '../../src/core/directory';
import { signTicket, verifyTicket } from '../../src/core/ticket';
import { validateEnv } from '../../src/core/envSchema';
import { newTable, joinTable, moveTable, tableResult, legalFor, viewTable } from '../../src/core/tableGame';

describe('DirectoryCore (fill before opening)', () => {
  it('fills shard 1 to the soft cap, then opens shard 2; friends may join up to hard; reconnection returns to the same shard', () => {
    let t = 0; const d = new DirectoryCore(() => t);
    const caps = { soft: 25, hard: 30 };
    const placed = Array.from({ length: 60 }, (_, i) => d.place(`p${i}`, caps).shard);
    expect(placed.filter((s) => s === 1).length).toBe(25);
    expect(placed.filter((s) => s === 2).length).toBe(25);
    expect(placed.filter((s) => s === 3).length).toBe(10);
    d.report(1, Array.from({ length: 25 }, (_, i) => `p${i}`));
    expect(d.place('friendOfP0', caps, ['p0'])).toMatchObject({ shard: 1, reason: 'friend' });
    expect(d.place('p3', caps)).toMatchObject({ shard: 1, reason: 'present' });
    t += 31_000;    // reservations expire
    const snap = d.snapshot();
    expect(snap.find((s) => s.shard === 2)!.pending).toBe(0);
    const d2 = new DirectoryCore(() => t); d2.load(d.dump());
    expect(d2.place('p3', caps).shard).toBe(1);
  });
  it('a player is in one shard only', () => {
    const d = new DirectoryCore(() => 0);
    d.report(1, ['a', 'b']); d.report(2, ['a']);
    expect(d.place('a', { soft: 25, hard: 30 }).shard).toBe(2);
  });
});

describe('tickets (HMAC, 30 s, room + env bound)', () => {
  const S = 'x'.repeat(40);
  it('verifies, and rejects forged, expired, other room, other env, future', async () => {
    const tok = await signTicket(S, { sub: 'u', room: 'local:beach:1', env: 'local', kind: 'public', cap: 30 });
    expect(await verifyTicket(S, tok, 'local:beach:1', 'local')).toMatchObject({ sub: 'u', cap: 30 });
    const [p, s] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: 'admin' })).toString('base64url');
    expect(await verifyTicket(S, `${forged}.${s}`, 'local:beach:1', 'local')).toEqual({ error: 'bad_signature' });
    expect(await verifyTicket('y'.repeat(40), tok, 'local:beach:1', 'local')).toEqual({ error: 'bad_signature' });
    expect(await verifyTicket(S, tok, 'local:beach:2', 'local')).toEqual({ error: 'wrong_room' });
    expect(await verifyTicket(S, tok, 'local:beach:1', 'uat')).toEqual({ error: 'wrong_env' });
    expect(await verifyTicket(S, tok, 'local:beach:1', 'local', Date.now() + 31_000)).toEqual({ error: 'expired' });
    expect(await verifyTicket(S, 'garbage', 'local:beach:1', 'local')).toEqual({ error: 'malformed' });
    const fut = await signTicket(S, { sub: 'u', room: 'r', env: 'local', kind: 'public' }, 30_000, Date.now() + 60_000);
    expect(await verifyTicket(S, fut, 'r', 'local')).toEqual({ error: 'not_yet_valid' });
    await expect(signTicket('short', { sub: 'u', room: 'r', env: 'local', kind: 'p' })).rejects.toThrow();
  });
});

describe('env schema (refuses mixed environments)', () => {
  const base = {
    ENV_TAG: 'local',
    DATABASE_URL: 'postgres://app_api:x@127.0.0.1:54339/yoland_local',
    AUTH_DATABASE_URL: 'postgres://app_auth:x@127.0.0.1:54339/yoland_local',
    BETTER_AUTH_SECRET: 'a'.repeat(40), TICKET_SECRET: 'b'.repeat(40), RESULT_SECRET: 'c'.repeat(40),
    BETTER_AUTH_URL: 'http://127.0.0.1:8787', APP_ORIGIN: 'http://127.0.0.1:5173',
  };
  it('accepts a coherent local env', () => { expect(validateEnv(base).ok).toBe(true); });
  it('refuses: local with remote DB, uat with loopback / no TLS / placeholder secrets, wrong role, reused secrets, prod-looking DB in uat', () => {
    const errs = (e: Record<string, unknown>) => { const r = validateEnv(e); return r.ok ? [] : r.errors; };
    expect(errs({ ...base, DATABASE_URL: 'postgres://app_api:x@db.example.com/yoland' }).join()).toMatch(/loopback/);
    const uat = { ...base, ENV_TAG: 'uat', BETTER_AUTH_URL: 'https://uat.example', APP_ORIGIN: 'https://uat.example', TURNSTILE_MODE: 'turnstile', TURNSTILE_SECRET: '0x4AAAAAAA' + 'Q'.repeat(20) };
    expect(errs(uat).join()).toMatch(/cannot use a loopback/);
    expect(errs({ ...uat, DATABASE_URL: 'postgres://app_api:x@uat-db.example/yoland', AUTH_DATABASE_URL: 'postgres://app_auth:x@uat-db.example/yoland' }).join()).toMatch(/sslmode=require/);
    expect(errs({ ...uat, DATABASE_URL: 'postgres://app_api:x@prod-db.example/yoland?sslmode=require', AUTH_DATABASE_URL: 'postgres://app_auth:x@uat-db.example/y?sslmode=require' }).join()).toMatch(/production database/);
    expect(errs({ ...uat, BETTER_AUTH_SECRET: 'local-only-' + 'z'.repeat(30) }).join()).toMatch(/placeholder/);
    expect(errs({ ...base, DATABASE_URL: 'postgres://postgres:x@127.0.0.1/yoland' }).join()).toMatch(/app_api/);
    expect(errs({ ...base, TICKET_SECRET: base.BETTER_AUTH_SECRET }).join()).toMatch(/must differ/);
    expect(errs({ ...base, ENV_TAG: 'staging' }).join()).toMatch(/ENV_TAG/);
    expect(errs({ ...uat, ENV_TAG: 'prod', BETTER_AUTH_URL: 'http://x' }).join()).toMatch(/https/);
  });
});

describe('server-authoritative Dominoes table (client rules reused)', () => {
  it('plays a full game server-side; result only from the engine; illegal / out-of-turn moves refused', () => {
    let t = newTable('t1', 'A');
    expect(tableResult(t)).toBe('not_started');
    t = joinTable(t, 'B', 12345) as typeof t;
    expect(joinTable(t, 'C', 1)).toBe('full');
    expect(viewTable(t, 'C')).toBe('not_seated');
    const turnOf = () => (t.engine!.state.turn === 0 ? 'A' : 'B');
    const other = () => (turnOf() === 'A' ? 'B' : 'A');
    expect(moveTable(t, other(), legalFor(t, turnOf())[0] ?? { type: 'pass' })).toBe('not_your_turn');
    expect(moveTable(t, turnOf(), { type: 'play', tile: [9, 9], end: 'L' } as any)).toBe('illegal_move');
    expect(tableResult(t)).toBe('not_over');
    let guard = 0;
    while (typeof tableResult(t) === 'string' && guard++ < 500) {
      const p = turnOf(); const m = legalFor(t, p)[0];
      const r = moveTable(t, p, m); if (typeof r === 'string') throw new Error(r); t = r;
    }
    const res = tableResult(t) as Exclude<ReturnType<typeof tableResult>, string>;
    expect(res.players).toEqual(['A', 'B']);
    expect(res.moves).toBeGreaterThan(0);
    expect(res.winners.every((w) => ['A', 'B'].includes(w))).toBe(true);
    expect(moveTable(t, 'A', { type: 'pass' })).toBe('game_over');
  });
});
