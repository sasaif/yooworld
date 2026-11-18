export default async (p, { base, shot }) => {
  await p.goto(base + '?fresh=1', { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready === true, null, { timeout: 180000 }).catch(() => console.log('no __ready'));
  await p.waitForTimeout(5000); await shot('hud');
  await p.evaluate(() => window.fashion.open('f', 'face'));
  await p.waitForTimeout(6000); await shot('studio_face');
};
