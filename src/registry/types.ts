import type { Currency } from '../economy/money';
/**
 * YooWorld item registry v1 — schema (Owner Decisions v1.1 §3 + §8, v1.2 "Item classification").
 *
 * LOCAL / DATA ONLY. Nothing here activates trading, changes a balance, migrates coins, touches saves,
 * or changes a price. The registry is the authoritative list of item DEFINITIONS; the existing catalogues
 * (src/fashion/catalogue.ts, src/data/furniture.ts, src/data/finishes.ts) are validated against it
 * (see validate.ts and tests/item-registry.test.ts).
 */
export type RegistryKind = 'fashion' | 'furniture' | 'floor' | 'wall';

/** Official classes (v1.1 §3). "Épique"/"Légendaire" are NOT classes and can never be one. */
export type ItemClass = 'Free' | 'Gold' | 'Premium' | 'Rare' | 'LimitedEdition' | 'Seasonal' | 'Exclusive';
export const ITEM_CLASSES: readonly ItemClass[] = ['Free', 'Gold', 'Premium', 'Rare', 'LimitedEdition', 'Seasonal', 'Exclusive'];

/** How a player can get the item today. An item can have several (e.g. starter grant AND Gold shop). */
export type Acquisition = 'free_base' | 'starter_grant' | 'shop_gold' | 'shop_diamond' | 'reward' | 'event' | 'achievement';

/** v1.1 §3: Limited items promised as never re-released must never return; Seasonal may return if communicated. */
export type ReReleasePolicy = 'permanent' | 'may_return' | 'never';

/**
 * Documented reasons for tradable = false (v1.1 §2: "an item can be marked non-tradable only when there is
 * a clear product or technical reason ... explicitly defined in the item registry").
 */
export type NonTradableReason = 'starter_item' | 'free_base' | 'finish_unlock';
export const NON_TRADABLE_REASONS: Record<NonTradableReason, string> = {
  starter_item:
    'Owner decision v1.2 (2026-11-19): starter furniture and starter items are non-tradable by default. ' +
    'Applied to the whole definition until per-instance ownership exists (TECH_PLAN §3/§4), which means a ' +
    'shop-bought extra copy of the same id is also non-tradable for now (owner decision pending).',
  free_base:
    'Free base option owned by every account (no price). Owner-approved 2026-11-19 15:54: starter/free items are ' +
    'non-tradable by default — trading them is meaningless and farmable via new accounts.',
  finish_unlock:
    'Technical: a floor/wall finish is a one-time apartment unlock stored as `floor:<id>` / `wall:<id>`, not an ' +
    'inventory object, so it cannot be transferred. Whether finishes are in trading scope is an owner decision.',
};

/** Status of the CURRENT shop badge (common/rare/epic/legendary). UI badge changes are done by YW Art elsewhere. */
export type LabelStatus =
  | 'ok'                // badge is consistent with the official class (or there is none)
  | 'remove_approved'   // owner v1.2 approved removing it (Épique/Légendaire on unlimited items; starter TV/bear)
  | 'owner_decision';   // "Rare" on an unlimited shop item: needs an explicit owner decision, NOT decided here

/** Provenance is tracked per owned INSTANCE (future inventory model), not on the definition. Placeholder for now. */
export interface ProvenancePlaceholder { tracking: 'not_yet'; note: string }
export const PROVENANCE_PENDING: ProvenancePlaceholder = Object.freeze({
  tracking: 'not_yet',
  note: 'Per-instance provenance (who minted, when, through which tx, trade history) arrives with the server inventory / instance model (TECH_PLAN §3).',
}) as ProvenancePlaceholder;

export interface RegistryPrice { currency: Currency; amount: number }

export interface RegistryItem {
  /** Stable id — IDENTICAL to the existing catalogue id. Never rename (owned items / saved looks reference it). */
  id: string;
  kind: RegistryKind;
  name: string;
  /** Catalogue category (fashion ShopCategory, furniture Category, or 'floor'/'wall'). */
  category: string;
  acquisition: Acquisition[];
  /** Current price, copied exactly. null = free (fashion: no price; finishes: price 0). */
  price: RegistryPrice | null;
  classification: ItemClass;
  /** v1.1 §2: true by default; false only with a documented `nonTradableReason`. */
  tradable: boolean;
  nonTradableReason?: NonTradableReason;
  /** Only for LimitedEdition (required there, forbidden elsewhere). */
  maxSupply?: number;
  releaseConditions: string;
  reRelease: ReReleasePolicy;
  provenance: ProvenancePlaceholder;
  /** Badge shown in the shop when the registry was created (informational; not an official class). */
  legacyRarity: 'common' | 'rare' | 'epic' | 'legendary';
  labelStatus: LabelStatus;
  /** Present when an owner decision is pending on this row. */
  ownerDecision?: string;
  /** Item that exists only on another branch so far (registered ahead so the combined build validates). */
  pendingBranch?: string;
}

/** Registry key: fashion/furniture use the id; finishes use the existing ownership key `floor:<id>` / `wall:<id>`. */
export const registryKey = (i: Pick<RegistryItem, 'kind' | 'id'>) => (i.kind === 'floor' || i.kind === 'wall' ? `${i.kind}:${i.id}` : i.id);
