import { describe, expect, it, vi } from 'vitest';
import { GameController } from '../src/game/GameController';
import { MemoryRepository } from '../src/persistence/LocalStorageRepository';
import { OfflineTransport, type NetMessage } from '../src/net/NetworkTransport';
import { world } from '../src/game/world';

async function boot() {
  const repo = new MemoryRepository(); const net = new OfflineTransport(); const sent: NetMessage[] = [];
  net.send = (m: NetMessage) => { sent.push(m); };
  const g = new GameController(repo, net); await g.init(); return { g, repo, sent };
}

describe('GameController (edit-mode flows)', () => {
  it('boots a default apartment, inventory and nav world', async () => {
    const { g } = await boot();
    expect(g.s.ready).toBe(true); expect(g.s.apartment!.items.length).toBeGreaterThan(20);
    expect(g.s.inventory!.coins).toBe(500); expect(world.nav).toBeTruthy();
  });
  it('places from the bag, rotates, stores back, and emits furniture events', async () => {
    const { g, sent } = await boot(); const n = g.s.apartment!.items.length;
    g.setMode('edit'); g.startPlace('chair'); expect(g.s.placing?.valid.ok).toBe(true); g.confirmPlace();
    expect(g.s.apartment!.items.length).toBe(n + 1); expect(g.s.inventory!.items.chair ?? 0).toBe(0);
    const uid = g.s.selItem!; g.rotateSelected();
    expect(g.s.apartment!.items.find((i) => i.uid === uid)!.rot).toBe(1);
    g.storeSelected(); expect(g.s.apartment!.items.length).toBe(n); expect(g.s.inventory!.items.chair).toBe(1);
    expect(sent.filter((m) => m.t === 'furniture').map((m) => (m as { op: string }).op)).toEqual(['place', 'move', 'remove']);
  });
  it('buys from the shop only with enough coins and persists', async () => {
    vi.useFakeTimers();
    const { g, repo } = await boot();
    const sofa = g.cat['loungeDesignSofa'];
    g.buyItem(sofa); expect(g.s.inventory!.coins).toBe(240); expect(g.s.inventory!.items.loungeDesignSofa).toBe(1);
    g.cancelPlace(); g.buyItem(sofa); // 240 < 260: refused
    expect(g.s.inventory!.coins).toBe(240); expect(g.s.inventory!.items.loungeDesignSofa).toBe(1);
    vi.advanceTimersByTime(400); vi.useRealTimers();
    const inv = await repo.loadInventory(g.s.profile!.id); expect(inv!.coins).toBe(g.s.inventory!.coins);
  });
  it('finishes are bought once then free to re-apply', async () => {
    const { g } = await boot();
    g.setFinish('floor', 'walnut'); const c = g.s.inventory!.coins; expect(c).toBe(440); expect(g.s.apartment!.floor).toBe('walnut');
    g.setFinish('floor', 'oak'); g.setFinish('floor', 'walnut'); expect(g.s.inventory!.coins).toBe(c);
  });
});
