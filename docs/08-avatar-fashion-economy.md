# 08 — Personnalisation d'avatar, boutique mode & économie Or / Diamants

> ⚠️ **Prototype local (DEV).** Les soldes (5 000 🪙 / 100 💎) sont des **soldes de TEST** stockés sur l'appareil
> (`localStorage`). Aucun paiement réel n'existe, aucun fournisseur n'est connecté, aucune confirmation de paiement
> n'est simulée. Les échanges d'Or se font entre **deux comptes de test locaux** ; il n'y a pas de multijoueur.
> En production, soldes, prix, achats et échanges doivent être validés **par le serveur** (voir §6).

## 1. Modules (séparés)
| Domaine | Fichiers | Rôle |
|---|---|---|
| Catalogue mode (données) | `src/fashion/catalogue.ts`, `types.ts`, `schema.ts` | Tous les articles sont des **données** (`ItemDef` : slot, catégorie, prix, devise, rareté, rendu). Ajouter un article = ajouter une entrée ; `validateCatalogue` vérifie le schéma (testé). |
| Apparence (look) | `src/fashion/look.ts` | `Look {v, body, slots}` ; équiper / retirer, slots obligatoires, nettoyage, sérialisation. |
| Rendu de l'avatar | `src/render/avatar/custom/*` | `resolveLook` → `RenderSpec` → texture composée + morphs + pièces attachées aux os. |
| Studio / boutique (UI) | `src/fashion/FashionController.ts`, `src/ui/fashion/*` | Essayage, panier, achat, inventaire, équipé, échanges test, portefeuille. |
| Portefeuille Or | `src/economy/ledger.ts` (wallet `gold`) | Grand livre append-only, idempotent, jamais négatif. |
| Portefeuille Diamants | `src/economy/ledger.ts` (wallet `diamond`) | Grand livre **séparé** ; seuls `test_grant`, `dev_grant`, `iap_grant`, `purchase`, `refund` sont acceptés — tout transfert est refusé (`not_transferable`). |
| Achats | `src/economy/purchase.ts` | Devis par devise + paiement **atomique** multi-devises, idempotent (clé), refus des doublons. Les articles payés en 💎 sont marqués `bound` (liés au compte). |
| Échanges d'Or | `src/economy/trading.ts` | Machine à états + séquestre (§4). L'offre n'accepte que `{gold}`. |
| Récompenses | `src/economy/rewards.ts` | Gains d'Or en jouant, avec plafonds. |
| Service | `EconomyService.ts`, `LocalDevEconomy.ts`, `RemoteEconomy.ts` | Interface unique ; implémentation locale DEV aujourd'hui, client serveur (stub) demain. |
| Paiements futurs | `src/economy/payments/DiamondStore.ts` | Packs, `PaymentGateway`, `UnavailablePaymentGateway` (toujours indisponible). |

Aucune fonction de conversion Or ↔ Diamants n'existe (et un test le vérifie).

## 2. Ce qui est géométrie vs texture
- **Géométrie** : 20 morph targets du visage (formes de visage, formes d'yeux — globes, paupières et orbite —, nez, bouche, sourcils), coiffures (calottes/chignons d'origine transférés entre corps, coques de cuir chevelu buzz/afro/crête/chignon homme, rideaux carré/long, tubes queue-de-cheval/couettes), barbes (coques skinnées copiées de la peau du visage, suivent les expressions), bottes et montantes (coques de jambe skinnées), capuche et col fourrure, tous les accessoires (lunettes, boucles, colliers, écharpe, chapeaux ajustés à la coiffure, casque, sacs, montre).
- **Texture / couleur** : teint, couleur des yeux et des cheveux, couleurs et motifs des vêtements, manches courtes / shorts (zones repeintes couleur peau), maquillage, taches de rousseur, grain de beauté, imprimés, barbe de 3 jours.
- Limite : les vestes partagent la géométrie du torse d'origine (le haut du corps **est** la veste) ; elles se distinguent par texture/motif + capuche/col.

## 3. Gains d'Or (taux documentés)
| Source | Gain | Plafond |
|---|---|---|
| Récompense du jour | +150 🪙 | 1 fois / 20 h |
| Danser | +5 🪙 / 30 s | 120 🪙 / jour |
| Être assis (détente) | +2 🪙 / 30 s | 40 🪙 / jour |
| Visiter Yoo Plage | +25 🪙 | 1 fois / jour |
Les meubles et sols/murs se paient aussi en Or (même portefeuille).

## 4. Échange d'Or (machine à états)
```
open ──(offres modifiables ; toute modification annule les acceptations)──▶ A et B acceptent
  └─ à la 2e acceptation : l'Or offert est débité des deux comptes vers le SÉQUESTRE (trade_escrow) ──▶ locked
locked ──A et B confirment──▶ completed (trade_receive vers la contrepartie, en une seule opération)
open|locked ──refus/annulation──▶ rejected|cancelled (trade_release : remboursement du séquestre)
```
- Solde vérifié au verrouillage ; l'Or sous séquestre ne peut plus être dépensé ailleurs (pas de double dépense).
- Idempotence : chaque écriture est clé `(txId, kind)` ; rejouer une étape ne crédite jamais deux fois.
- Historique : `trade.log` + écritures du grand livre de chaque compte.
- UI : onglet **Échanges**, bannière « Mode test local : deux comptes de test sur cet appareil — aucun joueur en ligne ».

## 5. Flux d'achat
```
Toucher un article → essayage sur l'avatar (brouillon) → plusieurs articles = panier d'essayage
→ « Acheter la tenue » → récapitulatif (totaux 🪙 et 💎 séparés, soldes après achat)
→ checkout atomique (tout ou rien) → inventaire + look sauvegardé
Fermer avec des articles non achetés → choix : continuer / quitter sans acheter / acheter
```

## 6. Production (serveur autoritaire) — à faire
- `RemoteEconomy` décrit le contrat : `GET /economy/me`, `POST /economy/checkout`, `/economy/rewards/*`, `/trades/*`, `/diamonds/orders`. Chaque mutation porte une **Idempotency-Key** ; le client n'envoie jamais ni prix ni solde.
- Le serveur prix les articles depuis **son** catalogue, débite en transaction SQL, et tient les grands livres.
- Diamants : crédités **uniquement** par le webhook signé du fournisseur (ou vérification du reçu Apple/Google), idempotent sur l'identifiant du fournisseur. Remboursement → écriture `refund`.
- Récompenses : horloge et plafonds côté serveur (anti-triche).
- **Choix et connexion du fournisseur de paiement : nécessite l'accord du propriétaire.** Rien n'est connecté.

## 7. Bouton DEV
Portefeuille → bloc rouge « DEV — aucun paiement réel » : +50 💎 de test (max 500 au total), réinitialisation de l'économie de test. Absent en mode `remote` (`dev_only`).

## 8. Ajouter un article
1. Ajouter une entrée dans `CATALOGUE` (id, slot, catégorie, nom, prix/devise, rareté, `render`).
2. `npx vitest run` (validation du catalogue).
3. Régénérer les miniatures : `node tools/fashion/thumbs.mjs public/thumbs/fashion <id>` (serveur de dev lancé).
