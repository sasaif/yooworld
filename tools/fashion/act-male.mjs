import tour from './act-tour.mjs';
export default async (p, ctx) => {
  await p.goto(ctx.base + '?fresh=1'); await p.waitForFunction(() => window.game?.s.ready === true, null, { timeout: 180000 });
  await p.waitForTimeout(3000); await p.locator('.dock button', { hasText: 'Style' }).click(); await p.waitForTimeout(4000);
  await p.locator('.st-body button').nth(1).click(); await p.waitForTimeout(5000); await ctx.shot('m0');
  await p.locator('.st-cats button', { hasText: 'Barbe' }).first().click(); await p.waitForTimeout(1000); await ctx.shot('m1');
};
