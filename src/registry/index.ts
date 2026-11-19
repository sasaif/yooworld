import { ITEM_REGISTRY } from './items';
import { registryKey, type RegistryItem, type RegistryKind } from './types';
import type { CatalogueRow } from './validate';
import { CATALOGUE } from '../fashion/catalogue';
import { FURNITURE } from '../data/furniture';
import { FLOORS, WALLS } from '../data/finishes';
/** YooWorld item registry v1 — public entry point (read-only lookups; no economy side effects). */
export { ITEM_REGISTRY } from './items';
export * from './types';
export { validateRegistry, compareWithCatalogue, type CatalogueRow } from './validate';

const BY_KEY: ReadonlyMap<string, RegistryItem> = new Map(ITEM_REGISTRY.map((i) => [registryKey(i), i]));
/** Fashion / furniture: pass the id. Finishes: pass `floor:<id>` / `wall:<id>` (same key as the ownership record). */
export const registryItem = (key: string): RegistryItem | undefined => BY_KEY.get(key);
export const registryOf = (kind: RegistryKind) => ITEM_REGISTRY.filter((i) => i.kind === kind);

/** The live catalogues, flattened for validation against the registry. */
export function catalogueRows(): CatalogueRow[] {
  return [
    ...CATALOGUE.map((i): CatalogueRow => ({ kind: 'fashion', id: i.id, name: i.name, category: i.category, price: i.price ?? null, rarity: i.rarity })),
    ...Object.values(FURNITURE).map((f): CatalogueRow => ({ kind: 'furniture', id: f.id, name: f.name, category: f.category, price: { currency: 'gold', amount: f.price }, rarity: f.rarity })),
    ...FLOORS.map((f): CatalogueRow => ({ kind: 'floor', id: f.id, name: f.name, category: 'floor', price: { currency: 'gold', amount: f.price } })),
    ...WALLS.map((f): CatalogueRow => ({ kind: 'wall', id: f.id, name: f.name, category: 'wall', price: { currency: 'gold', amount: f.price } })),
  ];
}
