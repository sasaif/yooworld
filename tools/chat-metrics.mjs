import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright-core');
const url = process.argv[2]; const out = process.argv[3];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { sessionStorage.setItem('yw:e:dev:portrait', '1'); });
const p = await ctx.newPage(); await p.goto(url + '?fresh=1&lieu=appart'); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 }); await p.waitForTimeout(3000);
await p.evaluate(() => window.game.setPanel('chat')); await p.waitForTimeout(800);
// usage: node tools/chat-metrics.mjs url out.png -> chat sizes (iPhone 15 landscape @3x) + simulated keyboard
// send two messages so the log has content
for (const t of ['Salut ! Ça va ?', 'On regarde la télé ?']) { await p.fill('.chat-sheet input', t); await p.evaluate(() => { const b = [...document.querySelectorAll('.chat-sheet button')].find((x) => /Envoyer/.test(x.textContent)); b?.click(); }); await p.waitForTimeout(500); }
const m = await p.evaluate(() => {
  const r = (el) => { if (!el) return null; const q = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { w: Math.round(q.width), h: Math.round(q.height), x: Math.round(q.x), y: Math.round(q.y), font: cs.fontSize }; };
  const sheet = document.querySelector('.chat-sheet');
  const msgs = [...sheet.querySelectorAll('.chatlog *')].filter((e) => e.children.length === 0 && e.textContent.trim()).map((e) => getComputedStyle(e).fontSize);
  const quick = [...sheet.querySelectorAll('button')].filter((x) => !/Envoyer|×|✕/.test(x.textContent)).map((x) => ({ t: x.textContent.trim().slice(0, 20), ...r(x) }));
  return { sheet: r(sheet), input: r(sheet.querySelector('input')), send: r([...sheet.querySelectorAll('button')].find((x) => /Envoyer/.test(x.textContent))), msgFonts: [...new Set(msgs)], log: r(sheet.querySelector('.chatlog')), quick, html: sheet.outerHTML.slice(0, 1500) };
});
delete m.html; console.log(JSON.stringify(m)); await p.screenshot({ path: out });
const fails = [];
if (parseFloat(m.input.font) < 16) fails.push('input font < 16px (iOS zoom)'); if (m.msgFonts.some((f) => parseFloat(f) < 15)) fails.push('message text < 15px');
if (m.input.h < 44 || m.send.h < 44) fails.push('input/send < 44px'); if (m.quick.some((q) => q.h < 40)) fails.push('quick reply < 40px');
if (m.send.x + m.send.w > 852 || m.sheet.y < 44) fails.push('clipped');
// simulated iOS keyboard: the visual viewport shrinks to 170 px while the input has the focus
await p.focus('.chat-sheet input'); await p.evaluate(() => { Object.defineProperty(window.visualViewport, 'height', { get: () => 170, configurable: true }); window.dispatchEvent(new Event('resize')); });
await p.waitForTimeout(600);
const k = await p.evaluate(() => { const r = document.querySelector('.chat-sheet').getBoundingClientRect(), i = document.querySelector('.chat-sheet input').getBoundingClientRect(); return { kbOpen: document.documentElement.classList.contains('kb-open'), sheet: [Math.round(r.top), Math.round(r.bottom)], input: [Math.round(i.top), Math.round(i.bottom)], quickShown: getComputedStyle(document.querySelector('.chat-sheet .quick')).display !== 'none' }; });
console.log('keyboard', JSON.stringify(k)); await p.screenshot({ path: out.replace('.png', '_kb.png') });
if (!k.kbOpen || k.input[1] > 170 || k.sheet[0] < 0) fails.push('keyboard: input hidden under the keyboard');
console.log(fails.length ? 'FAIL ' + fails.join(' · ') : 'PASS chat readable + touch-friendly (text ≥ 15px, input 16px, targets ≥ 44px, quick replies ≥ 40px, input above a simulated keyboard)');
if (fails.length) process.exitCode = 1; await b.close();
