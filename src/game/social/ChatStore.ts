import type { ChatMessage, ChatService } from './social';

/** Thin store over a ChatService (today: LocalChatService). UI subscribes to history;
 *  a real transport can replace the inner service later without changing callers. */
export class ChatStore implements ChatService {
  constructor(private readonly inner: ChatService) {}
  send(from: string, text: string) { return this.inner.send(from, text); }
  history() { return this.inner.history(); }
  onMessage(cb: (m: ChatMessage) => void) { return this.inner.onMessage(cb); }
  subscribe(listener: (history: ChatMessage[]) => void): () => void {
    listener(this.history());
    return this.onMessage(() => listener(this.history()));
  }
  last(): ChatMessage | undefined {
    const h = this.history();
    return h[h.length - 1];
  }
}
