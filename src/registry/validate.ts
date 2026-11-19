import { ITEM_CLASSES, NON_TRADABLE_REASONS, registryKey, type RegistryItem, type RegistryKind } from './types';
/** Pure checks. Run by tests/item-registry.test.ts; returns human-readable errors (empty = valid). */

/** Structural rules of the registry itself (v1.1 §2, §3, §8; v1.2). */
export function validateRegistry(items: readonly RegistryItem[]): string[] {
  const errs: string[] = []; const keys = new Set<string>(); const idsByKind = new Map<RegistryKind, Set<string>>();
  for (const i of items) {
    const e = (m: string) => errs.push(`${registryKey(i)}: ${m}`);
    const k = registryKey(i);
    if (keys.has(k)) e('clé en double'); keys.add(k);
    const s = idsByKind.get(i.kind) ?? new Set<string>(); if (s.has(i.id)) e('id en double'); s.add(i.id); idsByKind.set(i.kind, s);
    if (!i.id.trim() || /\s/.test(i.id)) e('id invalide');
    if (!i.name?.trim()) e('nom manquant');
    if (!i.acquisition.length) e('méthode d’acquisition manquante');
    if (!(ITEM_CLASSES as readonly string[]).includes(i.classification)) e(`classe inconnue ${String(i.classification)}`);
    if (/epic|legendary|[ée]pique|l[ée]gendaire/i.test(String(i.classification))) e('Épique/Légendaire ne sont pas des classes officielles');
    if (i.price) {
      if (!Number.isSafeInteger(i.price.amount) || i.price.amount <= 0) e('prix invalide');
      if (!['gold', 'diamond'].includes(i.price.currency)) e('devise inconnue');
    }
    // class <-> currency consistency (Premium = bought with Diamonds; Gold = bought with Gold; Free = no price)
    if (i.classification === 'Free' && i.price) e('Free avec un prix');
    if (i.classification === 'Gold' && i.price?.currency !== 'gold') e('Gold sans prix en Gold');
    if (i.classification === 'Premium' && i.price?.currency !== 'diamond') e('Premium sans prix en Diamants');
    if (i.price?.currency === 'diamond' && !['Premium', 'LimitedEdition', 'Seasonal', 'Exclusive', 'Rare'].includes(i.classification)) e('article en Diamants non Premium');
    // Limited Edition: declared max supply, never on other classes
    if (i.classification === 'LimitedEdition') { if (!Number.isSafeInteger(i.maxSupply) || (i.maxSupply as number) <= 0) e('LimitedEdition sans maxSupply'); }
    else if (i.maxSupply !== undefined) e('maxSupply réservé à LimitedEdition');
    if (i.reRelease === 'never' && !['LimitedEdition', 'Exclusive', 'Seasonal'].includes(i.classification)) e('reRelease=never sur un article non limité');
    // tradability: default true; false only with a documented reason
    if (!i.tradable && !i.nonTradableReason) e('tradable=false sans raison documentée');
    if (i.nonTradableReason && !(i.nonTradableReason in NON_TRADABLE_REASONS)) e('raison non documentée');
    if (i.tradable && i.nonTradableReason) e('raison de non-échange sur un article échangeable');
    if (i.classification === 'Premium' && !i.tradable && !i.nonTradableReason) e('Premium non échangeable sans exception');
    // no Épique/Légendaire badge on an unlimited item unless its removal is recorded
    if ((i.legacyRarity === 'epic' || i.legacyRarity === 'legendary') && i.classification !== 'LimitedEdition' && i.labelStatus === 'ok') e('badge Épique/Légendaire sur un article illimité');
    if (i.legacyRarity === 'rare' && i.classification !== 'Rare' && i.labelStatus === 'ok') e('badge Rare sur un article non Rare');
    if (i.labelStatus === 'owner_decision' && !i.ownerDecision) e('décision propriétaire non décrite');
    if (!i.releaseConditions.trim()) e('conditions de sortie manquantes');
    if (i.provenance?.tracking !== 'not_yet') e('provenance manquante');
  }
  return errs;
}

/** A catalogue row reduced to the fields the registry must match exactly. */
export interface CatalogueRow { kind: RegistryKind; id: string; name: string; category: string; price: { currency: string; amount: number } | null; rarity?: string }

/** Every catalogue item must be registered with the identical id, name, category and price.
 *  Registry rows absent from the catalogue are allowed only when flagged `pendingBranch`. */
export function compareWithCatalogue(items: readonly RegistryItem[], rows: readonly CatalogueRow[]): string[] {
  const errs: string[] = []; const reg = new Map(items.map((i) => [registryKey(i), i])); const seen = new Set<string>();
  for (const r of rows) {
    const k = registryKey(r); seen.add(k); const i = reg.get(k);
    if (!i) { errs.push(`${k}: absent du registre`); continue; }
    if (i.name !== r.name) errs.push(`${k}: nom ${JSON.stringify(i.name)} ≠ catalogue ${JSON.stringify(r.name)}`);
    if (i.category !== r.category) errs.push(`${k}: catégorie ${i.category} ≠ catalogue ${r.category}`);
    const a = i.price ? `${i.price.currency}:${i.price.amount}` : 'free'; const b = r.price && r.price.amount !== 0 ? `${r.price.currency}:${r.price.amount}` : 'free';
    if (a !== b) errs.push(`${k}: prix ${a} ≠ catalogue ${b}`);
    if ((r.rarity === 'epic' || r.rarity === 'legendary') && i.labelStatus === 'ok' && i.classification !== 'LimitedEdition') errs.push(`${k}: badge ${r.rarity} non traité dans le registre`);
  }
  for (const i of items) if (!seen.has(registryKey(i)) && !i.pendingBranch) errs.push(`${registryKey(i)}: dans le registre mais absent du catalogue`);
  return errs;
}
