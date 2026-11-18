import { createRequire } from 'module'; import fs from 'fs'; const { chromium } = createRequire(import.meta.url)('playwright-core');
// Chat card on iPhone 15 landscape: expanded / long messages / collapsed with unread counter; layout checks.
// usage: node tools/chat-shots.mjs [url] ; OUT=dir
const url = process.argv[2] ?? 'http://127.0.0.1:5270/'; const OUT = process.env.OUT ?? 'shots/interactions'; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { sessionStorage.setItem('yw.portrait', '1'); localStorage.setItem('yw.camView', 'room'); } catch { /* */ } });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); if (!c) fails++; };
await p.goto(url + '?fresh=1&lieu=appart'); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 }); await p.waitForTimeout(3000);
await p.evaluate(() => { localStorage.removeItem('yw.chatCollapsed'); window.game.setPanel('chat'); }); await p.waitForTimeout(500);
const check = () => p.evaluate(() => {
  const c = document.querySelector('.chat-sheet'); const r = c.getBoundingClientRect(); const q = [...c.querySelectorAll('.quick button')].map((x) => x.getBoundingClientRect());
  const log = c.querySelector('.chatlog'); const sc = c.querySelector('.chat-scope');
  return { card: [r.x, r.y, r.width, r.height].map(Math.round), inScreen: r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight,
    logHScroll: log ? log.scrollWidth - log.clientWidth : null, logScrollable: log ? log.scrollHeight > log.clientHeight : null, logH: log ? Math.round(log.clientHeight) : null,
    scopeCut: sc ? sc.scrollHeight - sc.clientHeight : null, scopeText: sc?.textContent,
    quickFirstVisible: q.length ? q[0].x >= r.x && q[0].right <= r.right : null, quickRow: c.querySelector('.quick') ? [c.querySelector('.quick').scrollWidth, c.querySelector('.quick').clientWidth] : null,
    collapsed: c.classList.contains('collapsed'), unread: c.querySelector('.chat-unread')?.textContent ?? null };
});
let k = await check(); ok(k.inScreen, 'chat card inside the screen', k.card); ok(k.scopeCut <= 1, 'local-mode note not truncated', { text: k.scopeText });
await p.screenshot({ path: `${OUT}/chat_expanded_iphone15.png` });
// quick replies: scroll to the end, last chip fully inside the card
const last = await p.evaluate(() => { const qq = document.querySelector('.chat-sheet .quick'); qq.scrollLeft = qq.scrollWidth; return new Promise((r) => setTimeout(() => { const c = document.querySelector('.chat-sheet').getBoundingClientRect(); const bs = [...qq.querySelectorAll('button')]; const lb = bs[bs.length - 1].getBoundingClientRect(); r({ inside: lb.x >= c.x && lb.right <= c.right - 4, lb: [lb.x, lb.right].map(Math.round), card: [c.x, c.right].map(Math.round) }); }, 300)); });
ok(last.inside, 'last quick reply fully inside the card once scrolled', last);
await p.screenshot({ path: `${OUT}/chat_quick_scrolled_iphone15.png` });
await p.evaluate(() => { const qq = document.querySelector('.chat-sheet .quick'); qq.scrollLeft = 0; });
await p.evaluate(() => { const g = window.game; for (const t of ['Supercalifragilisticexpialidocious'.repeat(4), 'https://sasaif.github.io/yooworld/experience/?v=3&lieu=appart&perf=1&utm_source=very-long-link-test', 'هاي، كيف حالك؟ مرحبا بك في شقتي 🏠', '🎉🎉🎉🌴🥭🌊💃🕺🎶✨🎉🎉🎉🌴🥭🌊💃🕺🎶✨🎉🎉🎉🌴🥭🌊💃🕺', 'Lorem ipsum dolor sit amet, '.repeat(18).slice(0, 500)]) g.sendChat(t); });
await p.waitForTimeout(600); k = await check();
ok(k.logHScroll <= 0, 'long words / URL / 500 chars wrap: no horizontal overflow in the message list', { hScroll: k.logHScroll }); ok(k.logScrollable, 'message list scrolls vertically (max height kept)', { h: k.logH }); ok(k.inScreen, 'card still inside the screen with long messages', k.card);
await p.screenshot({ path: `${OUT}/chat_long_iphone15.png` });
await p.evaluate(() => document.querySelector('.chat-fold').click()); await p.waitForTimeout(300);
await p.evaluate(() => window.game.sendChat('Coucou pendant que le chat est réduit')); await p.waitForTimeout(400);
k = await check(); ok(k.collapsed && k.unread === '1', 'collapsed card keeps an unread counter', { unread: k.unread, card: k.card }); ok(k.card[3] < 60, 'collapsed card is just its header', { h: k.card[3] });
await p.screenshot({ path: `${OUT}/chat_collapsed_iphone15.png` });
await p.evaluate(() => window.game.setPanel(null)); await p.waitForTimeout(200); await p.evaluate(() => window.game.setPanel('chat')); await p.waitForTimeout(300);
k = await check(); ok(k.collapsed, 'collapsed state persists (closed and reopened)');
await p.evaluate(() => document.querySelector('.chat-fold').click()); await p.waitForTimeout(300); k = await check(); ok(!k.collapsed && k.unread === null, 'tap the header: expands, counter cleared');
console.log(`SUMMARY chat: ${fails ? 'FAIL ' + fails : 'all pass'} · errors: ${errs.join(' | ') || 'none'}`); process.exitCode = fails ? 1 : 0; await b.close();
