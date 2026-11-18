import { describe, expect, it } from 'vitest';
import { chatScopeNote, netBadge } from '../src/net/netStatus';
import { OfflineTransport } from '../src/net/NetworkTransport';

describe('local / offline prototype vs real multiplayer', () => {
  it('the shipped transport is offline and the HUD says "Mode local", never "en ligne"', () => {
    const b = netBadge(new OfflineTransport().status);
    expect(b.tone).toBe('local'); expect(b.label).toBe('Mode local');
    expect((b.label + b.detail).toLowerCase()).not.toMatch(/en ligne ·|joueurs? connect/);
    expect(b.detail).toMatch(/aucun autre joueur/);
  });
  it('even a stray player count cannot make the offline badge show players', () => {
    expect(netBadge('offline', 12).label).toBe('Mode local');
    expect(netBadge('connecting', 3).label).toBe('Connexion…');
  });
  it('only a real online status shows a player count', () => {
    expect(netBadge('online', 1).label).toBe('En ligne · 1 joueur'); expect(netBadge('online', 4).label).toBe('En ligne · 4 joueurs');
  });
  it('the chat explains who can read messages', () => {
    expect(chatScopeNote('offline')).toMatch(/seuls tes avatars/); expect(chatScopeNote('online')).toMatch(/joueurs présents/);
  });
});
