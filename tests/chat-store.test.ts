import { describe, expect, it } from 'vitest';
import { ChatStore } from '../src/game/social/ChatStore';
import { LocalChatService, sanitize } from '../src/game/social/social';
import { OfflineTransport } from '../src/net/NetworkTransport';
import { CHAT_CONFIG } from '../src/game/social/chatConfig';

describe('ChatStore (wraps LocalChatService)', () => {
  it('send / history / subscribe keep the existing local behaviour', () => {
    const store = new ChatStore(new LocalChatService(new OfflineTransport()));
    const snaps: number[] = [];
    const off = store.subscribe((h) => snaps.push(h.length));
    expect(snaps).toEqual([0]); // current history on subscribe
    const m = store.send('f', '  salut\u0007 ');
    expect(m.text).toBe('salut'); expect(m.local).toBe(true); expect(m.from).toBe('f');
    expect(store.history()).toHaveLength(1);
    expect(store.last()?.text).toBe('salut');
    expect(snaps).toEqual([0, 1]);
    off();
    store.send('f', 'plus tard');
    expect(snaps).toEqual([0, 1]); // unsubscribed
  });

  it('forwards every onMessage and does not change sanitize', () => {
    const store = new ChatStore(new LocalChatService(new OfflineTransport()));
    const got: string[] = [];
    store.onMessage((m) => got.push(m.text));
    store.send('me', 'ok'); expect(got).toEqual(['ok']);
    expect(sanitize('x'.repeat(200)).length).toBe(80);
    expect(store.send('me', '').text).toBe('');
    expect(store.history()).toHaveLength(1); // empty text is not pushed (existing LocalChatService rule)
  });

  it('caps stored history at CHAT_CONFIG.historyMax (was 50; raised so overflowed bubbles stay readable)', () => {
    const store = new ChatStore(new LocalChatService(new OfflineTransport()));
    const max = CHAT_CONFIG.historyMax;
    for (let i = 0; i < max + 10; i++) store.send('f', 'm' + i);
    expect(store.history()).toHaveLength(max);
    expect(store.history()[0].text).toBe('m10');
    expect(store.last()?.text).toBe('m' + (max + 9));
  });
});
