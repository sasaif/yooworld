#!/usr/bin/env node
/** Plan B chat layout 'right-dock' (?chatLayout=right, OFF by default): fixed column flush right, collapsible tab.
 *  iPhone SE 375x667 / 667x375 and iPhone 15 393x852 / 852x393: tab + open column never overlap the joystick, Run,
 *  dock, Mood or the top chips (live DOM rects, + simulated safe-area insets), column under the chips and above the
 *  dock, width ~min(42vw|34vw, 260), messages >= 13 px, no drag / resize, composer 100 % visible with the keyboard
 *  simulated, collapse / reopen, joystick usable with the column open, flag OFF -> current floating panel.
 *  usage: node tools/e2e-chat-right-dock.mjs [url] ; SHOTS=dir */
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5793'}/`;
const SHOTS = process.env.SHOTS ?? '/workspace/games-3d/yooworld/art/.tmp/e2e-chat-right-dock';
fs.mkdirSync(SHOTS, { recursive: true });
const DEVS = [
  { name: 'iphoneSE_portrait', w: 375, h: 667, kb: 260 },
  { name: 'iphoneSE_landscape', w: 667, h: 375, kb: 180 },
  { name: 'iphone15_portrait', w: 393, h: 852, kb: 336, sat: 59, sab: 34 },
  { name: 'iphone15_landscape', w: 852, h: 393, kb: 190, sal: 59, sar: 59, sab: 21 },
].filter((d) => !process.env.DEV || process.env.DEV.split(',').includes(d.name));
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
const ok = (c, m, extra) => { results.push({ ok: !!c, m }); console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined && !c ? ' ' + JSON.stringify(extra) : '')); if (!c) process.exitCode = 1; };
const ov = (a, c, g = 0) => !!a && !!c && Math.min(a.r, c.r) - Math.max(a.l, c.l) > 0.5 - g && Math.min(a.b, c.b) - Math.max(a.t, c.t) > 0.5 - g;
const waitFor = (p, fn, arg, ms = 8000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).catch(() => {});

async function boot(d, query) {
  const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((d) => {
    try { sessionStorage.setItem('yw:e:dev:portrait', '1'); localStorage.setItem('yw:e:dev:camView', 'room'); } catch {}
    // simulated notch / home-indicator insets (Chrome has no env(safe-area-inset-*) here): override the CSS vars
    if (d.sat || d.sar || d.sab || d.sal) addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = `:root{--sat:${d.sat ?? 0}px!important;--sar:${d.sar ?? 0}px!important;--sab:${d.sab ?? 0}px!important;--sal:${d.sal ?? 0}px!important}`; document.head.appendChild(s); });
  }, d);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${url}?${query}`, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && window.__chatSim, null, { timeout: 180000 });
  await p.waitForTimeout(2500);
  await p.keyboard.press('F9');
  return { ctx, p };
}
const snap = (p) => p.evaluate(() => {
  const vis = (e) => { if (!e) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.width > 0 && r.height > 0; };
  const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const controls = [];
  for (const [name, sel] of [['joystick', '.joy'], ['run', '.run-btn'], ['dock', '.dock'], ['mood', '.mood-wrap']]) document.querySelectorAll(sel).forEach((e) => { if (vis(e) && !e.closest('.chat-sheet')) controls.push({ name, ...rect(e) }); });
  document.querySelectorAll('.hud-top > *').forEach((e, i) => { if (vis(e)) controls.push({ name: 'top-chip-' + i, ...rect(e) }); });
  const sheet = document.querySelector('.chat-sheet'); const tab = document.querySelector('.chat-dock-tab'); const fab = document.querySelector('.chat-fab');
  const bub = [...document.querySelectorAll('.chat-sheet .chat-bub')].map((e) => parseFloat(getComputedStyle(e).fontSize));
  const nm = [...document.querySelectorAll('.chat-sheet .chat-nm')].filter(vis).map((e) => parseFloat(getComputedStyle(e).fontSize));
  const sar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sar')) || 0;
  return {
    vw: innerWidth, vh: innerHeight, sar, controls,
    sheet: vis(sheet) ? rect(sheet) : null, right: !!sheet?.classList.contains('chat-right-dock'),
    tab: vis(tab) ? rect(tab) : null, fab: vis(fab) ? rect(fab) : null,
    grip: !!document.querySelector('.chat-sheet .chat-grip'), sizeBtns: document.querySelectorAll('.chat-sheet .chat-size').length,
    bubMin: bub.length ? Math.min(...bub) : 0, nmMin: nm.length ? Math.min(...nm) : 0, rows: document.querySelectorAll('.chatlog .chat-row').length,
    joyVisible: vis(document.querySelector('.joy')), kb: document.documentElement.classList.contains('kb-open'),
    unread: +(document.querySelector('.chat-preview .chat-unread')?.textContent || 0),
    av: window.game?.s.activeChar, pos: (() => { const c = window.__world?.chars?.[window.game?.s.activeChar]; return c ? { x: c.pos.x, z: c.pos.z } : null; })(),
  };
});
const composer = (p, vvH) => p.evaluate((vvH) => {
  const sheet = document.querySelector('.chat-sheet'); const bot = vvH ?? innerHeight;
  const one = (el) => {
    if (!el || !sheet) return { ok: false };
    const r = el.getBoundingClientRect(), s = sheet.getBoundingClientRect();
    const inVp = r.top >= -0.5 && r.bottom <= bot + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5;
    const inSheet = r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5 && r.left >= s.left - 0.5 && r.right <= s.right + 0.5;
    const pts = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + r.width / 2, r.top + r.height / 2], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]];
    const hits = pts.map(([x, y]) => (document.elementsFromPoint(x, y) || []).some((n) => n === el || el.contains(n) || n.closest?.('.chatbar')));
    return { ok: inVp && inSheet && hits.every(Boolean) && r.width >= 30, inVp, inSheet, hits, w: +r.width.toFixed(1) };
  };
  return { input: one(document.querySelector('.chat-sheet .chatbar input')), send: one(document.querySelector('.chat-sheet .chatbar .btn')) };
}, vvH);
const noOverlap = (box, s, label) => {
  const hits = s.controls.filter((c) => ov(box, c));
  ok(!!box && hits.length === 0, `${label}: no overlap with joystick / Run / dock / Mood / top chips (${s.controls.map((c) => c.name).join(',')})`, { box, hits });
};

for (const d of DEVS) {
  const portrait = d.h > d.w;
  const { ctx, p } = await boot(d, 'fresh=1&lieu=appart&q=low&chatSim=1&chatLayout=right');
  const L = `[${d.name}]`;
  // 1. collapsed tab
  await p.evaluate(() => { window.__chatSim.receive('m', 'Coucou ! Tu viens à la plage ?'); });
  await waitFor(p, () => +(document.querySelector('.chat-preview .chat-unread')?.textContent || 0) > 0);
  let s = await snap(p);
  ok(!!s.tab && !s.fab, `${L} closed: slim right tab shown (no floating Chat button)`, s);
  ok(!!s.tab && Math.abs(s.tab.r - (d.w - (d.sar ?? 0))) <= 0.5 && s.tab.r - s.tab.l <= 40, `${L} closed: tab flush to the right edge / safe area, slim (w ${s.tab ? (s.tab.r - s.tab.l).toFixed(0) : '-'})`, s.tab);
  ok(s.unread === 1, `${L} closed: unread badge on the tab`, s.unread);
  noOverlap(s.tab, s, `${L} closed tab`);
  await p.screenshot({ path: `${SHOTS}/${d.name}_1_collapsed.png` });
  // 2. open by tapping the tab
  await p.tap('.chat-dock-tab');
  await waitFor(p, () => { const e = document.querySelector('.chat-sheet'); return e && getComputedStyle(e).visibility !== 'hidden' && e.getAnimations().length === 0; });
  await p.evaluate(() => { window.game.sendChat('Oui, j’arrive ! On se retrouve au bar de la plage'); window.__chatSim.receive('m', 'Super 🎉'); window.__chatSim.receive('sim_x', 'Message d’un joueur simulé sans avatar ici'); });
  await p.waitForTimeout(3000); // settle passes (2.4 s) + 400 ms poll
  s = await snap(p);
  ok(s.right && !!s.sheet, `${L} open: right-dock column`, s.sheet);
  const edge = Math.max(4, s.sar);
  ok(!!s.sheet && Math.abs(s.sheet.r - (d.w - edge)) <= 1, `${L} open: flush right (right edge ${s.sheet?.r.toFixed(1)}, expected ${d.w - edge} = vw - max(4, safe-area ${s.sar}))`);
  const w = s.sheet ? s.sheet.r - s.sheet.l : 0; const wantW = Math.min(260, Math.round(d.w * (portrait ? 0.42 : 0.34)));
  ok(Math.abs(w - Math.max(148, wantW)) <= 1, `${L} open: width ${w.toFixed(0)} ≈ min(${portrait ? 42 : 34}vw, 260) = ${Math.max(148, wantW)}`);
  noOverlap(s.sheet, s, `${L} open column`);
  const chipsBottom = Math.max(0, ...s.controls.filter((c) => c.name.startsWith('top-chip') && c.r > (s.sheet?.l ?? 0)).map((c) => c.b));
  const dockTop = Math.min(d.h, ...s.controls.filter((c) => c.name === 'dock' && c.l < (s.sheet?.r ?? 0) && c.r > (s.sheet?.l ?? 0)).map((c) => c.t));
  ok(!!s.sheet && s.sheet.t >= chipsBottom && s.sheet.b <= dockTop, `${L} open: under the top chips (${chipsBottom.toFixed(0)} ≤ ${s.sheet?.t.toFixed(0)}) and above the dock (${s.sheet?.b.toFixed(0)} ≤ ${dockTop.toFixed(0)})`);
  const h = s.sheet ? s.sheet.b - s.sheet.t : 0;
  ok(h >= (portrait ? 0.5 * d.h : 0.5 * d.h) && h > w * (portrait ? 1.6 : 0.9), `${L} open: full-height-ish column (h ${h.toFixed(0)} / vh ${d.h})`);
  ok(s.bubMin >= 13 && s.rows >= 3, `${L} open: messages legible (min bubble font ${s.bubMin}px ≥ 13, ${s.rows} rows), names ${s.nmMin}px`);
  ok(!s.grip && s.sizeBtns === 0, `${L} open: no resize grip / − + (fixed column)`);
  if (portrait) ok(s.joyVisible, `${L} open: joystick stays visible in portrait (column never covers it)`);
  const c0 = await composer(p);
  ok(c0.input.ok && c0.send.ok, `${L} open: composer fully visible / tappable (input ${c0.input.w}px)`, c0);
  await p.screenshot({ path: `${SHOTS}/${d.name}_2_open.png` });
  // 3. no drag: a header drag does not move it
  const hd = await p.evaluate(() => { const r = document.querySelector('.chat-sheet h3').getBoundingClientRect(); return { x: r.left + r.width * 0.55, y: r.top + r.height / 2 }; });
  await p.mouse.move(hd.x, hd.y); await p.mouse.down(); await p.mouse.move(hd.x - 120, hd.y + 80, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(400);
  const s2 = await snap(p);
  ok(JSON.stringify(s2.sheet) === JSON.stringify(s.sheet), `${L} header drag does not move the docked column`, { before: s.sheet, after: s2.sheet });
  // 4. joystick works while the column is open (movement code unchanged)
  if (s.joyVisible || !portrait) {
    const j = s.controls.find((c) => c.name === 'joystick');
    if (j) {
      const cx = (j.l + j.r) / 2, cy = (j.t + j.b) / 2; const p0 = (await snap(p)).pos;
      await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy - 45, { steps: 4 }); await p.waitForTimeout(1200); await p.mouse.up(); await p.waitForTimeout(300);
      const p1 = (await snap(p)).pos; const moved = p0 && p1 ? Math.hypot(p1.x - p0.x, p1.z - p0.z) : 0;
      ok(moved > 0.2, `${L} joystick moves the avatar with the column open (${moved.toFixed(2)} m)`);
      const s3 = await snap(p); noOverlap(s3.sheet, s3, `${L} open column after walking`);
    }
  }
  // 5. keyboard (simulated iOS visual viewport)
  await p.focus('.chat-sheet input');
  await p.evaluate((h) => { Object.defineProperty(window.visualViewport, 'height', { get: () => window.innerHeight - h, configurable: true }); Object.defineProperty(window.visualViewport, 'offsetTop', { get: () => 0, configurable: true }); window.visualViewport.dispatchEvent(new Event('resize')); }, d.kb);
  await waitFor(p, () => document.documentElement.classList.contains('kb-open') && document.querySelector('.chat-sheet')?.dataset.kb === '1');
  await p.waitForTimeout(500);
  await p.keyboard.type('Salut');
  const ck = await composer(p, d.h - d.kb); const sk = await snap(p);
  ok(sk.kb && ck.input.ok && ck.send.ok, `${L} keyboard open: composer fully visible above the keyboard (vv h ${d.h - d.kb})`, ck);
  ok(!!sk.sheet && Math.abs(sk.sheet.r - (d.w - edge)) <= 1 && sk.sheet.b <= d.h - d.kb + 0.5, `${L} keyboard open: column stays right, docked above the keyboard`, sk.sheet);
  ok(sk.bubMin >= 13, `${L} keyboard open: messages still ≥ 13 px (${sk.bubMin})`);
  await p.screenshot({ path: `${SHOTS}/${d.name}_3_keyboard.png` });
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await p.evaluate(() => { document.activeElement?.blur(); Object.defineProperty(window.visualViewport, 'height', { get: () => window.innerHeight, configurable: true }); window.visualViewport.dispatchEvent(new Event('resize')); });
  await p.waitForTimeout(700);
  // closing the keyboard re-applies the panel's 0.2 s fade-in (kb-open turns it off): wait for it (max 8 s, check unchanged)
  await waitFor(p, () => { const e = document.querySelector('.chat-sheet'); return !!e && !document.documentElement.classList.contains('kb-open') && e.getAnimations().length === 0; });
  const sc = await snap(p);
  ok(!sc.kb && JSON.stringify(sc.sheet) === JSON.stringify(s.sheet), `${L} keyboard closed: column back to its spot`, { want: s.sheet, got: sc.sheet });
  // 6. collapse to the tab, reopen
  await p.tap('.chat-sheet .chat-fold'); await p.waitForTimeout(400);
  const sf = await snap(p);
  ok(!sf.sheet && !!sf.tab, `${L} ▸ Chat collapses to the tab`);
  await p.screenshot({ path: `${SHOTS}/${d.name}_4_collapsed_again.png` });
  await ctx.close();
}
// 7. flag OFF (no param): the current floating panel, no right-dock trace
{
  const d = { name: 'flag_off', w: 852, h: 393 };
  const { ctx, p } = await boot(d, 'fresh=1&lieu=appart&q=low&chatSim=1');
  let s = await snap(p);
  ok(!!s.fab && !s.tab, '[flag off] closed: original floating Chat button, no dock tab');
  await p.evaluate(() => window.game.setPanel('chat')); await p.waitForTimeout(1500);
  s = await snap(p);
  const cls = await p.evaluate(() => [document.querySelector('.chat-sheet')?.className, document.documentElement.classList.contains('chat-dock-open'), document.documentElement.dataset.chatLayout ?? null]);
  ok(!s.right && s.grip && s.sizeBtns === 2 && cls[0] === 'sheet chat-sheet chat-glass chat-vertical' && !cls[1] && cls[2] === null, '[flag off] open: original movable panel (grip, − +, same classes)', cls);
  await ctx.close();
}
await b.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 1));
