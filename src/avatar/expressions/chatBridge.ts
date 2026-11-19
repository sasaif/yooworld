import type { ExpressionBus } from './bus';
import { expressionFromText } from './emoji';
/** Chat messages with a relevant emoji/smiley show a temporary expression on the sender's avatar (local and remote).
 *  Uses only the public ChatService.onMessage API: no change to the chat files. Returns the unsubscribe function. */
export interface ChatLike { onMessage(cb: (m: { from: string; text: string }) => void): () => void }
export function installChatExpressions(chat: ChatLike, bus: ExpressionBus, resolveCharId: (from: string) => string | null | undefined = (f) => f): () => void {
  return chat.onMessage((m) => { const e = expressionFromText(m.text); if (!e) return; const id = resolveCharId(m.from); if (id) bus.trigger(id, e, { source: 'chat' }); });
}
