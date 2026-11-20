/** Candy-glass material: translucent backdrop-filter by default (including q=low / iPhone).
 *  Opaque fallback ONLY when backdrop-filter / -webkit-backdrop-filter is unsupported,
 *  when prefers-reduced-transparency: reduce is set, or when forced for tests
 *  (?chatGlass=opaque or setChatGlassFallback(true)).
 *  Test flags: ?chatGlass=opaque | ?chatGlass=filter, or setChatGlassFallback(true / false / null). */

export type ChatGlassMode = 'filter' | 'opaque';

let forced: ChatGlassMode | null = null;

export function setChatGlassFallback(on: boolean | null) {
  forced = on === null ? null : on ? 'opaque' : 'filter';
}

export function chatGlassForce(): ChatGlassMode | null { return forced; }

export function prefersReducedTransparency(win?: Pick<Window, 'matchMedia'> | null): boolean {
  try { return !!win?.matchMedia?.('(prefers-reduced-transparency: reduce)').matches; } catch { return false; }
}

export function supportsBackdropFilter(win?: { CSS?: { supports?(p: string, v: string): boolean } } | null): boolean {
  const css = win?.CSS;
  if (!css || typeof css.supports !== 'function') return false;
  return css.supports('backdrop-filter', 'blur(8px)') || css.supports('-webkit-backdrop-filter', 'blur(8px)');
}

export function parseChatGlassFlag(search: string): ChatGlassMode | null {
  try {
    const q = new URLSearchParams(search.startsWith('?') ? search : '?' + search);
    const raw = (q.get('chatGlass') ?? q.get('chatOpaque') ?? '').toLowerCase();
    if (raw === 'opaque' || raw === '1' || raw === 'true' || raw === 'yes') return 'opaque';
    if (raw === 'filter' || raw === 'glass' || raw === '0' || raw === 'false') return 'filter';
  } catch { /* */ }
  return null;
}

export function qualityFromSearch(search: string): 'low' | 'high' | undefined {
  try {
    const q = new URLSearchParams(search.startsWith('?') ? search : '?' + search).get('q');
    if (q === 'low' || q === 'high') return q;
  } catch { /* */ }
  return undefined;
}

/** Pure decision used by the UI and unit tests. Quality does not trigger the opaque fallback.
 *  When `win` is omitted, support is assumed (glass stays the default, including q=low). */
export function chatGlassFallback(opts: {
  quality?: 'low' | 'high';
  search?: string;
  win?: (Pick<Window, 'matchMedia'> & { CSS?: { supports?(p: string, v: string): boolean } }) | null;
  force?: ChatGlassMode | null;
} = {}): boolean {
  const force = opts.force !== undefined ? opts.force : forced;
  if (force === 'opaque') return true;
  if (force === 'filter') return false;
  const flag = parseChatGlassFlag(opts.search ?? '');
  if (flag === 'opaque') return true;
  if (flag === 'filter') return false;
  if (prefersReducedTransparency(opts.win ?? null)) return true;
  if (opts.win && !supportsBackdropFilter(opts.win)) return true;
  return false;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __setChatGlassFallback: typeof setChatGlassFallback }).__setChatGlassFallback = setChatGlassFallback;
}
