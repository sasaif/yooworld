#!/usr/bin/env node
/** Vertical chat (feature/chat-vertical): speech bubbles first, history second.
 *  Closed by default + unread badge, bubbles while closed, missed-message divider, composer 100 % visible (history
 *  open + typing) at 852x393 / 667x375 / 1440x900, drag + resize clamped and persisted (ywchatui.*), no overlap with
 *  the top-right HUD, player avatar not covered at the default spot, controls restored after typing, neutral bubble
 *  cap (20 simulated senders, 120-message burst, replay without duplicates), BroadcastChannel same-browser
 *  simulation, Android resizes-content keyboard (layout viewport shrinks), forbidden zones (drag onto every control /
 *  avatar at 667x375, 852x393, 1440x900, 568x320, mid-drag, reload, resize, re-clamp of a forbidden saved rect),
 *  0 extra draws, no idle DOM churn in the panel.
 *  Everything "remote" here is a LOCAL SIMULATION (?chatSim): there is no network transport in the codebase.
 *  usage: node tools/e2e-chat-vertical.mjs [url] ; SHOTS=dir */
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5795'}/`;
const SHOTS = process.env.SHOTS ?? '/workspace/games-3d/yooworld/art/.tmp/e2e-chat-vertical';
fs.mkdirSync(SHOTS, { recursive: true });
const DEVS = [
  { name: 'iphone15', w: 852, h: 393, dpr: 2, touch: true, kb: 190 },
  { name: 'iphoneSE', w: 667, h: 375, dpr: 2, touch: true, kb: 180 },
  { name: 'desktop', w: 1440, h: 900, dpr: 1, touch: false, kb: 280 },
];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
/** CV_ONLY=main,burst,beach,android,drag,bc (comma list) runs only those sections; BEACH_RUNS=n repeats the beach check. */
const ONLY = (process.env.CV_ONLY ?? '').split(',').filter(Boolean); const want = (k) => !ONLY.length || ONLY.includes(k);
const BEACH_RUNS = Math.max(1, Number(process.env.BEACH_RUNS ?? 3));
const results = [];
const ok = (c, m, extra) => { results.push({ ok: !!c, m, extra }); console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined && !c ? ' ' + JSON.stringify(extra) : '')); if (!c) process.exitCode = 1; };
const ov = (a, c) => !!a && !!c && Math.min(a.r, c.r) - Math.max(a.l, c.l) > 0.5 && Math.min(a.b, c.b) - Math.max(a.t, c.t) > 0.5;

async function boot(d, query = 'fresh=1&lieu=appart&q=low&chatSim=1', ctxIn) {
  const ctx = ctxIn ?? await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: d.touch, hasTouch: d.touch });
  if (!ctxIn) await ctx.addInitScript(() => { try { sessionStorage.setItem('yw:e:dev:portrait', '1'); localStorage.setItem('yw:e:dev:camView', 'room'); } catch {} });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${url}${url.includes('?') ? '&' : '?'}${query}`, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && window.__metrics && window.__chatSim, null, { timeout: 180000 });
  await p.waitForTimeout(2500);
  await p.keyboard.press('F9');
  await p.evaluate(() => { const c = window.__world.chars; for (const k in c) c[k].say = undefined; window.game.bubbles.reset(); });
  return { ctx, p };
}
const R = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); if (r.width < 1 || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return null; return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const state = (p) => p.evaluate(() => {
  const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0 && e.getBoundingClientRect().width > 0; };
  const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const hud = [...document.querySelectorAll('.hud-top > *')].filter((e) => { const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && +cs.opacity > 0 && e.getBoundingClientRect().width > 0; }).map(rect);
  const m = window.__metrics?.(); const bb = m?.[window.game.s.activeChar]?.bboxPx;
  const bubbles = [...document.querySelectorAll('.tagwrap[data-char]')].map((w) => { const e = w.querySelector('.bubble'); return { id: w.dataset.char, on: e.style.opacity === '1', text: e.textContent, r: rect(e) }; }).filter((x) => x.on);
  const sheet = document.querySelector('.chat-sheet');
  return {
    open: !!sheet, sheet: sheet ? rect(sheet) : null, hud, avatar: bb ? { l: bb[0], t: bb[1], r: bb[2], b: bb[3] } : null, bubbles,
    unread: +(document.querySelector('.chat-preview .chat-unread')?.textContent || 0), fab: vis('.chat-preview'),
    vis: { joy: vis('.joy'), run: vis('.run-btn'), dock: vis('.dock'), mood: vis('.mood-wrap') },
    missed: document.querySelector('.chat-missed')?.textContent || '', rows: document.querySelectorAll('.chatlog .chat-row').length,
    kb: document.documentElement.classList.contains('kb-open'), calls: window.__info?.calls ?? null,
    mode: sheet?.querySelector('.chat-mode')?.textContent || '',
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
    return { ok: inVp && inSheet && hits.every(Boolean), inVp, inSheet, hits, h: +r.height.toFixed(1) };
  };
  return { input: one(document.querySelector('.chat-sheet .chatbar input')), send: one(document.querySelector('.chat-sheet .chatbar .btn')) };
}, vvH);
const fullyVisible = (c) => c.input.ok && c.send.ok;
const kbOpen = async (p, h) => {
  await p.focus('.chat-sheet input');
  await p.evaluate((h) => { Object.defineProperty(window.visualViewport, 'height', { get: () => window.innerHeight - h, configurable: true }); Object.defineProperty(window.visualViewport, 'offsetTop', { get: () => 0, configurable: true }); window.visualViewport.dispatchEvent(new Event('resize')); }, h);
  await p.waitForFunction(() => document.documentElement.classList.contains('kb-open') && document.querySelector('.chat-sheet')?.dataset.kb === '1', null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(500);
};
const kbClose = async (p) => {
  await p.evaluate(() => { document.activeElement?.blur(); delete window.visualViewport.height; Object.defineProperty(window.visualViewport, 'height', { get: () => window.innerHeight, configurable: true }); window.visualViewport.dispatchEvent(new Event('resize')); });
  await p.waitForTimeout(600);
};
const drag = async (p, sel, dx, dy, from = 'center') => {
  const r = await R(p, sel); if (!r) return false;
  const x = from === 'corner' ? r.l + 8 : r.l + r.w / 2, y = from === 'corner' ? r.t + 8 : r.t + r.h / 2;
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await p.mouse.move(x + dx, y + dy, { steps: 4 }); await p.mouse.up();
  await p.waitForTimeout(250); return true;
};
const openPanel = async (p) => {
  await p.evaluate(() => { if (window.game.s.panel !== 'chat') window.game.setPanel('chat'); });
  await p.waitForFunction(() => { const e = document.querySelector('.chat-sheet'); return e && getComputedStyle(e).visibility !== 'hidden' && e.getAnimations().length === 0; }, null, { timeout: 30000 });
  await p.waitForTimeout(300);
};
const inside = (r, d) => !!r && r.l >= -0.5 && r.t >= -0.5 && r.r <= d.w + 0.5 && r.b <= d.h + 0.5;

const draws = {};
for (const d of want('main') ? DEVS : []) {
  const { ctx, p } = await boot(d);
  // ---- 1. closed by default, compact Chat button, bubbles while closed, unread ----
  let s = await state(p);
  ok(!s.open && s.fab, `${d.name}: chat panel closed by default, compact Chat button shown`, s);
  const fab = await R(p, '.chat-preview');
  ok(fab && fab.w <= 110 && fab.h <= 40, `${d.name}: Chat button is compact (${fab && Math.round(fab.w)}x${fab && Math.round(fab.h)} px)`, fab);
  await p.evaluate(() => { window.__chatSim.receive('m', 'Coucou ! Tu viens à la plage ?'); });
  await p.waitForTimeout(900);
  s = await state(p);
  draws[d.name] = { closed: s.calls };
  ok(s.bubbles.some((x) => x.id === 'm' && /plage/.test(x.text)), `${d.name}: panel closed -> bubble shown above the sender (Juan)`, s.bubbles);
  ok(s.unread === 1, `${d.name}: unread badge = 1 while closed`, s.unread);
  await p.evaluate(() => { window.game.sendChat('Oui, j’arrive !'); window.__chatSim.receive('m', 'Super 🎉'); window.__chatSim.receive('sim_x', 'Message d’un joueur simulé sans avatar ici'); });
  await p.waitForTimeout(1500);
  s = await state(p);
  ok(s.unread === 3, `${d.name}: unread counts received messages (own excluded), incl. history-only ones`, s.unread);
  ok(s.bubbles.some((x) => x.id === 'f') && s.bubbles.some((x) => x.id === 'm'), `${d.name}: own + Juan bubbles both visible`, s.bubbles.map((x) => x.id));
  if (s.bubbles.length >= 2) { const [a, c] = s.bubbles; ok(!ov(a.r, c.r), `${d.name}: the two bubbles do not overlap`, s.bubbles.map((x) => x.r)); }
  ok(s.bubbles.every((x) => !s.hud.some((h) => ov(h, x.r))), `${d.name}: bubbles do not sit under the top HUD`, { bubbles: s.bubbles.map((x) => x.r), hud: s.hud });
  await p.screenshot({ path: `${SHOTS}/${d.name}_1_closed.png` });

  // ---- 2. open: vertical history with missed messages, composer 100 % ----
  await openPanel(p);
  s = await state(p);
  ok(s.open && s.unread === 0, `${d.name}: opening shows the panel and clears the badge`);
  ok(/3 messages manqués/.test(s.missed) && s.rows === 4, `${d.name}: history shows the missed messages divider (${s.missed}) + all ${s.rows} rows`, s);
  ok(/Mode local · simulation/.test(s.mode), `${d.name}: header says it is a local simulation (not multiplayer)`, s.mode);
  const w = s.sheet.r - s.sheet.l, h = s.sheet.b - s.sheet.t, area = +(100 * w * h / (d.w * d.h)).toFixed(1);
  if (d.h < 500) ok(w >= 228 && w <= 264 && h > w && area <= 22, `${d.name}: vertical panel ${Math.round(w)}x${Math.round(h)} px, ${area} % of the screen`, { w, h, area });
  else ok(w >= 280 && w <= 320 && h > w, `${d.name}: vertical panel ${Math.round(w)}x${Math.round(h)} px`, { w, h });
  ok(!s.hud.some((x) => ov(x, s.sheet)), `${d.name}: default panel does not overlap the top HUD`, { sheet: s.sheet, hud: s.hud });
  ok(!ov(s.avatar, s.sheet), `${d.name}: default panel does not cover the player's avatar`, { sheet: s.sheet, avatar: s.avatar });
  ok(!['joy', 'run', 'dock', 'mood'].some((k) => s.vis[k] && false), `${d.name}: controls still present with history open`, s.vis);
  const c1 = await composer(p); ok(fullyVisible(c1), `${d.name}: history open -> input + Envoyer 100 % visible`, c1);
  draws[d.name].open = s.calls;
  await p.screenshot({ path: `${SHOTS}/${d.name}_2_open.png` });

  // ---- 3. idle: no DOM churn inside the panel (no per-frame React re-render) ----
  const churn = await p.evaluate(() => new Promise((res) => { const el = document.querySelector('.chat-sheet'); let n = 0; const mo = new MutationObserver((l) => { n += l.length; }); mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true }); setTimeout(() => { mo.disconnect(); res(n); }, 2000); }));
  ok(churn === 0, `${d.name}: 2 s idle with the panel open -> ${churn} DOM mutations in the panel`, churn);

  // ---- 4. drag + resize, clamped, persisted ----
  const before = s.sheet;
  await drag(p, '.chat-sheet .chat-mode', -260, 60);
  s = await state(p);
  ok(s.sheet && Math.abs(s.sheet.l - (before.l - 260)) < 3, `${d.name}: header drag moves the panel`, { before, after: s.sheet });
  await drag(p, '.chat-sheet .chat-mode', -5000, 5000);
  s = await state(p);
  ok(inside(s.sheet, d), `${d.name}: drag far off-screen is clamped (panel fully on screen)`, s.sheet);
  ok(fullyVisible(await composer(p)), `${d.name}: after drag -> input + Envoyer 100 % visible`);
  await p.dblclick('.chat-sheet .chat-mode'); await p.waitForTimeout(300); // back to the default spot (room to grow)
  const r0 = await R(p, '.chat-sheet');
  await drag(p, '.chat-grip', -70, -50, 'corner');
  const r1 = await R(p, '.chat-sheet');
  ok(r1 && r1.w > r0.w + 30 && r1.h > r0.h + 20 && inside(r1, d), `${d.name}: resize grip enlarges (${Math.round(r0.w)}x${Math.round(r0.h)} -> ${Math.round(r1.w)}x${Math.round(r1.h)})`, { r0, r1 });
  await drag(p, '.chat-grip', 900, 900, 'corner');
  const r2 = await R(p, '.chat-sheet');
  ok(r2 && r2.w >= 207 && r2.h >= 167 && inside(r2, d), `${d.name}: resize to the minimum is clamped (${Math.round(r2.w)}x${Math.round(r2.h)})`, r2);
  ok(fullyVisible(await composer(p)), `${d.name}: smallest panel -> input + Envoyer 100 % visible`);
  await p.click('.chat-sheet .chat-size[aria-label="Agrandir le chat"]'); await p.waitForTimeout(200);
  const r3 = await R(p, '.chat-sheet');
  ok(r3 && r3.w > r2.w && inside(r3, d), `${d.name}: + button enlarges one step`, { r2, r3 });
  await drag(p, '.chat-sheet .chat-mode', -5000, -5000);
  const r4 = await R(p, '.chat-sheet'); ok(inside(r4, d), `${d.name}: drag to the top-left corner is clamped`, r4);
  await p.screenshot({ path: `${SHOTS}/${d.name}_4_moved_resized.png` });
  const key = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ywchatui.')));
  ok(key.length === 1 && key[0] === 'ywchatui.dev.panel', `${d.name}: position + size persisted only under ${key.join(',')}`, key);
  const saveKeys = await p.evaluate(() => Object.keys(localStorage).filter((k) => /panel/i.test(k) && !k.startsWith('ywchatui.')));
  ok(saveKeys.length === 0, `${d.name}: nothing written under the yooworld:/yw. save keys for the panel`, saveKeys);
  // reload -> same rect
  await p.reload(); await p.waitForFunction(() => window.game?.s.ready && window.__metrics, null, { timeout: 180000 }); await p.waitForTimeout(1500);
  await openPanel(p);
  const r5 = await R(p, '.chat-sheet');
  ok(r5 && Math.abs(r5.l - r4.l) < 2 && Math.abs(r5.t - r4.t) < 2 && Math.abs(r5.w - r4.w) < 2 && Math.abs(r5.h - r4.h) < 2, `${d.name}: reload restores the moved / resized panel`, { r4, r5 });
  // double-click header -> default position again
  await p.dblclick('.chat-sheet .chat-mode'); await p.waitForTimeout(300);
  s = await state(p);
  ok(!s.hud.some((x) => ov(x, s.sheet)) && !ov(s.avatar, s.sheet), `${d.name}: double-click header resets to the default spot`, s.sheet);

  // ---- 5. keyboard ----
  await p.evaluate(() => window.game.sendChat('Je tape un message…')); await p.waitForTimeout(200);
  await kbOpen(p, d.kb);
  s = await state(p);
  const ck = await composer(p, d.h - d.kb);
  ok(s.kb && fullyVisible(ck), `${d.name}: keyboard open -> input + Envoyer 100 % visible above the keyboard`, ck);
  ok(!s.hud.some((x) => ov(x, s.sheet)), `${d.name}: keyboard open -> no overlap with the top-right HUD`, { sheet: s.sheet, hud: s.hud });
  ok(!s.vis.joy && !s.vis.dock && !s.vis.run && !s.fab, `${d.name}: keyboard open -> joystick / Run / dock hidden`, s.vis);
  ok(!ov(s.avatar, s.sheet), `${d.name}: keyboard open -> player avatar not covered`, { avatar: s.avatar, sheet: s.sheet });
  const stage = await p.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(); return { w: c.width, h: c.height }; });
  ok(Math.abs(stage.h - d.h) < 2, `${d.name}: keyboard open -> the 3D stage is not resized (${stage.h} px)`, stage);
  await p.screenshot({ path: `${SHOTS}/${d.name}_5_keyboard.png` });
  await kbClose(p);
  await p.evaluate(() => window.game.setPanel(null)); await p.waitForTimeout(500);
  s = await state(p);
  const expect = d.touch ? ['joy', 'run', 'dock'] : ['dock'];
  ok(!s.open && !s.kb && expect.every((k) => s.vis[k]) && s.fab, `${d.name}: panel closed again -> ${expect.join(' / ')} + Chat button restored`, s.vis);
  // reception continues while closed
  await p.evaluate(() => window.__chatSim.receive('m', 'Toujours là ?')); await p.waitForTimeout(400);
  s = await state(p);
  ok(s.unread === 1 && s.bubbles.some((x) => x.id === 'm'), `${d.name}: closed again -> still receives (badge ${s.unread}) and shows the bubble`, s);
  await p.screenshot({ path: `${SHOTS}/${d.name}_7_closed_again.png` });
  await ctx.close();
}

// ---- 6. neutral cap: 20 simulated senders, 120-message burst, replay (reconnect) ----
if (want('burst')) {
  const d = DEVS[0];
  const { ctx, p } = await boot(d, 'fresh=1&lieu=appart&q=low&chatSim=1');
  const pre = await p.evaluate(() => window.__info?.calls);
  const r = await p.evaluate(async () => {
    const sim = window.__chatSim; sim.players(20);
    const out = { maxVisible: 0, maxDom: 0 };
    const sample = () => { const s = sim.stats(); out.maxVisible = Math.max(out.maxVisible, s.visible.length); out.maxDom = Math.max(out.maxDom, document.querySelectorAll('.tagwrap .bubble.on').length); };
    for (let i = 0; i < 120; i++) { sim.receive(`sim_${(i % 20) + 1}`, `burst ${i + 1}`); if (i % 10 === 0) sample(); }
    sim.receive('m', 'Juan dans la foule'); window.game.sendChat('Moi aussi !');
    await new Promise((r) => setTimeout(r, 500)); sample();
    const after = sim.stats(); sim.replay(40); await new Promise((r) => setTimeout(r, 200));
    const replay = sim.stats();
    return { ...out, after, replay, cap: after.cap, mine: window.__world.chars.f.say?.text ?? null };
  });
  ok(r.maxVisible <= r.cap && r.maxDom <= r.cap, `burst: 20 senders x 120 msgs -> at most ${r.cap} bubbles visible (max ${r.maxVisible}, DOM ${r.maxDom})`, r);
  ok(r.after.history === 122 && r.after.ids === 122, `burst: every message kept in history (${r.after.history}/122)`, r.after);
  ok(r.mine === 'Moi aussi !', 'burst: own message always shows', r.mine);
  ok(r.replay.history === 122 && r.replay.ids === 122, 'reconnect replay (40 same ids) -> 0 duplicates', r.replay);
  await openPanel(p);
  const rows = await p.evaluate(() => document.querySelectorAll('.chatlog .chat-row').length);
  ok(rows === 122, `burst: the history panel lists all ${rows} messages`, rows);
  const post = await p.evaluate(() => window.__info?.calls);
  ok(pre === post, `burst + panel open: 0 extra 3D draws (${pre} -> ${post})`, { pre, post });
  draws.burst = { pre, post };
  await ctx.close();
}
// ---- 7. several speakers at the beach (Juanita, Juan, 2 PNJ): no overlap, cap ?bubbles=2 keeps the rest in history ----
const beachStats = [];
for (let run = 0; run < (want('beach') ? BEACH_RUNS : 0); run++) {
  const d = DEVS[0];
  for (const cap of [6, 2]) {
    const { ctx, p } = await boot(d, `fresh=1&lieu=plage&q=low&chatSim=1${cap === 2 ? '&bubbles=2' : ''}`);
    const ids = await p.evaluate(() => Object.keys(window.__world.chars));
    await p.evaluate((ids) => { window.game.sendChat('On joue au volley ?'); for (const id of ids) if (id !== window.game.s.activeChar) window.__chatSim.receive(id, id.startsWith('npc') ? 'Trop beau le coucher de soleil' : 'Je ramène les jus !'); }, ids);
    await p.waitForTimeout(1800); // let the 8 Hz layer settle (pop-in / slide transitions)
    const s = await state(p);
    const n = Math.min(cap, ids.length);
    ok(s.bubbles.length === n, `beach cap ${cap}: ${s.bubbles.length} bubbles for ${ids.length} speakers`, s.bubbles.map((x) => x.id));
    // the beach PNJ keep walking, so a bubble can brush a neighbour for one 8 Hz re-layout (moves are instant, no slide); sample
    // 14 times over ~2 s: settled = no pair overlapping in 3 consecutive samples (~0.4 s), and report the worst moment
    const ovs = [];
    for (let k = 0; k < 14; k++) {
      const bs = (await state(p)).bubbles; const pairs = [];
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (ov(bs[i].r, bs[j].r)) pairs.push(`${bs[i].id}|${bs[j].id}:${Math.round(Math.min(bs[i].r.r, bs[j].r.r) - Math.max(bs[i].r.l, bs[j].r.l))}x${Math.round(Math.min(bs[i].r.b, bs[j].r.b) - Math.max(bs[i].r.t, bs[j].r.t))}`);
      ovs.push(pairs); await p.waitForTimeout(110);
    }
    let lasting = null; for (let k = 2; k < ovs.length && !lasting; k++) for (const pr of ovs[k]) { const key = pr.split(':')[0]; if (ovs[k - 1].some((x) => x.startsWith(key + ':')) && ovs[k - 2].some((x) => x.startsWith(key + ':'))) { lasting = pr; break; } }
    const transient = ovs.filter((x) => x.length).length;
    ok(!lasting, `beach cap ${cap} (run ${run + 1}): visible bubbles do not overlap (settled; transient brushes in ${transient}/14 samples)`, { lasting, ovs });
    beachStats.push({ cap, run, transient, lasting });
    const st = await p.evaluate(() => window.__chatSim.stats());
    ok(st.history === ids.length, `beach cap ${cap}: all ${ids.length} messages in history (${st.queued.length} waiting for a slot)`, st);
    await p.screenshot({ path: `${SHOTS}/beach_cap${cap}.png` });
    await ctx.close();
  }
}
// ---- 9. Android "resizes-content" keyboard: the LAYOUT viewport shrinks (innerHeight drops, visualViewport.height ≈
//         innerHeight, so keyboardInset() alone sees no keyboard). Emulated with page.setViewportSize while focused. ----
for (const [d, small] of want('android') ? [[DEVS[0], 200], [DEVS[1], 190]] : []) {
  const { ctx, p } = await boot(d);
  await p.evaluate(() => { window.game.sendChat('Salut ! 👋'); window.__chatSim.receive('m', 'Coucou, ça va ?'); window.game.setPanel('chat'); });
  await p.waitForFunction(() => { const e = document.querySelector('.chat-sheet'); return e && getComputedStyle(e).visibility !== 'hidden'; }, null, { timeout: 15000 });
  await p.waitForTimeout(500);
  await p.focus('.chat-sheet input');
  await p.waitForTimeout(300);
  await p.setViewportSize({ width: d.w, height: small });
  await p.waitForTimeout(900);
  const c = await composer(p);
  const m = await p.evaluate(() => { const x = document.querySelector('.chat-sheet .x')?.getBoundingClientRect(); const s = document.querySelector('.chat-sheet')?.getBoundingClientRect();
    return { ih: innerHeight, vvh: Math.round(window.visualViewport.height), x: x && { t: x.top, b: x.bottom, l: x.left, r: x.right }, sheet: s && { t: s.top, b: s.bottom }, focus: document.activeElement?.tagName, kb: document.documentElement.classList.contains('kb-open') }; });
  if (process.env.ANDROID_SHOT) await p.screenshot({ path: process.env.ANDROID_SHOT.replace('%s', d.name) });
  await p.screenshot({ path: `${SHOTS}/${d.name}_android_resize.png` });
  ok(fullyVisible(c), `${d.name}: Android resizes-content ${d.h}→${small} px, input focused: input + Envoyer 100 % visible`, { c, m });
  const xIn = !!m.x && m.x.t >= -0.5 && m.x.b <= m.ih + 0.5 && m.x.l >= -0.5 && m.x.r <= d.w + 0.5;
  ok(xIn && m.focus === 'INPUT', `${d.name}: Android resizes-content: header ✕ visible, focus kept`, m);
  const sk = await state(p);
  ok(sk.kb && !sk.vis.joy && !sk.vis.dock && !sk.vis.run && !ov(sk.sheet, { l: 0, t: m.ih, r: d.w, b: m.ih + 999 }), `${d.name}: Android resizes-content detected as keyboard (kb-open): joystick / Run / dock hidden, card inside ${small} px`, { kb: sk.kb, vis: sk.vis, sheet: sk.sheet });
  // keyboard closes: full height back, panel back to its normal spot, controls restored
  await p.evaluate(() => document.activeElement?.blur());
  await p.setViewportSize({ width: d.w, height: d.h });
  await p.waitForTimeout(900);
  const st = await state(p); const c2 = await composer(p);
  ok(!st.kb && fullyVisible(c2) && st.vis.joy && st.vis.dock, `${d.name}: Android keyboard closed → full height, composer visible, joystick + dock back`, { kb: st.kb, vis: st.vis, c2 });
  await ctx.close();
}
// ---- 10. forbidden zones (BUG-V1 / V2 / V4): try to drag the panel onto every control (joystick, Run/Walk, dock, Mood,
//          top HUD chips, player avatar) with REAL touch events (CDP) on phones, the mouse on desktop; after each drag,
//          mid-drag, after a reload and after resizes, elementFromPoint at each control's centre must return the control. ----
const DRAG_DEVS = [DEVS[1], DEVS[0], DEVS[2], { name: 'small568', w: 568, h: 320, dpr: 2, touch: true }];
const QA_SHOTS = process.env.QA_SHOTS; // optional: before/after shots for the QA board
if (QA_SHOTS) fs.mkdirSync(QA_SHOTS, { recursive: true });
const controlsAt = (p) => p.evaluate(() => {
  const vis = (e) => { if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return null; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 ? r : null; };
  const out = [];
  for (const [name, sel] of [['joystick', '.joy'], ['run', '.run-btn'], ['dock', '.dock'], ['mood', '.mood-wrap']]) { const e = document.querySelector(sel); const r = vis(e); if (r) out.push({ name, sel, c: [r.left + r.width / 2, r.top + r.height / 2], r: [r.left, r.top, r.right, r.bottom] }); }
  document.querySelectorAll('.hud-top > *').forEach((e, i) => { const r = vis(e); if (r) out.push({ name: 'hud' + i + ':' + (e.textContent || '').trim().slice(0, 12), sel: null, idx: i, c: [r.left + r.width / 2, r.top + r.height / 2], r: [r.left, r.top, r.right, r.bottom] }); });
  const bb = window.__metrics?.()?.[window.game.s.activeChar]?.bboxPx; if (bb) out.push({ name: 'avatar', sel: 'canvas', c: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], r: bb });
  return out; });
const coveredControls = (p) => p.evaluate(() => {
  const sheet = document.querySelector('.chat-sheet'); if (!sheet) return { open: false, covered: [] };
  const s = sheet.getBoundingClientRect(); const covered = [];
  const check = (name, el, r) => { const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2; const hit = document.elementFromPoint(cx, cy); if (hit && sheet.contains(hit)) covered.push(name); else if (el && hit && !(el === hit || el.contains(hit)) && name !== 'avatar') covered.push(name + '(other:' + (hit.className?.baseVal ?? hit.className) + ')'); };
  const vis = (e) => { if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return null; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 ? r : null; };
  for (const [name, sel] of [['joystick', '.joy'], ['run', '.run-btn'], ['dock', '.dock'], ['mood', '.mood-wrap']]) { const e = document.querySelector(sel); const r = vis(e); if (r) check(name, e, r); }
  document.querySelectorAll('.hud-top > *').forEach((e, i) => { const r = vis(e); if (r) check('hud' + i, e, r); });
  const bb = window.__metrics?.()?.[window.game.s.activeChar]?.bboxPx; if (bb) { const r = { left: bb[0], top: bb[1], right: bb[2], bottom: bb[3] }; const ix = Math.min(s.right, r.right) - Math.max(s.left, r.left), iy = Math.min(s.bottom, r.bottom) - Math.max(s.top, r.top); if (ix > 2 && iy > 2) covered.push(`avatar ${Math.round(ix)}x${Math.round(iy)}`); }
  const onScreen = s.left >= -0.5 && s.top >= -0.5 && s.right <= innerWidth + 0.5 && s.bottom <= innerHeight + 0.5;
  return { open: true, covered, rect: [s.left, s.top, s.width, s.height].map(Math.round), onScreen }; });
const openChat = async (p) => {
  await p.evaluate(() => { if (window.game.s.panel !== 'chat') window.game.setPanel('chat'); });
  await p.waitForFunction(() => { const e = document.querySelector('.chat-sheet'); return e && getComputedStyle(e).visibility !== 'hidden' && e.getAnimations().length === 0; }, null, { timeout: 30000 });
  await p.waitForTimeout(500);
};
/** drag the header from a point (the '▾ Chat' fold button: BUG-V4 makes it a handle) so that the panel centre lands on (tx, ty) */
async function dragPanelTo(p, cdp, touch, tx, ty, { probeMid = false } = {}) {
  const h = await p.evaluate(() => { const s = document.querySelector('.chat-sheet').getBoundingClientRect(); const m = document.querySelector('.chat-sheet h3.chat-drag .chat-mode').getBoundingClientRect(); return { sx: s.left + s.width / 2, sy: s.top + s.height / 2, hx: m.left + m.width / 2, hy: m.top + m.height / 2 }; });
  const fx = h.hx, fy = h.hy, ex = fx + (tx - h.sx), ey = fy + (ty - h.sy); let mid = null;
  if (touch) {
    const T = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }] });
    await T('touchStart', fx, fy);
    for (let i = 1; i <= 14; i++) { await T('touchMove', fx + (ex - fx) * i / 14, fy + (ey - fy) * i / 14); await p.waitForTimeout(16); }
    if (probeMid) { await p.waitForTimeout(150); mid = await coveredControls(p); }
    await T('touchEnd');
  } else {
    await p.mouse.move(fx, fy); await p.mouse.down(); await p.mouse.move(ex, ey, { steps: 14 });
    if (probeMid) { await p.waitForTimeout(150); mid = await coveredControls(p); }
    await p.mouse.up();
  }
  await p.waitForTimeout(500);
  return mid;
}
if (want('drag')) for (const d of DRAG_DEVS) {
  const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: d.touch, hasTouch: d.touch });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('yw:e:dev:portrait', '1'); localStorage.setItem('yw:e:dev:camView', 'room'); } catch {} });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  await p.goto(`${url}${url.includes('?') ? '&' : '?'}fresh=1&lieu=appart&q=low&chatSim=1`, { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && window.__metrics && window.__chatSim, null, { timeout: 180000 });
  await p.waitForTimeout(2500);
  if (await p.evaluate(() => !!document.querySelector('.perf-hud'))) await p.keyboard.press('F9');
  await openChat(p);
  // BUG-V4: the drag handle is the whole header bar (≥ 44 px high), ▾ Chat tap still closes, − still shrinks
  const hd = await p.evaluate(() => { const h = document.querySelector('.chat-sheet h3.chat-drag').getBoundingClientRect(); const x = document.querySelector('.chat-sheet h3 .x').getBoundingClientRect(); return { w: h.width, h: h.height, handle: h.width - x.width }; });
  ok(hd.h >= 44 && hd.handle >= 150, `${d.name}: drag handle = header bar ${Math.round(hd.handle)} x ${Math.round(hd.h)} px (≥ 44 px high, only ✕ excluded)`, hd);
  const targets = await controlsAt(p);
  let worst = [], midBad = [];
  for (const t of targets) {
    const mid = await dragPanelTo(p, cdp, d.touch, t.c[0], t.c[1], { probeMid: true });
    const r = await coveredControls(p);
    if (mid && mid.covered.length) midBad.push(`${t.name}: ${mid.covered.join(',')}`);
    if (r.covered.length || !r.onScreen) worst.push(`${t.name} -> ${r.covered.join(',') || 'off-screen'} @${r.rect}`);
    if (QA_SHOTS && ['joystick', 'dock'].includes(t.name)) await p.screenshot({ path: `${QA_SHOTS}/${d.name}_drag_onto_${t.name}.png` });
  }
  ok(targets.length >= 5 && worst.length === 0, `${d.name}: panel dragged onto each of ${targets.length} controls (${targets.map((t) => t.name.split(':')[0]).join(', ')}) -> covers none after release`, worst);
  ok(midBad.length === 0, `${d.name}: … and none during the drag (clamped / snapped live)`, midBad);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('ywchatui.'))) || 'null'));
  // the saved rect, re-applied at this size, must also be clear: reload
  await p.reload(); await p.waitForFunction(() => window.game?.s.ready && window.__metrics && window.__chatSim, null, { timeout: 180000 }); await p.waitForTimeout(2500);
  if (await p.evaluate(() => !!document.querySelector('.perf-hud'))) await p.keyboard.press('F9');
  await openChat(p);
  let r = await coveredControls(p);
  ok(!!saved && r.open && r.covered.length === 0 && r.onScreen, `${d.name}: reload with the saved position (${saved && [saved.dr, saved.top, saved.w, saved.h]}) -> covers none`, r);
  // resizes / rotation-like changes to small viewports, then back
  for (const [w, h] of [[568, 320], [667, 375], [d.w, d.h]]) {
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(1300);
    r = await coveredControls(p);
    ok(r.open && r.covered.length === 0 && r.onScreen, `${d.name}: resized to ${w}x${h} with the panel open -> covers none, fully on screen`, r);
  }
  // BUG-V2: a forbidden position saved by an older build (bottom-left over the joystick, max size) is re-clamped at load
  await p.evaluate((d) => { const k = Object.keys(localStorage).find((k) => k.startsWith('ywchatui.')) || 'ywchatui.dev.panel'; localStorage.setItem(k, JSON.stringify({ dr: d.w - 6 - 300, top: d.h - 6 - 250, w: 300, h: 250 })); }, d);
  for (const [w, h] of [[d.w, d.h], [568, 320]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.reload(); await p.waitForFunction(() => window.game?.s.ready && window.__metrics && window.__chatSim, null, { timeout: 180000 }); await p.waitForTimeout(2500);
    if (await p.evaluate(() => !!document.querySelector('.perf-hud'))) await p.keyboard.press('F9');
    await openChat(p); r = await coveredControls(p);
    if (QA_SHOTS && w === 568) await p.screenshot({ path: `${QA_SHOTS}/${d.name}_reload_568_forbidden_saved.png` });
    ok(r.open && r.covered.length === 0 && r.onScreen, `${d.name}: forbidden saved position, reload at ${w}x${h} -> re-clamped, covers none`, r);
  }
  // taps on the header buttons still work (a tap is not a drag)
  await p.setViewportSize({ width: d.w, height: d.h }); await p.waitForTimeout(800);
  // BUG-V4: a drag that starts on the '▾ Chat' button moves the panel (towards the screen centre) and does not close it
  {
    const r0 = await p.evaluate(() => { const s = document.querySelector('.chat-sheet').getBoundingClientRect(); const f = document.querySelector('.chat-sheet h3 .chat-fold').getBoundingClientRect(); return { x: s.left, y: s.top, cx: s.left + s.width / 2, cy: s.top + s.height / 2, fx: f.left + f.width / 2, fy: f.top + f.height / 2 }; });
    const vx = Math.sign(d.w / 2 - r0.cx) * 7, vy = Math.sign(d.h / 2 - r0.cy) * 2; let dragging = false;
    if (d.touch) { const T = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }] }); await T('touchStart', r0.fx, r0.fy); for (let i = 1; i <= 10; i++) { await T('touchMove', r0.fx + vx * i, r0.fy + vy * i); await p.waitForTimeout(16); } dragging = await p.evaluate(() => !!document.querySelector('.chat-sheet.dragging')); await T('touchEnd'); }
    else { await p.mouse.move(r0.fx, r0.fy); await p.mouse.down(); await p.mouse.move(r0.fx + vx * 10, r0.fy + vy * 10, { steps: 10 }); dragging = await p.evaluate(() => !!document.querySelector('.chat-sheet.dragging')); await p.mouse.up(); }
    await p.waitForTimeout(500);
    const r1 = await p.evaluate(() => { const s = document.querySelector('.chat-sheet')?.getBoundingClientRect(); return s ? { x: s.left, y: s.top } : null; });
    ok(dragging && !!r1, `${d.name}: drag started on '▾ Chat' is a drag (moved ${r1 ? Math.round(r1.x - r0.x) + ',' + Math.round(r1.y - r0.y) : 'closed!'} px) and keeps the panel open`, { r0, r1, dragging });
  }
  const before = await p.evaluate(() => document.querySelector('.chat-sheet').getBoundingClientRect().width);
  if (d.touch) await p.tap('.chat-sheet h3 .chat-size'); else await p.click('.chat-sheet h3 .chat-size');
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => document.querySelector('.chat-sheet')?.getBoundingClientRect().width ?? null);
  if (d.touch) await p.tap('.chat-sheet h3 .chat-fold'); else await p.click('.chat-sheet h3 .chat-fold');
  await p.waitForTimeout(400);
  const closed = await p.evaluate(() => !document.querySelector('.chat-sheet'));
  ok(after !== null && after <= before && closed, `${d.name}: tap on − still shrinks (${Math.round(before)} -> ${after && Math.round(after)} px), tap on ▾ Chat still closes`, { before, after, closed });
  await ctx.close();
}
// ---- 8. BroadcastChannel: 2 tabs of the same browser (same-browser simulation, NOT network multiplayer) ----
if (want('bc')) {
  const d = DEVS[0];
  const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const A = await boot(d, 'fresh=1&lieu=appart&q=low&chatSim=bc', ctx);
  const B = await boot(d, 'fresh=1&lieu=appart&q=low&chatSim=bc', ctx);
  await A.p.evaluate(() => { window.game.sendChat('Bonjour depuis l’onglet A'); window.game.sendChat('Deuxième message A'); });
  await B.p.waitForTimeout(500);
  const rb = await B.p.evaluate(() => ({ h: window.game.chat.history().map((m) => [m.from, m.text, m.local]), unread: +(document.querySelector('.chat-preview .chat-unread')?.textContent || 0), net: window.game.net.status, label: window.__chatSim.label }));
  ok(rb.h.length === 2 && rb.h.every(([f, , l]) => /^tab-/.test(f) && l === false) && rb.h[0][1] === 'Bonjour depuis l’onglet A', 'BroadcastChannel sim: tab B receives tab A messages in order, as another sender', rb);
  ok(rb.unread === 2 && rb.net === 'offline', 'BroadcastChannel sim: B panel closed -> unread 2; status stays offline (simulation)', rb);
  await ctx.close();
}
for (const [k, v] of Object.entries(draws)) if (v.closed != null) ok(v.closed === v.open, `${k}: draws closed ${v.closed} -> open ${v.open} (0 extra)`, v);
const pass = results.filter((r) => r.ok).length;
console.log(`== e2e-chat-vertical: ${pass}/${results.length} passed ==`);
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify({ pass, total: results.length, results, draws }, null, 2));
await b.close();
