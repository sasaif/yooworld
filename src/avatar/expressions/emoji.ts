import type { Expression } from './presets';
/** Chat text -> temporary facial expression (pure). The LAST relevant emoji/smiley in the message wins
 *  ("je suis triste 😢 … mais 😂" ends happy). Unrelated emojis (🏠 🎉 👋 …) trigger nothing. */
const EMOJI: [Expression, string[]][] = [
  ['happy', ['😀', '😃', '😄', '😁', '😆', '😂', '🤣', '😊', '🙂', '☺️', '☺', '😍', '🥰', '😺', '😸', '😹', '🤗', '🥳']],
  ['angry', ['😠', '😡', '🤬', '👿', '😤', '💢', '😾']],
  ['sad', ['😢', '😭', '😞', '😔', '🙁', '☹️', '☹', '😟', '😥', '😿', '💔', '🥺']],
  ['surprised', ['😮', '😯', '😲', '😱', '🤯', '😳', '🙀', '😧', '😦']],
  ['wink', ['😉', '😜', '😘']],
];
/** ASCII smileys: only matched as standalone tokens (start/space before, end/space/punctuation after), so URLs
 *  ("http://x") and words never trigger. Longest first. */
const ASCII: [Expression, string[]][] = [
  ['angry', ['>:(', '>:-(', 'X(', 'x(']],
  ['wink', [';-)', ';)', ';-D', ';D', ';p', ';P']],
  ['sad', [":'(", ':-(', ':(', ':c']],
  ['surprised', [':-O', ':-o', ':O', ':o', ':0', 'O_O', 'o_o', 'O.O', 'o.O']],
  ['happy', [':-D', ':D', 'xD', 'XD', ':-)', ':)', '^^', '^_^', '(:']],
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const emojiList = EMOJI.flatMap(([e, l]) => l.map((s) => [s, e] as const)).sort((a, b) => b[0].length - a[0].length);
const asciiList = ASCII.flatMap(([e, l]) => l.map((s) => [s, e] as const)).sort((a, b) => b[0].length - a[0].length);
const LOOKUP = new Map<string, Expression>([...emojiList, ...asciiList]);
const RE = new RegExp(
  `(${emojiList.map(([s]) => esc(s)).join('|')})|(?:^|(?<=\\s))(${asciiList.map(([s]) => esc(s)).join('|')})(?=$|[\\s!?.,…])`, 'gu');

export function expressionFromText(text: string): Expression | null {
  if (!text) return null; let last: Expression | null = null; RE.lastIndex = 0;
  for (let m = RE.exec(text); m; m = RE.exec(text)) { const tok = m[1] ?? m[2]; const e = LOOKUP.get(tok); if (e) last = e; }
  return last;
}
