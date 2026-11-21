import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { shortfall, shortfallText, hasShortfall } from '../src/fashion/shortfall';
import { LocalDevEconomy } from '../src/economy/LocalDevEconomy';
import { FashionController } from '../src/fashion/FashionController';

describe('« Il te manque » (QA fashion-glam): what is missing, never a negative balance', () => {
  it('per currency, clamped at 0', () => {
    expect(shortfall({ gold: 0, diamond: 150 }, { gold: 5000, diamond: 100 })).toEqual({ gold: 0, diamond: 50 });
    expect(shortfall({ gold: 6000, diamond: 50 }, { gold: 5000, diamond: 100 })).toEqual({ gold: 1000, diamond: 0 });
    expect(hasShortfall(shortfall({ gold: 10, diamond: 10 }, { gold: 10, diamond: 10 }))).toBe(false);
  });
  it('text', () => {
    expect(shortfallText({ gold: 0, diamond: 50 })).toBe('Il te manque 50 💎');
    expect(shortfallText({ gold: 1200, diamond: 0 })).toBe('Il te manque 1 200 🪙');
    expect(shortfallText({ gold: 120, diamond: 50 })).toBe('Il te manque 120 🪙 et 50 💎');
    expect(shortfallText({ gold: 0, diamond: 0 })).toBe('');
  });
  it('FashionController.missing uses the live balances', () => {
    const m = new Map<string, string>(); const k = { getItem: (x: string) => m.get(x) ?? null, setItem: (x: string, v: string) => void m.set(x, v), removeItem: (x: string) => void m.delete(x) };
    const fc = new FashionController(new LocalDevEconomy(k)); const a = fc.eco.snapshot().account;
    expect(fc.missing({ gold: a.gold.balance + 7, diamond: 0 })).toEqual({ gold: 7, diamond: 0 });
    expect(fc.missing({ gold: 0, diamond: a.diamond.balance })).toEqual({ gold: 0, diamond: 0 });
  });
});
describe('DEV-only probes', () => {
  it('window.__avatarStats / __glam are only installed behind import.meta.env.DEV', () => {
    const src = readFileSync(new URL('../src/app/services.ts', import.meta.url), 'utf8');
    const dev = src.slice(src.indexOf('if (import.meta.env.DEV) {'));
    expect(src.indexOf('if (import.meta.env.DEV) {')).toBeGreaterThan(0);
    expect(src.indexOf('.__avatarStats =')).toBeGreaterThan(src.indexOf('if (import.meta.env.DEV) {'));
    expect(dev.slice(0, dev.indexOf('\n}\n'))).toMatch(/__avatarStats =[\s\S]*__glam =/);
  });
});
