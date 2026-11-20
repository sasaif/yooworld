import { afterEach, describe, expect, it } from 'vitest';
import { chatGlassFallback, parseChatGlassFlag, setChatGlassFallback, supportsBackdropFilter } from '../src/ui/chat/chatGlass';

afterEach(() => setChatGlassFallback(null));

describe('candy-glass opaque fallback flag', () => {
  it('falls back on quality low, and not on high when support is unknown (no win)', () => {
    expect(chatGlassFallback({ quality: 'low', search: '' })).toBe(true);
    expect(chatGlassFallback({ quality: 'high', search: '' })).toBe(false);
  });

  it('honours ?chatGlass=opaque and ?chatGlass=filter (filter wins over quality low)', () => {
    expect(parseChatGlassFlag('?q=low&chatGlass=opaque')).toBe('opaque');
    expect(chatGlassFallback({ quality: 'high', search: '?chatGlass=opaque' })).toBe(true);
    expect(chatGlassFallback({ quality: 'low', search: '?chatGlass=filter' })).toBe(false);
  });

  it('setChatGlassFallback forces the mode until reset', () => {
    setChatGlassFallback(true);
    expect(chatGlassFallback({ quality: 'high', search: '?chatGlass=filter' })).toBe(true);
    setChatGlassFallback(false);
    expect(chatGlassFallback({ quality: 'low' })).toBe(false);
    setChatGlassFallback(null);
    expect(chatGlassFallback({ quality: 'low' })).toBe(true);
  });

  it('falls back when backdrop-filter is missing or reduced transparency is requested', () => {
    const noCss = { matchMedia: () => ({ matches: false }), CSS: undefined };
    expect(chatGlassFallback({ quality: 'high', win: noCss as unknown as Window })).toBe(true);
    const reduced = {
      matchMedia: (q: string) => ({ matches: /prefers-reduced-transparency:\s*reduce/.test(q) }),
      CSS: { supports: () => true },
    };
    expect(chatGlassFallback({ quality: 'high', win: reduced as unknown as Window })).toBe(true);
    const ok = {
      matchMedia: () => ({ matches: false }),
      CSS: { supports: (p: string) => p.includes('backdrop-filter') },
    };
    expect(supportsBackdropFilter(ok)).toBe(true);
    expect(chatGlassFallback({ quality: 'high', win: ok as unknown as Window })).toBe(false);
  });
});
