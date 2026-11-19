import { createRequire } from 'module'; import fs from 'fs';
const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
// Ambient PNJs on iPhone 15 landscape. Usage: SHOTS=dir node tools/e2e-ambient-npcs.mjs http://127.0.0.1:PORT/
const url = process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? '54224'}/`;
const SHOTS = process.env.SHOTS ?? 'shots/ambient-npcs';
fs.mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) { fails++; process.exitCode = 1; } else passes++; };
const shot = (name) => p.screenshot({ path: `${SHOTS}/${name}.png` });
const ev = (f, a) => p.evaluate(f, a);
const ready = () => p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 });

await p.goto(url + (url.includes('?') ? '&' : '?') + 'fresh=1&lieu=plage');
await ready(); await p.waitForTimeout(3500);
await p.keyboard.press('F9'); await p.waitForTimeout(200);

const beach = await ev(() => {
  const ids = Object.keys(window.__world.chars).filter((id) => id.startsWith('npc_'));
  const npcs = ids.map((id) => { const c = window.__world.chars[id]; return { id, name: c.name, mode: c.mode, local: c.local, pos: [c.pos.x, c.pos.z] }; });
  const tags = [...document.querySelectorAll('.nametag .npc')].map((el) => ({ text: el.textContent, title: el.getAttribute('title') }));
  const friends = window.game.s.profile?.friends ?? null;
  const loc = window.game.s.location;
  const info = window.__info;
  return { loc, npcs, tags, friends, info, onlineText: document.body.innerText };
});
ok(beach.loc === 'beach', 'starts at Yoo Plage');
ok(beach.npcs.length === 2, `exactly 2 ambient NPCs on the beach (${beach.npcs.length})`);
ok(beach.npcs.every((n) => n.local === true), 'NPCs are marked local');
ok(beach.npcs.every((n) => n.name !== 'Juan' && n.name !== 'Juanita'), 'NPC names are not the player avatars');
ok(Array.isArray(beach.friends) && beach.friends.length === 0, 'friends list stays empty');
ok(!/en ligne · \d/.test((beach.onlineText || '').toLowerCase()), 'no online-player count is shown');
ok(beach.tags.filter((t) => t.text === 'PNJ').length >= 3, `PNJ badges present (companion + ambient): ${JSON.stringify(beach.tags)}`);
ok(beach.tags.every((t) => /pas un joueur en ligne/i.test(t.title || '')), 'PNJ badge title says they are not online players');
const modes = beach.npcs.map((n) => n.mode);
ok(modes.every((m) => ['idle', 'walk', 'sitting', 'standing', 'emote'].includes(m)), 'NPCs use idle/wander/sit/emote modes ' + JSON.stringify(modes));
const onScreen = await ev(() => {
  const r = { w: 852, h: 393 };
  return Object.keys(window.__world.chars).filter((id) => id.startsWith('npc_')).map((id) => {
    const m = window.__metrics?.()[id];
    const vis = m && m.bboxPx && m.bboxPx[2] > 0 && m.bboxPx[0] < r.w && m.bboxPx[3] > 0 && m.bboxPx[1] < r.h;
    return { id, vis, bbox: m?.bboxPx ?? null };
  });
});
ok(onScreen.filter((x) => x.vis).length >= 1, 'at least one ambient NPC is on screen ' + JSON.stringify(onScreen));
console.log('PERF_BEACH', JSON.stringify({ calls: beach.info?.calls, main: beach.info?.callsMain, shadow: beach.info?.callsShadow, tri: beach.info?.triangles, npcs: beach.npcs, modes, onScreen }));
await shot('01_beach_npcs');

await p.waitForFunction(() => Object.values(window.__world.chars).some((c) => c.id.startsWith('npc_') && (c.mode === 'walk' || c.mode === 'sitting' || c.emote)), null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(600);
const later = await ev(() => Object.keys(window.__world.chars).filter((id) => id.startsWith('npc_')).map((id) => { const c = window.__world.chars[id]; return { id, name: c.name, mode: c.mode }; }));
ok(later.length === 2, 'still 2 NPCs after a few seconds');
await shot('02_beach_npcs_later');

// travel home: NPCs despawn, apartment stays without ambient NPCs
await ev(() => window.game.travelWithFade('home'));
await p.waitForFunction(() => window.game.s.location === 'home' && !window.game.s.transition, null, { timeout: 30000 });
await p.waitForTimeout(2000);
const home = await ev(() => ({ loc: window.game.s.location, npcs: Object.keys(window.__world.chars).filter((id) => id.startsWith('npc_')), chars: Object.keys(window.__world.chars), info: window.__info }));
ok(home.loc === 'home', 'travelled home');
ok(home.npcs.length === 0, `no ambient NPCs in the apartment (${home.npcs})`);
ok(home.chars.includes('f') && home.chars.includes('m'), 'player and companion still present');
console.log('PERF_HOME', JSON.stringify({ calls: home.info?.calls, main: home.info?.callsMain, shadow: home.info?.callsShadow, tri: home.info?.triangles }));
await shot('03_apartment_no_npcs');

// club also stays without ambient NPCs
await ev(() => window.game.travel('club'));
await p.waitForFunction(() => window.game.s.location === 'club', null, { timeout: 20000 });
await p.waitForTimeout(2000);
const club = await ev(() => Object.keys(window.__world.chars).filter((id) => id.startsWith('npc_')));
ok(club.length === 0, 'no ambient NPCs in the Games Club');

ok(errs.length === 0, 'no console/page errors ' + errs.join(' | '));
console.log(`SUMMARY ambient-npcs ${fails ? 'FAIL' : 'PASS'} (${passes} passed, ${fails} failed)`);
await b.close();
