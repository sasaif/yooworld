import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
/**
 * Hair motion perf, EMULATION ONLY (headless Chrome, SwiftShader software WebGL = no GPU, device viewport / DPR / touch,
 * CDP CPU throttling). Not a real iPhone; the box is shared with other jobs (load average recorded).
 *  1) GAME: the real app on the beach, Juanita (twin buns, rigged) running circles via tap-to-move, Juan static.
 *     ?hairmotion=1 vs 0: draw calls (window.__info), rAF frame interval over 6 s, hair update ms per frame (__hairLast).
 *  2) CROWD: tools/hairperf (real CustomAvatar build + real driveHair, orthographic iso camera), 1 and 20 avatars,
 *     static / spring (budget 8 = shipped default) / spring with every rig updated (max=20). 60 deterministic frames at dt 1/30.
 * usage: node tools/perf-hair-motion.mjs [baseUrl] ; OUT=file.json ; THR=4
 */
const base = process.argv[2] ?? 'http://127.0.0.1:5794/'; const OUT = process.env.OUT; const THR_ENV = process.env.THR ? +process.env.THR : null; let THR = 4; // default per device: SE 6x, 15 4x (THR=n forces one rate)
const DEV = { 'iPhone SE': { w: 667, h: 375, dpr: 2, thr: 6 }, 'iPhone 15': { w: 852, h: 393, dpr: 3, thr: 4 } };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const stat = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; return { mean: +(s.reduce((x, y) => x + y, 0) / Math.max(1, s.length)).toFixed(3), p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), n: s.length }; };
const res = { note: 'EMULATION: headless Chrome + SwiftShader (no GPU) + device emulation + CDP CPU throttle ' + (THR_ENV ?? 'SE 6x / 15 4x') + '. Not a real iPhone. Shared box.', date: new Date().toISOString(), game: [], crowd: [] };
for (const [dev, d] of Object.entries(DEV)) { THR = THR_ENV ?? d.thr;
  for (const hm of [0, 1]) {
    const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('yw.portrait', '1'); } catch { /* */ } });
    const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
    await p.goto(base + `?fresh=1&lieu=appart&hairmotion=${hm}`, { timeout: 120000 }); await p.waitForFunction(() => window.game?.s.ready && window.__hair && window.__info, null, { timeout: 180000 });
    await p.evaluate(() => window.game.travel('beach')); await p.waitForTimeout(5000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR });
    const r = await p.evaluate(() => new Promise((done) => {
      const c = window.__world.chars.f; const V = window.__cam.position.constructor; const o = { x: c.pos.x, z: c.pos.z }; let k = 0;
      const go = () => { const a = k++ * 1.3; window.game.walkTo(new V(o.x + Math.cos(a) * 1.6, 0, o.z + Math.sin(a) * 1.6), k % 2 === 0); };
      go(); const iv = setInterval(go, 900);
      const fr = [], hair = [], upd = []; let last = performance.now(); const t0 = last; let calls = [];
      const loop = (now) => { fr.push(now - last); last = now; const h = window.__hairLast(); hair.push(h.ms); upd.push(h.updated); if (window.__info) calls.push(window.__info.calls);
        if (now - t0 < 6000) requestAnimationFrame(loop); else { clearInterval(iv); const a = window.__hair().avatars.f; done({ fr: fr.slice(5), hair, upd, calls, state: a?.state, peak: a ? Math.max(0, ...a.chains.map((x) => x.peak)) : 0, met: window.__metrics() }); } };
      requestAnimationFrame(loop); }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const row = { device: dev, viewport: `${d.w}x${d.h}@${d.dpr}`, cpuThrottle: THR, scene: 'game beach (Juanita buns rigged + Juan static + NPCs)', hairMotion: hm ? 'spring' : 'static', state: r.state, peakDeg: +r.peak.toFixed(2),
      frameMs: stat(r.fr), fps: +(1000 / stat(r.fr).mean).toFixed(1), hairUpdateMsPerFrame: stat(r.hair), rigsUpdated: Math.max(0, ...r.upd), drawCalls: Math.max(0, ...r.calls), avatarScreenH: { f: r.met.f?.screenH, m: r.met.m?.screenH }, loadavg: +os.loadavg()[0].toFixed(1) };
    res.game.push(row); console.log('GAME', JSON.stringify({ dev, hm, fps: row.fps, frameP50: row.frameMs.p50, hairMean: row.hairUpdateMsPerFrame.mean, upd: row.rigsUpdated, calls: row.drawCalls, h: row.avatarScreenH, state: r.state, peak: row.peakDeg, load: row.loadavg }));
    await ctx.close();
  }
  for (const n of [1, 20]) for (const [label, q] of [['static', 'hairmotion=0'], ['spring (budget 8)', ''], ...(n > 1 ? [['spring (all 20)', 'max=20']] : [])]) {
    const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
    await p.goto(base + `tools/hairperf/index.html?n=${n}&${q}`, { timeout: 120000 }); await p.waitForFunction(() => window.__ready || window.__err, null, { timeout: 240000 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR });
    const r = await p.evaluate(() => { for (let i = 0; i < 30; i++) window.__timedStep(1 / 30); const f = [], st = [], h = [], fi = []; let upd = 0, calls = 0, tris = 0;
      for (let i = 0; i < 60; i++) { const x = window.__timedStep(1 / 30); f.push(x[0]); st.push(x[1]); h.push(x[2]); fi.push(x[3]); upd = Math.max(upd, x[4]); calls = x[5]; tris = x[6]; }
      return { f, st, h, fi, upd, calls, tris, bench: window.__bench(300) }; });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const row = { device: dev, viewport: `${d.w}x${d.h}@${d.dpr}`, cpuThrottle: THR, scene: 'crowd harness (ortho iso camera)', avatars: n, hairMotion: label, rigsUpdatedPerFrame: r.upd,
      frameCpuMs: stat(r.f), stepJsMs: stat(r.st), hairUpdateMsPerFrame: stat(r.h), glFinishMs: stat(r.fi), benchHairMsPerFrame: +r.bench.toFixed(4), drawCalls: r.calls, triangles: r.tris, loadavg: +os.loadavg()[0].toFixed(1) };
    res.crowd.push(row); console.log('CROWD', JSON.stringify({ dev, n, label, frameP50: row.frameCpuMs.p50, hairMean: row.hairUpdateMsPerFrame.mean, bench: row.benchHairMsPerFrame, upd: r.upd, calls: r.calls, tris: r.tris, load: row.loadavg }));
    await ctx.close();
  }
}
await b.close(); if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
