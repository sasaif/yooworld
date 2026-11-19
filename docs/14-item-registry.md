# 14 — Item registry v1 (local, data only)

Approved by Alessandro on 2026-11-19 at 15:54 (Europe/Paris). This applies Owner Decisions v1.1 §2, §3 and §8, plus v1.2 "Item classification".

`src/registry/` is the authoritative list of item **definitions** for fashion, furniture and finishes. The existing catalogues (`src/fashion/catalogue.ts`, `src/data/furniture.ts`, `src/data/finishes.ts`) are unchanged and are **validated against** the registry in `tests/item-registry.test.ts`: identical id, name, category and price for every item, plus a frozen id and price baseline from 119643c (`tests/fixtures/item-prices-119643c.json`).

What this does **not** do: it does not activate or change trading, change balances, migrate coins, change save, storage or load code, change prices, remove items or change UI badges.

## Schema (`src/registry/types.ts`)
| field | meaning |
|---|---|
| `id` | stable id, identical to the catalogue. Finishes are keyed `floor:<id>` / `wall:<id>`, the same as their ownership key. |
| `kind` | `fashion` \| `furniture` \| `floor` \| `wall` |
| `name`, `category` | copied from the catalogue |
| `acquisition[]` | `free_base`, `starter_grant`, `shop_gold`, `shop_diamond` (reserved: `reward`, `event`, `achievement`) |
| `price` | `{currency, amount}` copied exactly; `null` = free (fashion without a price, finish at 0) |
| `classification` | `Free` \| `Gold` \| `Premium` \| `Rare` \| `LimitedEdition` \| `Seasonal` \| `Exclusive`. Épique/Légendaire are never a class. |
| `tradable` + `nonTradableReason` | default true; false only with a reason documented in `NON_TRADABLE_REASONS` |
| `maxSupply` | required for LimitedEdition, forbidden otherwise |
| `releaseConditions`, `reRelease` | `permanent` \| `may_return` \| `never` (`never` only for Limited, Exclusive or Seasonal) |
| `provenance` | placeholder. Per-instance provenance arrives with the inventory/instance model (TECH_PLAN §3). |
| `legacyRarity`, `labelStatus` | the current shop badge (informational) and whether its removal is approved (`remove_approved`) or awaits the owner (`owner_decision`) |
| `ownerDecision` | the open question on that row |
| `pendingBranch` | the item exists on another branch only (registered ahead so the combined build validates) |

## Defaults
- Premium (Diamond) items: `tradable=true`, for Gold only. Already-owned Premium rows keep `bound: true` in saves until `premium_unbind_v1` is approved (TECH_PLAN §4 F).
- Gold shop items: `tradable=true` (v1.1 default). Trading itself is not activated.
- Free base options: `tradable=false` (`free_base`).
- Starter apartment and starter inventory ids, plus the `oak` floor and `peach` wall: `tradable=false` (`starter_item`), applied to the whole definition until instances exist.
- Paid finishes: `tradable=false` (`finish_unlock`, a technical reason: they are apartment unlocks, not objects).
