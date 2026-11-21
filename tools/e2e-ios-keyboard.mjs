#!/usr/bin/env node
/** iOS Safari keyboard: the page must never stay scrolled (real-device bug on uat@6d524ad, 21/11/2026: focusing the chat
 *  field scrolled the whole document, only the pink page background was left above the keyboard, and the user had to
 *  scroll back up after every message).
 *  EMULATION, not real Safari: Chromium does not scroll a position:fixed page for the keyboard, so an "iOS shim" models
 *  what WebKit does: on focus (and whenever the focused field is under the keyboard) it scrolls the page by the needed
 *  amount — window.scrollY / document.scrollingElement.scrollTop / visualViewport.offsetTop move together, the whole
 *  page is translated up (so canvas + HUD really leave the top) and 'scroll' fires on window + visualViewport —, and the
 *  keyboard is a visualViewport whose height is innerHeight - kb.
 *  Checks per device: keyboard open -> scrollY 0, canvas + HUD top at 0, input + Envoyer above the keyboard; send with
 *  Enter and with a tap on Envoyer -> message sent, field still focused, scrollY 0; blur -> scrollY 0, keyboard closed,
 *  joystick / Marche back at the same place and size as before.
 *  usage: node tools/e2e-ios-keyboard.mjs [url] ; SHOTS=dir */
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5795'}/`;
const SHOTS = process.env.SHOTS ?? '/workspace/games-3d/yooworld/art/.tmp/e2e-ios-keyboard';
fs.mkdirSync(SHOTS, { recursive: true });
const DEVS = [
  { name: 'iphone15_landscape', w: 852, h: 393, kb: 200 },
  { name: 'iphoneSE_landscape', w: 667, h: 375, kb: 190 },
  { name: 'iphone15_portrait', w: 393, h: 852, kb: 336 },
];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
const ok = (c, m, extra) => { results.push({ ok: !!c, m }); console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined && !c ? ' ' + JSON.stringify(extra) : '')); if (!c) process.exitCode = 1; };

/** installed before the app: WebKit-like page scroll for the on-screen keyboard (see header) */
function iosShim() {
  const st = { S: 0, kb: 0 }; window.__ios = st;
  const apply = (s, why) => {
    s = Math.max(0, Math.round(s)); if (s === st.S) return; st.S = s; st.log = (st.log || []).concat(why + ':' + s);
    document.documentElement.style.transform = s ? `translateY(${-s}px)` : '';
    window.dispatchEvent(new Event('scroll')); window.visualViewport.dispatchEvent(new Event('scroll'));
  };
  Object.defineProperty(window, 'scrollY', { get: () => st.S, configurable: true });
  Object.defineProperty(window, 'pageYOffset', { get: () => st.S, configurable: true });
  window.scrollTo = (x, y) => { const t = typeof x === 'object' ? x.top ?? 0 : y; apply(t, 'scrollTo'); };
  window.scroll = window.scrollTo;
  const sp = { get() { return st.S; }, set(v) { apply(v, 'scrollTop'); }, configurable: true };
  // init scripts run before <html> exists
  const patchDe = () => Object.defineProperty(document.documentElement, 'scrollTop', sp);
  if (document.documentElement) patchDe(); else new MutationObserver((_, mo) => { if (document.documentElement) { mo.disconnect(); patchDe(); } }).observe(document, { childList: true });
  const vv = window.visualViewport;
  Object.defineProperty(vv, 'offsetTop', { get: () => st.S, configurable: true });
  Object.defineProperty(vv, 'pageTop', { get: () => st.S, configurable: true });
  Object.defineProperty(vv, 'height', { get: () => window.innerHeight - st.kb, configurable: true });
  const field = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') ? a : null; };
  // WebKit: bring the focused field above the keyboard by scrolling the page (rect is visual, i.e. already shifted by -S)
  st.reveal = (why) => {
    const f = field(); if (!f || !st.kb) return; const r = f.getBoundingClientRect(); const limit = window.innerHeight - st.kb - 4;
    if (r.bottom > limit + 0.5) apply(st.S + (r.bottom - limit), why);
  };
  st.open = (kb) => { st.kb = kb; vv.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize')); };
  st.close = () => { st.kb = 0; vv.dispatchEvent(new Event('resize')); };
  // on focus, iOS scrolls before the page has a chance to react (the keyboard comes up with it)
  // (st.armed = keyboard height that comes up with the next focus, like a real tap on a field)
  document.addEventListener('focusin', () => {
    if (!field()) return;
    if (st.armed && !st.kb) { st.kb = st.armed; st.reveal('focus'); vv.dispatchEvent(new Event('resize')); } else setTimeout(() => st.reveal('focus'), 0);
  }, true);
  setInterval(() => st.reveal('keep'), 150);
}

async function boot(d) {
  const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('yw:e:dev:portrait', '1'); localStorage.setItem('yw:e:dev:camView', 'room'); } catch {} });
  await ctx.addInitScript(iosShim);
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${url}${url.includes('?') ? '&' : '?'}fresh=1&lieu=appart&q=low&chatSim=1`, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });
  await p.waitForTimeout(2500);
  await p.keyboard.press('F9'); // dev perf overlay off (clean screenshots)
  return { ctx, p };
}
const snap = (p, kb) => p.evaluate((kb) => {
  const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const vis = (e) => !!e && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' && +getComputedStyle(e).opacity > 0 && e.getBoundingClientRect().width > 0;
  const inp = document.querySelector('.chat-sheet .chatbar input'), btn = document.querySelector('.chat-sheet .chatbar .btn');
  const lim = innerHeight - kb;
  const above = (e) => { const r = e?.getBoundingClientRect(); return !!r && r.top >= -0.5 && r.bottom <= lim + 0.5; };
  return {
    scrollY: window.scrollY, S: window.__ios.S, log: (window.__ios.log || []).slice(-6), kbClass: document.documentElement.classList.contains('kb-open'),
    canvas: rect(document.querySelector('canvas')), hud: rect(document.querySelector('.hud-top')), stage: rect(document.querySelector('.stage')),
    joy: vis(document.querySelector('.joy')) ? rect(document.querySelector('.joy')) : null, run: vis(document.querySelector('.run-btn')) ? rect(document.querySelector('.run-btn')) : null,
    focused: document.activeElement === inp, inputAbove: above(inp), sendAbove: above(btn), input: rect(inp), rows: document.querySelectorAll('.chatlog .chat-row').length,
  };
}, kb);

for (const d of DEVS) {
  const { ctx, p } = await boot(d);
  const before = await snap(p, 0);
  ok(before.scrollY === 0 && before.canvas?.t === 0, `${d.name}: at rest -> page at 0, canvas top 0`, before);
  await p.evaluate(() => window.game.setPanel('chat'));
  await p.waitForFunction(() => { const e = document.querySelector('.chat-sheet'); return e && getComputedStyle(e).visibility !== 'hidden'; }, null, { timeout: 30000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${SHOTS}/${d.name}_0_chat_open.png` });
  // keyboard up: focus (WebKit scrolls the page) + visual viewport shrinks
  await p.evaluate((kb) => { window.__ios.armed = kb; }, d.kb);
  await p.tap('.chat-sheet .chatbar input');
  await p.waitForTimeout(1600); // > the 1.2 s late re-measure
  let s = await snap(p, d.kb);
  await p.screenshot({ path: `${SHOTS}/${d.name}_1_keyboard.png` });
  ok(s.kbClass, `${d.name}: keyboard open detected (kb-open)`, s);
  ok(s.scrollY === 0 && s.S === 0, `${d.name}: keyboard open -> page scrollY 0 (was scrolled by the focus: ${s.log.join(' ')})`, s);
  ok(s.canvas?.t === 0 && (s.hud?.t ?? 0) >= 0 && s.stage?.t === 0, `${d.name}: keyboard open -> canvas / stage top at 0, HUD on screen`, { canvas: s.canvas, hud: s.hud, stage: s.stage });
  ok(s.inputAbove && s.sendAbove, `${d.name}: keyboard open -> input + Envoyer above the keyboard (bottom <= ${d.h - d.kb})`, s.input);
  // send with Enter (enterkeyhint=send): field keeps the focus, page stays at 0
  const rows0 = s.rows;
  await p.keyboard.type('Salut tout le monde'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  s = await snap(p, d.kb);
  ok(s.rows === rows0 + 1, `${d.name}: Enter sends the message`, { rows0, rows: s.rows });
  ok(s.focused && s.scrollY === 0 && s.canvas?.t === 0 && s.inputAbove, `${d.name}: after Enter -> field still focused, scrollY 0, canvas top 0, input above the keyboard`, s);
  // send with a tap on Envoyer
  await p.keyboard.type('Deuxième message'); await p.tap('.chat-sheet .chatbar .btn'); await p.waitForTimeout(700);
  s = await snap(p, d.kb);
  ok(s.rows === rows0 + 2, `${d.name}: tap on Envoyer sends the message`, { rows0, rows: s.rows });
  ok(s.focused && s.scrollY === 0 && s.canvas?.t === 0 && s.inputAbove, `${d.name}: after Envoyer -> field still focused (keyboard stays), scrollY 0, canvas top 0`, s);
  await p.screenshot({ path: `${SHOTS}/${d.name}_2_after_send.png` });
  // keyboard down (blur), panel closed: controls back exactly where they were
  await p.evaluate(() => { window.__ios.armed = 0; document.activeElement?.blur(); window.__ios.close(); }); await p.waitForTimeout(900);
  s = await snap(p, 0);
  ok(!s.kbClass && s.scrollY === 0 && s.canvas?.t === 0, `${d.name}: blur -> keyboard closed, scrollY 0, canvas top 0`, s);
  await p.evaluate(() => window.game.setPanel(null));
  await p.waitForFunction(() => { const e = document.querySelector('.joy'); return !document.querySelector('.chat-sheet') && e && +getComputedStyle(e).opacity === 1; }, null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(600);
  s = await snap(p, 0);
  const same = (a, c) => (!a && !c) || (!!a && !!c && Math.abs(a.l - c.l) <= 1 && Math.abs(a.t - c.t) <= 1 && Math.abs(a.w - c.w) <= 1 && Math.abs(a.h - c.h) <= 1);
  ok(!!before.joy && same(before.joy, s.joy) && same(before.run, s.run), `${d.name}: panel closed -> joystick + Marche back, same place and size`, { before: [before.joy, before.run], after: [s.joy, s.run] });
  await p.screenshot({ path: `${SHOTS}/${d.name}_3_closed.png` });
  await ctx.close();
}
await b.close();
const f = results.filter((r) => !r.ok).length;
console.log(`\n${f ? 'FAILED' : 'ALL PASS'} (${results.length - f} PASS, ${f} FAIL) — Chromium emulation with an iOS scroll shim, not real Safari`);
