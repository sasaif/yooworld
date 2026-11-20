#!/usr/bin/env node
/** Option C candy-glass chat: 0 px overlap at rest / history / typing, opaque fallback, no extra 3D draws.
 *  usage: node tools/e2e-chat-glass.mjs [url] ; SHOTS=dir
 */
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');

const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5795'}/`;
const SHOTS = process.env.SHOTS ?? '/workspace/games-3d/yooworld/art/.tmp/e2e-chat-glass';
fs.mkdirSync(SHOTS, { recursive: true });

const DEVS = [
  { name: 'iphone15', w: 852, h: 393, dpr: 3, touch: true, kb: 190 },
  { name: 'iphoneSE', w: 667, h: 375, dpr: 2, touch: true, kb: 180 },
  { name: 'desktop', w: 1440, h: 900, dpr: 1, touch: false, kb: 280 },
];

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
const ok = (c, m, extra) => { results.push({ ok: !!c, m, extra }); console.log((c ? 'PASS ' : 'FAIL ') + m + (extra && !c ? ' ' + JSON.stringify(extra) : '')); if (!c) process.exitCode = 1; };
const box = (r) => r && r.w > 0 && r.h > 0 ? r : null;
const inter = (a, c) => {
  if (!a || !c) return { ix: 0, iy: 0, overlaps: false };
  const ix = Math.max(0, Math.min(a.r, c.r) - Math.max(a.l, c.l));
  const iy = Math.max(0, Math.min(a.b, c.b) - Math.max(a.t, c.t));
  return { ix: +ix.toFixed(1), iy: +iy.toFixed(1), overlaps: ix > 0 && iy > 0 };
};

const measure = (p, uiSel, hiddenOk = false) => p.evaluate(({ uiSel, hiddenOk }) => {
  const br = (s) => {
    const e = typeof s === 'string' ? document.querySelector(s) : s;
    if (!e) return null;
    const cs = getComputedStyle(e);
    if (hiddenOk && (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0)) return null;
    const b = e.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return null;
    return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
  };
  const uiEls = [...document.querySelectorAll(uiSel)];
  const ui = uiEls.map((e) => br(e)).filter(Boolean);
  const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0 && e.getBoundingClientRect().width > 0; };
  let avatar = null;
  try {
    const m = window.__metrics?.();
    const id = window.game?.s?.activeChar ?? 'f';
    const bb = m?.[id]?.bboxPx;
    if (bb) avatar = { l: bb[0], t: bb[1], r: bb[2], b: bb[3], w: bb[2] - bb[0], h: bb[3] - bb[1] };
  } catch { /* */ }
  const bubbles = [...document.querySelectorAll('.bubble')].map((e) => br(e)).filter(Boolean);
  const sheet = document.querySelector('.chat-sheet');
  const sr = sheet?.getBoundingClientRect();
  return {
    ui, joy: br('.joy'), run: br('.run-btn'), dock: br('.dock'), mood: br('.mood-wrap'),
    avatar, bubbles,
    vis: { joy: vis('.joy'), run: vis('.run-btn'), dock: vis('.dock'), mood: vis('.mood-wrap') },
    kb: document.documentElement.classList.contains('kb-open'),
    glass: (document.querySelector('.chat-sheet') || document.querySelector('.chat-preview'))?.getAttribute('data-chat-glass') || null,
    area: sr ? +(100 * sr.width * sr.height / (innerWidth * innerHeight)).toFixed(2) : 0,
    mode: sheet?.querySelector('.chat-mode')?.textContent || '',
    scope: sheet?.querySelector('.chat-scope')?.textContent || '',
    calls: window.__info?.calls ?? null, callsMain: window.__info?.callsMain ?? null,
  };
}, { uiSel, hiddenOk });

const overlapsOf = (m, keys) => {
  const out = {};
  for (const k of keys) {
    const target = k === 'avatar' ? m.avatar : k === 'bubble' ? (m.bubbles?.[0] || null) : m[k];
    const parts = m.ui || [];
    const hit = parts.map((p) => inter(p, target)).reduce((a, x) => ({
      ix: Math.max(a.ix, x.ix), iy: Math.max(a.iy, x.iy), overlaps: a.overlaps || x.overlaps,
    }), { ix: 0, iy: 0, overlaps: false });
    out[k] = hit;
  }
  return out;
};

const boot = async (d, query = 'fresh=1&lieu=appart&q=low') => {
  const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: Math.min(d.dpr, 2), isMobile: d.touch, hasTouch: d.touch });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('yw:e:dev:portrait', '1'); localStorage.setItem('yw:e:dev:camView', 'room'); } catch {} });
  const p = await ctx.newPage();
  await p.goto(`${url}${url.includes('?') ? '&' : '?'}${query}`, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && window.__metrics, null, { timeout: 180000 });
  await p.waitForTimeout(3000);
  await p.keyboard.press('F9');
  return { ctx, p };
};

let drawsRest = null, drawsHistory = null;

for (const d of DEVS) {
  const { ctx, p } = await boot(d);
  await p.evaluate(() => { window.game.setPanel(null); window.game.sendChat('Salut tout le monde !'); });
  await p.waitForTimeout(400);

  // --- rest ---
  const rest = await measure(p, '.chat-preview', false);
  const restKeys = ['joy', 'run', 'dock', 'mood', 'avatar'].filter((k) => k === 'avatar' || rest.vis[k]);
  const restOv = overlapsOf(rest, restKeys);
  const restBad = Object.entries(restOv).filter(([, v]) => v.overlaps);
  ok(rest.ui.length >= 1, `${d.name} rest: preview visible`, rest.ui);
  ok(restBad.length === 0, `${d.name} rest: 0 px vs ${restKeys.join(', ')}`, restOv);
  ok(rest.glass === 'filter', `${d.name} rest: q=low defaults to glass`, { glass: rest.glass });
  if (d.name === 'iphone15') drawsRest = rest.calls;
  await p.screenshot({ path: `${SHOTS}/${d.name}_rest.png` });

  // --- history ---
  await p.evaluate(() => window.game.setPanel('chat'));
  await p.waitForTimeout(400);
  const hist = await measure(p, '.chat-sheet, .chat-sheet *', false);
  // measure the sheet as a single part (not every descendant) to avoid huge unions
  const histSheet = await measure(p, '.chat-sheet', false);
  const histKeys = ['joy', 'run', 'dock', 'mood', 'avatar'].filter((k) => k === 'avatar' || histSheet.vis[k]);
  const histOv = overlapsOf(histSheet, histKeys);
  const histBad = Object.entries(histOv).filter(([, v]) => v.overlaps);
  ok(!!histSheet.ui.length, `${d.name} history: panel visible`);
  ok(/Mode local/.test(histSheet.mode) && /(seuls tes avatars|cet appareil)/.test(histSheet.scope), `${d.name} history: Mode local + scope`, { mode: histSheet.mode, scope: histSheet.scope });
  if (d.h < 500) ok(histSheet.area <= 22, `${d.name} history: area ≤ 22 % (${histSheet.area})`, { area: histSheet.area });
  ok(histBad.length === 0, `${d.name} history: 0 px vs ${histKeys.join(', ')}`, histOv);
  ok(histSheet.glass === 'filter', `${d.name} history: q=low defaults to glass`, { glass: histSheet.glass });
  if (d.name === 'iphone15') drawsHistory = histSheet.calls;
  if (d.name === 'iphone15') ok(histSheet.vis.run === true, 'iphone15 history: Run stays visible while compact chat is open');
  await p.screenshot({ path: `${SHOTS}/${d.name}_history.png` });

  // --- typing ---
  await p.evaluate(() => window.game.sendChat('Toujours là !')); // refresh say() bubble
  await p.waitForTimeout(200);
  await p.focus('.chat-sheet input');
  await p.evaluate((h) => {
    Object.defineProperty(window.visualViewport, 'height', { get: () => window.innerHeight - h, configurable: true });
    Object.defineProperty(window.visualViewport, 'offsetTop', { get: () => 0, configurable: true });
    window.visualViewport.dispatchEvent(new Event('resize'));
  }, d.kb);
  await p.waitForTimeout(350);
  const typ = await measure(p, '.chat-sheet', true);
  const typKeys = typ.kb ? ['avatar', 'bubble'] : ['joy', 'run', 'dock', 'mood', 'avatar'];
  const typOv = overlapsOf({ ...typ, ui: typ.ui }, typKeys);
  const typBad = Object.entries(typOv).filter(([, v]) => v.overlaps);
  ok(typ.kb, `${d.name} typing: kb-open`);
  ok(typ.vis.dock === false && typ.vis.joy === false, `${d.name} typing: joystick and dock hidden`, typ.vis);
  ok(typBad.length === 0, `${d.name} typing: 0 px vs ${typKeys.join(', ')}`, typOv);
  const inV = await p.evaluate((vh) => {
    const q = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom }; };
    const vis = (r) => !!r && r.t >= -0.5 && r.b <= vh + 0.5;
    return { input: vis(q('.chat-sheet input')), send: vis(q('.chat-sheet .chatbar .btn')), x: vis(q('.chat-sheet .x')), vh };
  }, d.h - d.kb);
  ok(inV.input && inV.send, `${d.name} typing: input + Envoyer in visual viewport`, inV);
  if (d.h - d.kb >= 125) ok(inV.x, `${d.name} typing: header ✕ in visual viewport`, inV);
  await p.screenshot({ path: `${SHOTS}/${d.name}_typing.png` });
  await ctx.close();
}

// Opaque fallback forced via query + programmatic flag, and glass filter override.
{
  const d = DEVS[0];
  const { ctx, p } = await boot(d, 'fresh=1&lieu=appart&q=high&chatGlass=opaque');
  await p.evaluate(() => window.game.setPanel('chat'));
  await p.waitForTimeout(300);
  const g = await p.evaluate(() => document.querySelector('.chat-sheet')?.getAttribute('data-chat-glass'));
  const cs = await p.evaluate(() => { const e = document.querySelector('.chat-sheet'); return e ? getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter : null; });
  ok(g === 'opaque', 'forced ?chatGlass=opaque on q=high', { g, cs });
  ok(g === 'opaque' && (!cs || cs === 'none'), 'opaque fallback disables backdrop-filter', { cs });
  await p.screenshot({ path: `${SHOTS}/iphone15_opaque_flag.png` });
  await ctx.close();
}
{
  const d = DEVS[0];
  const { ctx, p } = await boot(d, 'fresh=1&lieu=appart&q=low&chatGlass=filter');
  await p.evaluate(() => window.game.setPanel('chat'));
  await p.waitForTimeout(300);
  const g = await p.evaluate(() => document.querySelector('.chat-sheet')?.getAttribute('data-chat-glass'));
  const cs = await p.evaluate(() => { const e = document.querySelector('.chat-sheet'); return e ? getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter : null; });
  ok(g === 'filter', '?chatGlass=filter keeps the glass path at q=low', { g, cs });
  ok(g === 'filter' && cs && cs !== 'none', 'default glass applies backdrop-filter', { cs });
  await p.screenshot({ path: `${SHOTS}/iphone15_glass_filter.png` });
  await p.evaluate(() => window.__setChatGlassFallback(true));
  await p.waitForTimeout(100);
  const g2 = await p.evaluate(() => document.querySelector('.chat-sheet')?.getAttribute('data-chat-glass'));
  ok(g2 === 'opaque', '__setChatGlassFallback(true) switches the live panel to opaque', { g2 });
  await ctx.close();
}
{
  // No-support emulation: CSS.supports reports no backdrop-filter, so q=low must fall back to opaque.
  const d = DEVS[0];
  const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: Math.min(d.dpr, 2), isMobile: d.touch, hasTouch: d.touch });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('yw:e:dev:portrait', '1'); localStorage.setItem('yw:e:dev:camView', 'room'); } catch { /* */ }
    const css = window.CSS || (window.CSS = {});
    css.supports = () => false;
  });
  const p = await ctx.newPage();
  await p.goto(`${url}${url.includes('?') ? '&' : '?'}fresh=1&lieu=appart&q=low`, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && window.__metrics, null, { timeout: 180000 });
  await p.waitForTimeout(3000);
  await p.keyboard.press('F9');
  await p.evaluate(() => window.game.setPanel('chat'));
  await p.waitForTimeout(300);
  const g = await p.evaluate(() => document.querySelector('.chat-sheet')?.getAttribute('data-chat-glass'));
  const cs = await p.evaluate(() => { const e = document.querySelector('.chat-sheet'); return e ? getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter : null; });
  ok(g === 'opaque', 'no backdrop-filter support falls back to opaque at q=low', { g, cs });
  await ctx.close();
}

if (drawsRest != null && drawsHistory != null) {
  ok(drawsHistory === drawsRest, `draw-call probe: opening chat adds 0 extra 3D draws (rest ${drawsRest} → history ${drawsHistory})`, { drawsRest, drawsHistory });
} else {
  ok(false, 'draw-call probe: __info.calls missing', { drawsRest, drawsHistory });
}

const pass = results.filter((r) => r.ok).length;
console.log(`== e2e-chat-glass: ${pass}/${results.length} passed ==`);
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify({ pass, total: results.length, results, drawsRest, drawsHistory }, null, 2));
await b.close();
