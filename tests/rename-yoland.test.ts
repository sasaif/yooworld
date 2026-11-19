import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { ITEMS } from '../src/fashion/catalogue';
import { netBadge } from '../src/net/netStatus';
import { isProdKey, looksLikeFullKey } from '../src/persistence/saveEnv';

const root = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

describe('player-facing name is YoLand', () => {
  it('uses YoLand in the HTML title and Apple web-app title', () => {
    const html = root('index.html');
    expect(html).toContain('<title>YoLand – Appartement</title>');
    expect(html).toContain('content="YoLand"');
    expect(html).not.toMatch(/YooWorld|Yoo World/);
  });

  it('uses YoLand in the web manifest', () => {
    const man = JSON.parse(root('public/manifest.webmanifest'));
    expect(man.name).toBe('YoLand');
    expect(man.short_name).toBe('YoLand');
  });

  it('uses YoLand on the landscape rotation screen and in the online-status copy', () => {
    const rot = root('src/ui/RotateOverlay.tsx');
    expect(rot).toContain('YoLand se joue en mode paysage.');
    expect(rot).not.toMatch(/YooWorld|Yoo World/);
    expect(netBadge('online', 2).detail).toContain('serveur YoLand');
    expect(netBadge('online', 2).detail).not.toMatch(/YooWorld/);
  });

  it('renames the shop tee display name but keeps the item id', () => {
    expect(ITEMS.tee_yoo.id).toBe('tee_yoo');
    expect(ITEMS.tee_yoo.name).toBe('Tee YoLand');
  });

  it('keeps place names that start with Yoo', () => {
    const loc = root('src/data/locations.ts') + root('src/game/beach/beachLayout.ts');
    expect(loc).toContain('Yoo Plage');
    expect(loc).toContain('Yoo Games Club');
    expect(loc).toContain('Café Yoo');
  });
});

describe('technical identifiers are unchanged', () => {
  it('keeps yooworld: / yw. save key prefixes', () => {
    expect(isProdKey('yooworld:profile')).toBe(true);
    expect(looksLikeFullKey('yooworld:apt:x')).toBe(true);
    expect(looksLikeFullKey('yw.camView')).toBe(true);
    const env = root('src/persistence/saveEnv.ts') + root('src/persistence/prefixedKV.ts');
    expect(env).toContain('yooworld:');
    expect(env).not.toContain('yoland:');
  });
});
