import { describe, expect, it, vi } from 'vitest';
import { EnvKV, memoryStorage } from '../src/persistence/prefixedKV';
import { makeSaveEnv } from '../src/persistence/saveEnv';
import { LocalStorageRepository, SaveLoadError } from '../src/persistence/LocalStorageRepository';
import { SaveBackups, MAX_SNAPSHOTS } from '../src/persistence/backup';
import { GameController } from '../src/game/GameController';
import { OfflineTransport } from '../src/net/NetworkTransport';
import { LocalDevEconomy } from '../src/economy/LocalDevEconomy';
import { audit, hasTx, history, post, emptyWallet, LEDGER_LIVE } from '../src/economy/ledger';
import { checkout } from '../src/economy/purchase';
import { initialState, TEST_PLAYER } from '../src/economy/bank';
import { ITEMS } from '../src/fashion/catalogue';
import { restorableSnapshot } from '../src/persistence/backup';

const env = makeSaveEnv('test/combined-1');
function setup(seed: Record<string, string> = {}) {
  const raw = memoryStorage(); const kv = new EnvKV(env, raw, 'data'); for (const [k, v] of Object.entries(seed)) kv.setItem(k, v);
  const backups = new SaveBackups(kv, env.id, 'sha-test', () => 1_700_000_000_000);
  const repo = new LocalStorageRepository(kv, '', backups, { env: env.id, buildId: 'sha-test' });
  return { raw, kv, backups, repo };
}
const envl = (data: unknown, schema = 1) => JSON.stringify({ schema, savedAt: 1, data });
const PROFILE = { version: 1, id: 'p_q', name: 'Juanita', appearance: { body: 'f' }, homeId: 'home_q', friends: [], createdAt: 1 };
const apt = (items: unknown[]) => ({ version: 1, id: 'home_q', ownerId: 'p_q', name: 'x', cols: 8, rows: 6, floor: 'wood', wall: 'cream', doorCells: [], items });
const INV = { version: 1, ownerId: 'p_q', coins: 500, items: { sofa_pink: 1, future_lamp_9000: 2 } };

describe('safe load: unknown furniture is quarantined, never dropped (P0.B)', () => {
  it('unknown placed items survive load + an edit + persist', async () => {
    vi.useFakeTimers();
    const ghost = { uid: 'ghost1', defId: 'future_lamp_9000', x: 1, z: 1, rot: 0 };
    const { kv, repo } = setup({ profile: envl(PROFILE), 'apt:home_q': envl(apt([ghost])), 'inv:p_q': envl(INV) });
    const g = new GameController(repo, new OfflineTransport()); await g.init();
    expect(g.s.ready).toBe(true); expect(g.s.apartment!.items.some((i) => i.uid === 'ghost1')).toBe(false); expect(g.quarantine.map((i) => i.uid)).toEqual(['ghost1']);
    g.setMode('edit');
    (g as unknown as { persist(): void }).persist(); vi.advanceTimersByTime(400);
    const stored = JSON.parse(kv.getItem('apt:home_q')!); expect(stored.data.items.find((i: { uid: string }) => i.uid === 'ghost1')).toEqual(ghost);
    expect(JSON.parse(kv.getItem('inv:p_q')!).data.items.future_lamp_9000).toBe(2); // unknown inventory counts kept
    vi.useRealTimers();
  });
});

describe('safe load: corrupt / future / invalid records are never overwritten (P0.B)', () => {
  it('corrupt JSON: no write, raw copy in backups, problem reported', async () => {
    const { kv, repo, backups } = setup({ profile: envl(PROFILE), 'apt:home_q': '{"schema":1,"data":{"items":[', 'inv:p_q': envl(INV) });
    const before = kv.getItem('apt:home_q'); const g = new GameController(repo, new OfflineTransport()); await g.init();
    expect(g.s.ready).toBe(false); expect(g.s.saveProblems).toEqual([expect.objectContaining({ key: 'apt:home_q', kind: 'corrupt' })]);
    expect(kv.getItem('apt:home_q')).toBe(before); expect(backups.rawCopies('apt:home_q')[0].raw).toBe(before);
    expect(JSON.parse(kv.getItem('profile')!).data).toEqual(PROFILE); // nothing else rewritten
  });
  it('corrupt profile does NOT create a fresh starter save', async () => {
    const { kv, repo } = setup({ profile: 'garbage{', 'apt:home_q': envl(apt([])) });
    const g = new GameController(repo, new OfflineTransport()); await g.init();
    expect(g.s.saveProblems[0].key).toBe('profile'); expect(kv.getItem('profile')).toBe('garbage{'); expect(kv.keys().filter((k) => k.startsWith('apt:'))).toEqual(['apt:home_q']);
  });
  it('future schema: reported, never downgraded', async () => {
    const { kv, repo } = setup({ profile: envl(PROFILE, 7) });
    await expect(repo.loadProfile()).rejects.toBeInstanceOf(SaveLoadError);
    const g = new GameController(repo, new OfflineTransport()); await g.init(); expect(g.s.saveProblems[0].kind).toBe('future_schema'); expect(JSON.parse(kv.getItem('profile')!).schema).toBe(7);
  });
  it('apartment without an items array is reported instead of being emptied', async () => {
    const { repo } = setup({ profile: envl(PROFILE), 'apt:home_q': envl({ id: 'home_q', items: 'oops' }) });
    await expect(repo.loadApartment('home_q')).rejects.toThrow(/invalid/);
  });
  it('temporary session plays in memory and leaves the stored save untouched', async () => {
    const { kv, repo } = setup({ profile: 'garbage{' }); const g = new GameController(repo, new OfflineTransport()); await g.init();
    const snap = JSON.stringify(kv.keys().map((k) => [k, kv.getItem(k)]));
    await g.startTemporary(); expect(g.s.ready).toBe(true); expect(g.s.temporary).toBe(true);
    expect(JSON.stringify(kv.keys().map((k) => [k, kv.getItem(k)]))).toBe(snap);
  });
  it('empty storage: the starter is created exactly once', async () => {
    const { kv, repo } = setup(); const g = new GameController(repo, new OfflineTransport()); await g.init();
    expect(g.s.ready).toBe(true); const keys = kv.keys(); expect(keys.filter((k) => k === 'profile' || k.startsWith('apt:') || k.startsWith('inv:')).length).toBe(3);
    const g2 = new GameController(repo, new OfflineTransport()); await g2.init(); expect(g2.s.profile!.id).toBe(g.s.profile!.id); expect(kv.keys()).toEqual(keys);
  });
  it('v0 (bare) record: snapshot BEFORE the upgraded write; envelope carries env + buildId', async () => {
    const { kv, repo, backups } = setup({ profile: JSON.stringify(PROFILE), 'apt:home_q': envl(apt([])), 'inv:p_q': envl(INV) });
    vi.useFakeTimers(); const g = new GameController(repo, new OfflineTransport()); await g.init();
    expect(backups.snapshots()[0].entries.profile).toBe(JSON.stringify(PROFILE));
    (g as unknown as { persist(): void }).persist(); vi.advanceTimersByTime(400); vi.useRealTimers();
    const p = JSON.parse(kv.getItem('profile')!); expect(p.schema).toBe(1); expect(p.env).toBe('test/combined-1'); expect(p.buildId).toBe('sha-test');
  });
  it('explicit reset snapshots first', async () => {
    const { repo, backups } = setup({ profile: envl(PROFILE), 'apt:home_q': envl(apt([])), 'inv:p_q': envl(INV) });
    const g = new GameController(repo, new OfflineTransport(), undefined, { beforeReset: (r) => backups.snapshot(r) }); await g.init();
    await g.resetSave(); const s = backups.snapshots(); expect(s[s.length - 1].reason).toMatch(/reset/); expect(JSON.parse(s[s.length - 1].entries['inv:p_q']).data).toEqual(INV);
  });
});

describe('backups', () => {
  it('ring of MAX_SNAPSHOTS, deduplicated; raw copies never overwritten; restore', () => {
    const { kv, backups } = setup({ profile: envl(PROFILE) });
    backups.snapshot('a'); backups.snapshot('a-again'); expect(backups.snapshots().length).toBe(1);
    for (let i = 0; i < 5; i++) { kv.setItem('x', String(i)); backups.snapshot('n' + i); }
    expect(backups.snapshots().length).toBe(MAX_SNAPSHOTS);
    backups.keepRaw('profile', 'bad1', 'corrupt'); backups.keepRaw('profile', 'bad2', 'corrupt'); backups.keepRaw('profile', 'bad1', 'corrupt');
    expect(backups.rawCopies('profile').map((c) => c.raw)).toEqual(['bad1', 'bad2']);
    const good = backups.snapshots()[0]; kv.setItem('profile', '{broken'); expect(restorableSnapshot(backups.snapshots(), ['profile'])).not.toBeNull();
    backups.restore(restorableSnapshot(backups.snapshots(), ['profile'])!, ['profile']); expect(kv.getItem('profile')).toBe(good.entries.profile);
    expect(backups.dataKeys().some((k) => k.startsWith('backup:'))).toBe(false);
  });
});

describe('economy safe load (P0.B)', () => {
  const kvOf = (seed: Record<string, string>) => setup(seed);
  it('corrupt economy: no reset write, read-only memory balances, raw kept', async () => {
    const { kv, backups } = kvOf({ 'eco:dev': '{"version":1,"accounts":' });
    const e = new LocalDevEconomy(kv, 'eco:dev', () => 5, backups);
    expect(e.problem?.kind).toBe('corrupt'); expect(e.readOnly).toBe(true); expect(kv.getItem('eco:dev')).toBe('{"version":1,"accounts":');
    e.spendGoldSync(10, 'x', 'k1'); expect(kv.getItem('eco:dev')).toBe('{"version":1,"accounts":'); expect(backups.rawCopies('eco:dev').length).toBe(1);
  });
  it('version mismatch (newer economy): kept byte-identical, flagged future_schema', () => {
    const blob = JSON.stringify({ ...initialState(1), version: 2 }); const { kv } = kvOf({ 'eco:dev': blob });
    const e = new LocalDevEconomy(kv, 'eco:dev'); expect(e.problem?.kind).toBe('future_schema'); expect(kv.getItem('eco:dev')).toBe(blob);
  });
  it('valid economy loads without rewriting; explicit resetDev snapshots first', () => {
    const blob = JSON.stringify(initialState(1)); const { kv, backups } = kvOf({ 'eco:dev': blob });
    const e = new LocalDevEconomy(kv, 'eco:dev', () => 9, backups); expect(e.problem).toBeNull(); expect(kv.getItem('eco:dev')).toBe(blob);
    e.resetDev(); expect(backups.snapshots()[0].entries['eco:dev']).toBe(blob);
  });
  it('owned items unknown to this build stay owned', () => {
    const s = initialState(1); s.accounts[TEST_PLAYER].owned['hair_from_the_future'] = { at: 1, txId: 't', price: { currency: 'gold', amount: 10 } } as never;
    const { kv } = kvOf({ 'eco:dev': JSON.stringify(s) }); const e = new LocalDevEconomy(kv, 'eco:dev'); expect(e.owns('hair_from_the_future')).toBe(true);
    expect(e.owns('another_unknown')).toBe(false);
  });
  it('unknown look ids are quarantined and written back; restored when known again', async () => {
    const look = { v: 1, body: 'f', slots: { hair: 'hair_future', top: 'tee_cheese' } };
    const { kv } = kvOf({ [`look:${TEST_PLAYER}:f`]: JSON.stringify(look) });
    const e = new LocalDevEconomy(kv, 'eco:dev'); const l = e.loadLook('f')!; expect(l.slots.hair).not.toBe('hair_future'); expect(e.quarantinedLook('f')).toEqual({ hair: 'hair_future' });
    await e.saveLook(l); const stored = JSON.parse(kv.getItem(`look:${TEST_PLAYER}:f`)!); expect(stored.q).toEqual({ hair: 'hair_future' });
    // a later build that knows the id restores it
    (ITEMS as Record<string, unknown>).hair_future = { ...ITEMS.hair_buns, id: 'hair_future' };
    try { const e2 = new LocalDevEconomy(kv, 'eco:dev'); expect(e2.loadLook('f')!.slots.hair).toBe('hair_future'); expect(e2.quarantinedLook('f')).toEqual({}); }
    finally { delete (ITEMS as Record<string, unknown>).hair_future; }
  });
  it('an explicit change of a quarantined slot replaces it (player choice, not a silent drop)', async () => {
    const { kv } = kvOf({ [`look:${TEST_PLAYER}:f`]: JSON.stringify({ v: 1, body: 'f', slots: { hair: 'hair_future' } }) });
    const e = new LocalDevEconomy(kv, 'eco:dev'); const l = e.loadLook('f')!; await e.saveLook({ ...l, slots: { ...l.slots, hair: 'hair_quiff' } });
    const stored = JSON.parse(kv.getItem(`look:${TEST_PLAYER}:f`)!); expect(stored.q).toBeUndefined();
  });
  it('corrupt look record is kept (raw backup), not reset', () => {
    const { kv, backups } = kvOf({ [`look:${TEST_PLAYER}:f`]: '{oops' }); const e = new LocalDevEconomy(kv, 'eco:dev', Date.now, backups);
    expect(e.loadLook('f')).toBeNull(); expect(kv.getItem(`look:${TEST_PLAYER}:f`)).toBe('{oops'); expect(backups.rawCopies(`look:${TEST_PLAYER}:f`)[0].raw).toBe('{oops');
  });
});

describe('ledger is archived, not truncated (P0.B)', () => {
  it('600 posts: every txId still deduplicated, audit true over archive + live', () => {
    let w = emptyWallet('gold', 0);
    for (let i = 0; i < 600; i++) w = post(w, 'reward', 1, 'tx' + i, i);
    expect(w.entries.length).toBe(LEDGER_LIVE); expect(w.archive!.length).toBe(100); expect(history(w).length).toBe(600);
    expect(audit(w)).toBe(true); expect(hasTx(w, 'tx0')).toBe(true);
    expect(post(w, 'reward', 1, 'tx0', 999)).toBe(w); // replay of an archived tx is still a no-op
    expect(w.balance).toBe(600);
  });
  it('checkout idempotency also sees archived txIds', () => {
    let s = initialState(1); let g = s.accounts[TEST_PLAYER].gold; for (let i = 0; i < 520; i++) g = post(g, 'reward', 1, 'r' + i, i);
    s = { ...s, accounts: { ...s.accounts, [TEST_PLAYER]: { ...s.accounts[TEST_PLAYER], gold: g } } };
    const r = checkout(s, TEST_PLAYER, ['tee_heart'], ITEMS, 'r0', 2); expect(r.state).toBe(s);
  });
});
