import { chromium } from 'playwright-core'; import fs from 'fs'; import { execSync } from 'child_process';
// Short MP4 of joystick walking on iPhone 15 landscape: frames from CDP screencast + a drawn finger dot, assembled with ffmpeg.
const url = process.argv[2] ?? 'http://127.0.0.1:5230/'; const out = process.argv[3] ?? 'shots/movement/joystick_walk.mp4';
const dir = '/tmp/joyvid'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); await p.goto(url + '?fresh=1'); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 }); await p.waitForTimeout(5000);
await p.addStyleTag({ content: '#finger{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,255,255,.55);border:2px solid rgba(80,30,90,.5);z-index:9999;pointer-events:none;display:none}' });
await p.evaluate(() => { const d = document.createElement('div'); d.id = 'finger'; document.body.appendChild(d); });
const cdp = await ctx.newCDPSession(p); const frames = [];
cdp.on('Page.screencastFrame', async (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
const j = await p.evaluate(() => { const r = document.querySelector('.joy').getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, R: r.width / 2 - 10 }; });
const finger = (x, y, on) => p.evaluate(([x, y, on]) => { const f = document.getElementById('finger'); f.style.display = on ? 'block' : 'none'; f.style.left = x + 'px'; f.style.top = y + 'px'; }, [x, y, on]);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
await p.waitForTimeout(800);
const path = [[0, 0.3, 1200], [0, 0.6, 1000], [0, 1, 1200], [60, 1, 900], [150, 1, 1100], [200, 0.5, 900], [250, 1, 1100], [320, 0.25, 1200]];
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: j.cx, y: j.cy, id: 1 }] }); await finger(j.cx, j.cy, true);
for (const [a, d, ms] of path) {
  const x = j.cx + Math.cos(a * Math.PI / 180) * d * j.R, y = j.cy - Math.sin(a * Math.PI / 180) * d * j.R;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }); await finger(x, y, true); await p.waitForTimeout(ms);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: j.cx, y: j.cy, id: 1 }] }); await finger(0, 0, false); await p.waitForTimeout(1200);
await cdp.send('Page.stopScreencast'); await b.close();
// constant 15 fps timeline from the timestamped frames
const t0 = frames[0].t, t1 = frames.at(-1).t, fps = 15; let k = 0, n = 0;
for (let t = t0; t <= t1; t += 1 / fps) { while (k + 1 < frames.length && frames[k + 1].t <= t) k++; fs.writeFileSync(`${dir}/f${String(n++).padStart(5, '0')}.jpg`, Buffer.from(frames[k].data, 'base64')); }
execSync(`ffmpeg -y -loglevel error -framerate ${fps} -i ${dir}/f%05d.jpg -vf "scale=852:-2,format=yuv420p" -c:v libx264 -crf 23 -movflags +faststart ${out}`);
console.log('video', out, n, 'frames', (t1 - t0).toFixed(1) + 's', 'source frames', frames.length);
