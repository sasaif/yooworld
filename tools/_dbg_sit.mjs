import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright-core');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
await p.goto('http://127.0.0.1:5230/?fresh=1'); await p.waitForFunction(() => window.game?.s.ready && window.__move, null, { timeout: 120000 }); await p.waitForTimeout(3000);
for (const start of [[3.0, 2.85], [1.5, 4], [5, 1.2]]) {
await p.evaluate(([x, z]) => { const c = window.__world.chars[window.game.s.activeChar]; c.pos.set(x, 0, z); c.path = []; c.mode = 'idle'; }, start); await p.waitForTimeout(500);
const info = await p.evaluate(() => { const sofa = window.game.s.apartment.items.find((i) => window.game.cat[i.defId].interaction === 'sit')?.uid; window.game.interact(sofa, 'sit'); const c = window.__world.chars[window.game.s.activeChar]; return { sofa, path: c.path.map((q) => [+q.x.toFixed(2), +q.z.toFixed(2)]), seat: c.pendingSeat && { front: [c.pendingSeat.front.x, c.pendingSeat.front.z], pos: [c.pendingSeat.pos.x, c.pendingSeat.pos.z] }, pos: [c.pos.x, c.pos.z] }; });
console.log(JSON.stringify(info));
for (let i = 0; i < 20; i++) { await p.waitForTimeout(500); const m = await p.evaluate(() => { const m = window.__move(); const c = window.__world.chars[window.game.s.activeChar]; return [m.mode, m.pos.map((v) => +v.toFixed(2)), m.path, +m.speed.toFixed(2), JSON.stringify(m.pathStats), !!c.pendingSeat, m.driving]; }); console.log(JSON.stringify(m)); if (m[0] === 'sitting') break; }
}
await b.close();
