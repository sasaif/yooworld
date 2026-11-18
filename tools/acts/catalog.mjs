export default async (p) => { await p.evaluate(() => { window.game.setPanel('catalog'); }); await p.waitForTimeout(800); await p.getByText('Boutique').click(); await p.waitForTimeout(1200); };
