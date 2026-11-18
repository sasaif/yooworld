// Full studio tour used for the screenshot set. Drives the real UI (clicks), falls back to the controller only for setup.
const tap = async (p, id) => { const el = p.locator(`[data-item="${id}"]`).first(); await el.scrollIntoViewIfNeeded(); await el.click(); await p.waitForTimeout(350); };
const tab = (p, label) => p.locator('.st-tabs button', { hasText: label }).first().click();
const cat = (p, label) => p.locator('.st-cats button', { hasText: label }).first().click();
const settle = (p, ms = 1800) => p.waitForTimeout(ms);
export default async (p, { base, shot }) => {
  await p.goto(base + '?fresh=1', { timeout: 120000 });
  await p.waitForFunction(() => window.game?.s.ready === true, null, { timeout: 180000 });
  await settle(p, 5000); await shot('01_hud');
  await p.locator('.dock button', { hasText: 'Style' }).click(); await settle(p, 5000);
  await cat(p, 'Visage'); await settle(p); await shot('02_editor_face_before');
  await tap(p, 'skin_caramel'); await tap(p, 'face_heart'); await tap(p, 'mk_lip_red'); await tap(p, 'det_freckles'); await tap(p, 'mk_shadow_violet'); await settle(p); await shot('03_editor_face_after');
  await cat(p, 'Yeux'); await tap(p, 'eyes_big'); await tap(p, 'eyecol_green'); await settle(p); await shot('04_editor_eyes');
  await cat(p, 'Cheveux'); await tap(p, 'hair_long'); await tap(p, 'haircol_blond'); await settle(p, 2500); await shot('05_hair_long');
  await tap(p, 'hair_pony'); await tap(p, 'haircol_red'); await settle(p, 2500); await shot('06_hair_pony');
  await cat(p, 'T-shirts'); await settle(p); await p.locator('[data-pill=full]').click(); await settle(p, 2500); await shot('07_outfit_before'); await p.locator('[data-pill=full]').click();
  await tap(p, 'tee_stripes'); await cat(p, 'Vestes'); await tap(p, 'jacket_denim'); await cat(p, 'Pantalons'); await tap(p, 'pants_jeans'); await cat(p, 'Chaussures'); await tap(p, 'shoes_boots');
  await p.locator('[data-pill=full]').click(); await settle(p, 2500); await shot('08_outfit_after'); await p.locator('[data-pill=full]').click();
  await cat(p, 'Accessoires'); await tap(p, 'acc_sunglasses'); await tap(p, 'acc_necklace_chain'); await tap(p, 'acc_tote'); await settle(p, 2500); await shot('09_shop_grid_accessories');
  await p.locator('.st-cart .btn.buy').click(); await settle(p, 800); await shot('10_tryon_cart_confirm');
  await p.locator('.md-card .btn.buy').click(); await settle(p, 1200); await shot('11_after_purchase');
  await tab(p, 'Mes articles'); await cat(p, 'Accessoires'); await settle(p); await shot('12_inventory');
  await tab(p, 'Équipé'); await settle(p); await shot('13_equipped');
  await tab(p, 'Échanges'); await settle(p, 600); await shot('14_trade_empty');
  await p.locator('.trade .btn.big').click(); await settle(p, 600);
  const sides = p.locator('.tr-side'); await sides.nth(0).locator('input').fill('300'); await sides.nth(0).locator('button', { hasText: 'Proposer' }).click(); await settle(p, 300);
  await sides.nth(1).locator('input').fill('50'); await sides.nth(1).locator('button', { hasText: 'Proposer' }).click(); await settle(p, 300);
  await p.locator('.tr-side').nth(0).locator('button', { hasText: 'Accepter' }).click(); await settle(p, 300); await p.locator('.tr-side').nth(1).locator('button', { hasText: 'Accepter' }).click(); await settle(p, 600);
  await shot('15_trade_locked_escrow');
  await p.locator('.tr-side').nth(0).locator('button', { hasText: 'Confirmer' }).click(); await settle(p, 300); await p.locator('.tr-side').nth(1).locator('button', { hasText: 'Confirmer' }).click(); await settle(p, 800);
  await shot('16_trade_completed');
  await tab(p, 'Portefeuille'); await settle(p, 600); await shot('17_wallet');
  // female final look in the body frame
  await tab(p, 'Boutique'); await cat(p, 'Cheveux'); await tap(p, 'hair_bob'); await tap(p, 'haircol_pink'); await cat(p, 'Accessoires'); await tap(p, 'acc_earrings_hoops'); await settle(p, 2500);
  await p.locator('[data-pill=full]').click(); await settle(p, 2500); await shot('18_female_custom'); await p.locator('[data-pill=full]').click();
  // male
  await p.locator('.st-body button').nth(1).click(); await settle(p, 5000); await cat(p, 'Barbe'); await tap(p, 'beard_short'); await settle(p, 2000); await shot('19_male_beard');
  await cat(p, 'Cheveux'); await tap(p, 'hair_manbun'); await tap(p, 'haircol_black'); await cat(p, 'Vestes'); await tap(p, 'jacket_leather'); await cat(p, 'T-shirts'); await tap(p, 'tee_white');
  await cat(p, 'Pantalons'); await tap(p, 'pants_cargo'); await cat(p, 'Chaussures'); await tap(p, 'shoes_high'); await cat(p, 'Accessoires'); await tap(p, 'acc_cap'); await tap(p, 'acc_watch'); await settle(p, 3000);
  await p.locator('[data-pill=full]').click(); await settle(p, 2500); await shot('20_male_custom'); await p.locator('[data-pill=full]').click(); await cat(p, 'Visage'); await settle(p, 2000); await shot('21_male_face');
  const info = await p.evaluate(() => window.__studioInfo ?? null); console.log('STUDIO_INFO', JSON.stringify(info));
};
