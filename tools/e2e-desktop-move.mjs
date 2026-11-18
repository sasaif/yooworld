import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Desktop checks for movement step 1: no joystick by default (mouse), ?joystick=1 forces it, WASD/arrows drive the same
// controller, typing in the chat never moves the avatar, click-to-walk (existing tap-to-move) unchanged, wheel zoom unchanged.
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '5230'}/`; const sep = url.includes('?') ? '&' : '?';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const errs = [];
async function open(q) { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(url + sep + 'fresh=1' + q); await p.waitForFunction(() => window.game?.s.ready && window.__move, null, { timeout: 180000 }); await p.waitForTimeout(3000); return p; }
const pos = (p) => p.evaluate(() => window.__move().pos);
let p = await open('');
ok(await p.locator('.joy').count() === 0, 'desktop (mouse): no joystick by default');
await p.evaluate(() => { const c = window.__world.chars[window.game.s.activeChar]; c.pos.set(3.4, 0, 3.4); });
let a = await pos(p); await p.keyboard.down('KeyW'); await p.waitForTimeout(900); await p.keyboard.up('KeyW'); await p.waitForTimeout(500); let c = await pos(p);
ok(Math.hypot(c[0] - a[0], c[1] - a[1]) > 0.5 && (await p.evaluate(() => window.__move().mode)) === 'idle', `keyboard W walks then stops (${Math.hypot(c[0] - a[0], c[1] - a[1]).toFixed(2)} m)`);
await p.evaluate(() => window.game.setPanel('chat')); await p.waitForTimeout(500); const inp = p.locator('.sheet input').first();
if (await inp.count()) { await inp.focus(); a = await pos(p); await p.keyboard.type('wasd salut'); await p.waitForTimeout(600); c = await pos(p); ok(Math.hypot(c[0] - a[0], c[1] - a[1]) < 0.01, 'typing "wasd" in the chat does not move the avatar'); } else ok(false, 'chat input not found');
await p.evaluate(() => window.game.setPanel(null)); await p.waitForTimeout(300);
const z0 = await p.evaluate(() => window.__cam.zoom); await p.mouse.move(720, 450); await p.mouse.wheel(0, -400); await p.waitForTimeout(800); const z1 = await p.evaluate(() => window.__cam.zoom);
ok(z1 > z0, `mouse-wheel zoom unchanged (${z0.toFixed(0)} → ${z1.toFixed(0)})`);
const walk = await p.evaluate(() => window.game.walkTo(new window.__cam.position.constructor(2.5, 0, 4.5))); await p.waitForTimeout(400);
ok(walk && (await p.evaluate(() => window.__move().mode)) === 'walk', 'click/tap-to-move (existing) still walks');
await p.context().close();
p = await open('&joystick=1');
ok(await p.locator('.joy').count() === 1 && await p.locator('.joy').isVisible(), '?joystick=1 shows the joystick on desktop');
const box = await p.locator('.joy').boundingBox(); await p.evaluate(() => { const c = window.__world.chars[window.game.s.activeChar]; c.pos.set(3.4, 0, 3.4); });
a = await pos(p); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2, box.y + 4, { steps: 4 }); await p.waitForTimeout(800);
await p.screenshot({ path: 'shots/movement/desktop_joystick1.png' }); await p.mouse.up(); await p.waitForTimeout(400); c = await pos(p);
ok(Math.hypot(c[0] - a[0], c[1] - a[1]) > 0.4, `mouse drag on the forced joystick walks (${Math.hypot(c[0] - a[0], c[1] - a[1]).toFixed(2)} m)`);
await p.context().close();
ok(errs.length === 0, 'no console / page errors ' + errs.slice(0, 3).join(' | '));
await b.close();
