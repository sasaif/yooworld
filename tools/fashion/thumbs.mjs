import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
// Auto-generates shop thumbnails: node tools/fashion/thumbs.mjs [outDir] [id,id,...]   (dev server on $BASE)
// Renders each catalogue item on a neutral avatar via ?thumbs (ThumbStage), then converts PNG -> WebP (Pillow).
const base = process.env.BASE ?? 'http://127.0.0.1:5217/'; const out = process.argv[2] ?? 'public/thumbs/fashion'; const only = process.argv[3]?.split(',');
mkdirSync(out, { recursive: true }); mkdirSync('/tmp/fthumbs', { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 160, height: 160 }, deviceScaleFactor: 1.6 })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(base + '?thumbs=hair_long' + (process.env.QS ?? ''), { timeout: 120000 });
await p.waitForFunction(() => window.__thumbReady === true, null, { timeout: 180000 });
const ids = only ?? await p.evaluate(() => window.__thumbIds());
for (const id of ids) {
  await p.evaluate((i) => window.__thumb(i), id);
  await p.waitForFunction(() => window.__thumbReady === true, null, { timeout: 60000 }).catch(() => console.log('timeout', id));
  await p.screenshot({ path: `/tmp/fthumbs/${id}.png`, omitBackground: true });
}
execFileSync('python3', ['-c', `import sys,PIL.Image as I\nfor i in sys.argv[2:]: I.open(f'/tmp/fthumbs/{i}.png').save(f'{sys.argv[1]}/{i}.webp','WEBP',quality=82,method=6)`, out, ...ids]);
console.log('thumbs', ids.length, 'errors', JSON.stringify(errs));
await b.close();
