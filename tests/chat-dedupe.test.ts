import { describe, expect, it } from 'vitest';
import { ChatStore } from '../src/game/social/ChatStore';
import { LocalChatService } from '../src/game/social/social';
import { CHAT_CONFIG } from '../src/game/social/chatConfig';
import { OfflineTransport, type NetMessage } from '../src/net/NetworkTransport';
import { SimTransport } from '../src/net/SimTransport';

describe('chat messages are network-ready (ids + ordering) without changing the architecture', () => {
  it('every local message gets a unique id and is sent with it', () => {
    const sent: NetMessage[] = [];
    const net = new OfflineTransport(); net.send = (m) => { sent.push(m); };
    const chat = new ChatStore(new LocalChatService(net));
    const a = chat.send('f', 'a'), b = chat.send('f', 'b');
    expect(a.id).not.toBe(b.id);
    expect(sent.map((m) => (m as { id?: string }).id)).toEqual([a.id, b.id]);
  });

  it('a received duplicate id (reconnect replay) is ignored: no second history row, no second notification', () => {
    const net = new SimTransport(); const chat = new ChatStore(new LocalChatService(net));
    const seen: string[] = []; chat.onMessage((m) => seen.push(m.id));
    const m = { t: 'chat' as const, playerId: 'p2', text: 'salut', at: 5, id: 'srv-1' };
    net.receive(m); net.receive({ ...m }); net.receive({ ...m, text: 'salut' });
    expect(chat.history()).toHaveLength(1); expect(seen).toEqual(['srv-1']);
  });

  it('history is ordered by timestamp (a late message is inserted at its place), equal times keep arrival order', () => {
    const net = new SimTransport(); const chat = new ChatStore(new LocalChatService(net));
    net.receive({ t: 'chat', playerId: 'a', text: 'trois', at: 30, id: '3' });
    net.receive({ t: 'chat', playerId: 'b', text: 'un', at: 10, id: '1' });
    net.receive({ t: 'chat', playerId: 'c', text: 'deux', at: 20, id: '2' });
    net.receive({ t: 'chat', playerId: 'd', text: 'deux bis', at: 20, id: '2b' });
    expect(chat.history().map((m) => m.text)).toEqual(['un', 'deux', 'deux bis', 'trois']);
  });

  it('messages without id (legacy sender) get a stable derived id, so replays still dedupe', () => {
    const net = new SimTransport(); const chat = new ChatStore(new LocalChatService(net));
    net.receive({ t: 'chat', playerId: 'x', text: 'yo', at: 7 }); net.receive({ t: 'chat', playerId: 'x', text: 'yo', at: 7 });
    expect(chat.history()).toHaveLength(1);
  });

  it('history keeps CHAT_CONFIG.historyMax messages (200): a 150-message burst is fully readable', () => {
    const net = new SimTransport(); const chat = new ChatStore(new LocalChatService(net));
    for (let i = 0; i < 150; i++) net.receive({ t: 'chat', playerId: 'p' + (i % 20), text: 'm' + i, at: i, id: 'i' + i });
    expect(chat.history()).toHaveLength(150);
    for (let i = 150; i < 260; i++) net.receive({ t: 'chat', playerId: 'p', text: 'm' + i, at: i, id: 'i' + i });
    expect(chat.history()).toHaveLength(CHAT_CONFIG.historyMax);
    expect(chat.last()?.text).toBe('m259');
  });
});
