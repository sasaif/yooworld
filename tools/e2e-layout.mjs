import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
/**
 * Bottom HUD layout on phones: the dock must never cover the joystick or the 🏃 Run button, stay inside the screen and
 * leave room for YW Art & Avatars' Mood button (feature/avatar-face, src/ui/mood/mood.css: landscape ≤ 740 px it sits just
 * right of the dock, wider screens it is one more dock button). The Mood button is emulated here with the same markup
 * (.dock > .mood-wrap > button) and the same CSS rule as their branch, so this file does not depend on their code.
 * usage: node tools/e2e-layout.mjs [url] ; SHOTS=dir
 */
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5302'}/`;
const SHOTS = process.env.SHOTS ?? '/tmp/e2e-layout'; fs.mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let bad = 0; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); if (!c) bad++; };
const MOOD_CSS = `.mood-wrap { position:relative; display:flex; }
@media (orientation: landscape) and (max-width: 740px) {
  .dock > .mood-wrap { position:absolute; left:calc(100% + 6px); bottom:0; }
  .dock > .mood-wrap > button { background:rgba(255,255,255,.86); border-radius:16px; min-width:52px; }
}`;
const VIEWS = [[667, 375], [740, 360], [760, 375], [812, 375], [844, 390], [932, 430]];
const inter = (a, c) => Math.max(0, Math.min(a.r, c.r) - Math.max(a.l, c.l)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.t, c.t));
for (const q of ['', 'move=classic']) for (const [w, h] of VIEWS) for (const mood of [false, true]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('yw.portrait', '1'); } catch { /* */ } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url + (url.includes('?') ? '&' : '?') + 'fresh=1&lieu=appart&perf=0' + (q ? '&' + q : ''), { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready && document.querySelector('.dock') && document.querySelector('.joy'), null, { timeout: 180000 }); await p.waitForTimeout(800);
  if (mood) await p.evaluate((css) => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    const d = document.querySelector('.dock'); const m = document.createElement('div'); m.className = 'mood-wrap'; m.innerHTML = '<button title="Humeur">🙂<span>Humeur</span></button>'; d.appendChild(m); }, MOOD_CSS);
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => { const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
    const d = document.querySelector('.dock'); return { W: innerWidth, H: innerHeight, dock: R(d), run: R(document.querySelector('.run-btn')), joy: R(document.querySelector('.joy')), mood: R(document.querySelector('.mood-wrap > button')),
      buttons: [...d.querySelectorAll(':scope > button, :scope > .mood-wrap > button')].filter((x) => getComputedStyle(x.parentElement).position !== 'absolute' || x.parentElement === d).map((x) => R(x)).filter(Boolean) }; });
  const name = `${w}x${h}${q ? ' classic' : ''}${mood ? ' +Mood' : ''}`; const rd = (o) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
  if (!q) ok(!!r.run, `${name}: Run button shown`);
  const gapRun = r.run ? Math.round(r.dock.l - r.run.r) : null, gapJoy = Math.round(r.dock.l - r.joy.r);
  ok(!r.run || inter(r.dock, r.run) === 0, `${name}: dock does not cover the Run button (gap ${gapRun} px)`, { dock: rd(r.dock), run: rd(r.run) });
  ok(inter(r.dock, r.joy) === 0 || r.dock.b <= r.joy.t, `${name}: dock does not cover the joystick (gap ${gapJoy} px)`);
  ok(r.dock.l >= 0 && r.dock.r <= r.W, `${name}: dock inside the screen (${Math.round(r.dock.l)}..${Math.round(r.dock.r)} / ${r.W})`);
  ok(r.buttons.every((x) => x.l >= r.dock.l - 1 && x.r <= r.dock.r + 1 && x.r <= r.W), `${name}: every dock button inside the dock, on screen (${r.buttons.length})`);
  if (mood) { ok(!!r.mood && r.mood.r <= r.W - 2 && r.mood.l >= 0, `${name}: Mood button inside the screen (${r.mood && Math.round(r.mood.l)}..${r.mood && Math.round(r.mood.r)})`);
    ok(!!r.mood && (!r.run || inter(r.mood, r.run) === 0) && inter(r.mood, r.joy) === 0, `${name}: Mood button clear of Run / joystick`); }
  if (!q && (w === 667 || w === 844)) { const cdp = await ctx.newCDPSession(p); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/dock_${w}x${h}${mood ? '_mood' : ''}.png`, Buffer.from(s.data, 'base64')); }
  ok(errs.length === 0, `${name}: no page errors`, errs.slice(0, 2));
  await ctx.close();
}
console.log(`== e2e-layout: ${bad ? bad + ' failed' : 'all passed'} ==`); if (bad) process.exitCode = 1; await b.close();
