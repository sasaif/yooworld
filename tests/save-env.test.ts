import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeSaveEnv, isProdKey, SAVE_ENV } from '../src/persistence/saveEnv';
import { EnvKV, memoryStorage, SaveEnvError } from '../src/persistence/prefixedKV';
import { LocalStorageRepository } from '../src/persistence/LocalStorageRepository';
import { LocalDevEconomy } from '../src/economy/LocalDevEconomy';
import { defaultApartment } from '../src/data/defaultApartment';
// @ts-expect-error plain .mjs build helper (no types)
import { resolveSaveEnv } from '../tools/save-env-rules.mjs';

const prod = makeSaveEnv('prod'); const c1 = makeSaveEnv('test/combined-1'); const dev = makeSaveEnv('dev');
const LEGACY = ['yooworld:profile', 'yooworld:eco:dev', 'yooworld:look:test-player:f', 'yooworld:apt:home_x', 'yooworld:inv:p_x', 'yw.camView', 'yw.controls.v1', 'yw.chatCollapsed', 'yw.placesSeen', 'yw.lieuDefaultUsed', 'yw.hairSheen', 'yw.portrait'];

describe('save env ids and prefixes (P0.A)', () => {
  it('prod keeps the exact legacy key strings (no orphaned saves)', () => {
    const raw = memoryStorage(); const d = new EnvKV(prod, raw, 'data'); const p = new EnvKV(prod, raw, 'pref');
    expect(d.full('profile')).toBe('yooworld:profile'); expect(d.full('eco:dev')).toBe('yooworld:eco:dev');
    expect(d.full('look:test-player:f')).toBe('yooworld:look:test-player:f'); expect(d.full('apt:home_x')).toBe('yooworld:apt:home_x');
    expect(p.full('camView')).toBe('yw.camView'); expect(p.full('controls.v1')).toBe('yw.controls.v1');
    d.setItem('profile', 'P'); p.setItem('camView', 'avatar'); expect([...raw.m.keys()].sort()).toEqual(['yooworld:profile', 'yw.camView']);
  });
  it('test folders and dev get their own prefix', () => {
    expect(c1.tag).toBe('test.combined-1'); expect(c1.dataPrefix).toBe('yooworld:e:test.combined-1:'); expect(c1.prefPrefix).toBe('yw:e:test.combined-1:');
    expect(dev.dataPrefix).toBe('yooworld:e:dev:'); expect(makeSaveEnv('dev/feat-x').prefPrefix).toBe('yw:e:dev.feat-x:');
    const raw = memoryStorage(); new EnvKV(c1, raw, 'data').setItem('eco:dev', '1'); new EnvKV(c1, raw, 'pref').setItem('camView', 'room');
    expect([...raw.m.keys()].sort()).toEqual(['yooworld:e:test.combined-1:eco:dev', 'yw:e:test.combined-1:camView']);
    for (const k of raw.m.keys()) expect(isProdKey(k)).toBe(false);
  });
  it('non-prod adapter throws on ANY legacy root key access (get/set/remove)', () => {
    const raw = memoryStorage(); for (const k of LEGACY) raw.setItem(k, 'ROOT');
    for (const env of [c1, dev]) for (const space of ['data', 'pref'] as const) {
      const kv = new EnvKV(env, raw, space);
      for (const k of LEGACY) {
        expect(() => kv.getItem(k)).toThrow(SaveEnvError); expect(() => kv.setItem(k, 'x')).toThrow(SaveEnvError); expect(() => kv.removeItem(k)).toThrow(SaveEnvError);
      }
    }
    for (const k of LEGACY) expect(raw.getItem(k)).toBe('ROOT');
  });
  it('prod adapter refuses other envs\' keys and full key names', () => {
    const kv = new EnvKV(prod, memoryStorage(), 'data');
    expect(() => kv.getItem('e:test.combined-1:eco:dev')).toThrow(SaveEnvError); expect(() => kv.getItem('yooworld:profile')).toThrow(SaveEnvError);
  });
  it('keys() lists only the own env (prod excludes yooworld:e:*)', () => {
    const raw = memoryStorage(); for (const k of LEGACY) raw.setItem(k, 'R'); raw.setItem('yooworld:e:test.combined-1:eco:dev', 'C'); raw.setItem('yooworld:e:dev:profile', 'D');
    expect(new EnvKV(prod, raw, 'data').keys()).toEqual(['apt:home_x', 'eco:dev', 'inv:p_x', 'look:test-player:f', 'profile']);
    expect(new EnvKV(c1, raw, 'data').keys()).toEqual(['eco:dev']);
  });
  it('invalid env ids are rejected; vitest builds as dev (never prod)', () => {
    for (const bad of ['', 'production', 'test/', 'test/a/b', 'test/../x', 'Prod']) expect(() => makeSaveEnv(bad)).toThrow();
    expect(SAVE_ENV.id).toBe('dev'); expect(SAVE_ENV.isProd).toBe(false);
  });
  it('repository + economy on a test env never write a root key', async () => {
    const raw = memoryStorage(); for (const k of LEGACY) raw.setItem(k, '"ROOT:' + k + '"');
    const before = JSON.stringify([...raw.m.entries()]);
    const kv = new EnvKV(c1, raw, 'data'); const repo = new LocalStorageRepository(kv);
    const a = defaultApartment('p_x'); await repo.saveApartment({ ...a, id: 'home_x' }); expect(await repo.loadProfile()).toBeNull();
    const eco = new LocalDevEconomy(kv); await eco.checkout(['tee_heart'], 'k1'); await eco.saveLook(eco.loadLook('f') ?? { v: 1, body: 'f', slots: {} });
    for (const k of LEGACY) expect(raw.getItem(k)).toBe('"ROOT:' + k + '"');
    expect(JSON.stringify([...raw.m.entries()].filter(([k]) => isProdKey(k)))).toBe(JSON.stringify(JSON.parse(before).filter(([k]: [string]) => isProdKey(k))));
    expect([...raw.m.keys()].filter((k) => k.startsWith('yooworld:e:test.combined-1:')).sort()).toEqual(['yooworld:e:test.combined-1:apt:home_x', 'yooworld:e:test.combined-1:eco:dev', 'yooworld:e:test.combined-1:look:test-player:f']);
  });
});

describe('build-time env resolution fails closed (P0.A guard)', () => {
  it('main game root is prod, a subfolder is test/<folder>', () => {
    expect(resolveSaveEnv({ GH_PAGES: '1', GH_PAGES_BASE: '/yooworld/' })).toEqual({ base: '/yooworld/', envId: 'prod' });
    expect(resolveSaveEnv({ GH_PAGES: '1', GH_PAGES_BASE: '/yooworld/combined-1/' })).toEqual({ base: '/yooworld/combined-1/', envId: 'test/combined-1' });
    expect(resolveSaveEnv({ GH_PAGES_BASE: '/yooworld/combined-1/', VITE_YW_ENV: 'test/combined-1' }).envId).toBe('test/combined-1');
    expect(resolveSaveEnv({}).envId).toBe('dev'); expect(resolveSaveEnv({ VITE_YW_ENV: 'dev/x' }).envId).toBe('dev/x');
  });
  it('throws on missing/invalid base or an env that does not match the folder', () => {
    expect(() => resolveSaveEnv({ GH_PAGES: '1' })).toThrow(/explicit GH_PAGES_BASE/);
    expect(() => resolveSaveEnv({ GH_PAGES: '1', GH_PAGES_BASE: '' })).toThrow();
    expect(() => resolveSaveEnv({ GH_PAGES: '1', GH_PAGES_BASE: '/yooworld/combined-1/', VITE_YW_ENV: 'prod' })).toThrow(/never be prod/);
    expect(() => resolveSaveEnv({ GH_PAGES: '1', GH_PAGES_BASE: '/yooworld/a/b/' })).toThrow();
    expect(() => resolveSaveEnv({ GH_PAGES: '1', GH_PAGES_BASE: '/other/' })).toThrow();
    expect(() => resolveSaveEnv({ GH_PAGES: '1', GH_PAGES_BASE: '/yooworld/', VITE_YW_ENV: 'test/x' })).toThrow();
    expect(() => resolveSaveEnv({ VITE_YW_ENV: 'prod' })).toThrow(/only allowed/);
  });
  it('tools/check-save-env.mjs exits non-zero for a subfolder configured as prod', () => {
    const run = (env: Record<string, string>) => { try { execFileSync(process.execPath, ['tools/check-save-env.mjs'], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: 'pipe' }); return 0; } catch (e) { return (e as { status: number }).status; } };
    expect(run({ GH_PAGES: '1', GH_PAGES_BASE: '/yooworld/combined-1/', VITE_YW_ENV: 'prod' })).not.toBe(0);
    expect(run({ GH_PAGES: '1' })).not.toBe(0);
    expect(run({ GH_PAGES: '1', GH_PAGES_BASE: '/yooworld/combined-1/' })).toBe(0);
  });
});

describe('no direct Web Storage access outside the adapter (P0.A)', () => {
  it('only src/persistence/storage.ts references localStorage / sessionStorage / indexedDB in code', () => {
    const offenders: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f.name)) {
        const code = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        if (/\b(localStorage|sessionStorage|indexedDB)\b/.test(code) && !p.endsWith(path.join('persistence', 'storage.ts'))) offenders.push(p);
      } } };
    walk('src'); expect(offenders).toEqual([]);
  });
});
