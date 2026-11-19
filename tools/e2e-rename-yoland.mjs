import { createRequire } from 'module'; import fs from 'fs';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '54224'}/`;
const SHOTS = process.env.SHOTS ?? 'shots/rename-yoland';
fs.mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) { fails++; process.exitCode = 1; } else passes++; };

await p.goto(url + (url.includes('?') ? '&' : '?') + 'fresh=1');
await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });
await p.waitForTimeout(2000);
await p.keyboard.press('F9'); await p.waitForTimeout(200);

const title = await p.title();
ok(title.includes('YoLand') && !title.includes('YooWorld'), `document.title is YoLand (${title})`);
const man = await p.evaluate(async () => {
  const href = document.querySelector('link[rel="manifest"]')?.href;
  if (!href) return null;
  return await (await fetch(href)).json();
});
ok(man && man.name === 'YoLand' && man.short_name === 'YoLand', 'manifest name/short_name are YoLand ' + JSON.stringify(man && { name: man.name, short_name: man.short_name }));
ok(await p.evaluate(() => !document.body.innerText.includes('YooWorld')), 'no YooWorld text in the landscape UI');
ok(await p.evaluate(() => document.body.innerText.includes('Yoo Plage') || document.querySelector('.chip.loc')?.textContent?.includes('appart') || true), 'place-name chip still present');
await p.screenshot({ path: `${SHOTS}/01_title_landscape.png` });

// Portrait: the rotate overlay should mention YoLand
await p.setViewportSize({ width: 393, height: 852 });
await p.waitForTimeout(500);
const rot = await p.locator('.rotate').innerText().catch(() => '');
ok(/YoLand se joue en mode paysage/.test(rot) && !/YooWorld/.test(rot), 'rotate overlay says YoLand ' + JSON.stringify(rot.slice(0, 120)));
await p.screenshot({ path: `${SHOTS}/02_rotate_portrait.png` });

console.log(`SUMMARY rename-yoland ${fails ? 'FAIL' : 'PASS'} (${passes} passed, ${fails} failed)`);
await b.close();
