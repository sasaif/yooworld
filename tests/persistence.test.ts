import { describe, expect, it } from 'vitest';
import { LocalStorageRepository, MemoryRepository } from '../src/persistence/LocalStorageRepository';
import { defaultApartment } from '../src/data/defaultApartment';
import { buy, emptyInventory, takeItem } from '../src/game/inventory/Inventory';
import { LocalChatService, sanitize } from '../src/game/social/social';
import { OfflineTransport } from '../src/net/NetworkTransport';

describe('repository', () => {
  it('round-trips apartment, inventory and profile', async () => {
    const r = new MemoryRepository(); const a = defaultApartment('p1');
    await r.saveApartment(a); expect(await r.loadApartment(a.id)).toEqual(a);
    const inv = emptyInventory('p1'); await r.saveInventory(inv); expect(await r.loadInventory('p1')).toEqual(inv);
    expect(await r.loadProfile()).toBeNull();
  });
  it('survives corrupted data and migrates bare (v0) records', async () => {
    const m = new Map<string, string>(); const r = new MemoryRepository(m);
    m.set('yooworld:profile', '{not json'); expect(await r.loadProfile()).toBeNull();
    m.set('yooworld:inv:x', JSON.stringify({ ownerId: 'x', coins: 3, items: {} }));
    expect((await r.loadInventory('x'))!.version).toBe(1);
  });
  it('works on any KV (server adapter shape)', async () => {
    const kv = new Map<string, string>(); const r = new LocalStorageRepository({ getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => void kv.set(k, v), removeItem: (k) => void kv.delete(k) }, 'test:');
    await r.saveInventory(emptyInventory('z')); expect([...kv.keys()]).toEqual(['test:inv:z']);
  });
});

describe('inventory & economy', () => {
  it('buy checks funds', () => {
    const inv = emptyInventory('p', 100);
    expect(buy(inv, { id: 'x', price: 150 })).toEqual({ ok: false, reason: 'funds' });
    const r = buy(inv, { id: 'x', price: 60 }); expect(r.ok && r.inv.coins).toBe(40); expect(r.ok && r.inv.items.x).toBe(1);
  });
  it('take fails when not owned', () => { expect(takeItem(emptyInventory('p'), 'x')).toBeNull(); });
});

describe('social (local, no fake players)', () => {
  it('chat sanitises and keeps history; offline transport receives nothing', () => {
    const c = new LocalChatService(new OfflineTransport()); const got: string[] = []; c.onMessage((m) => got.push(m.text));
    c.send('me', '  salut\u0007 '); expect(got).toEqual(['salut']); expect(c.history()[0].local).toBe(true);
    expect(sanitize('x'.repeat(200)).length).toBe(80);
  });
});
