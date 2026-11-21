# Phase C — plan de mesure des coûts (préparé en Phase B, rien de mesuré sur Cloudflare/Neon)

> [MESURÉ] = exécuté localement ; [ESTIMATION] = calcul à partir de tarifs publics ; [PROPOSITION] = seuil / choix à
> valider ; [NON MESURÉ] = nécessite les comptes d'Alessandro. Tarifs à relire le jour de la mesure (ils changent).

## 1. Ce qu'on mesure
| Poste | Unité facturée | Source Phase C | Base locale existante |
|---|---|---|---|
| Durable Objects — durée | GB-s (128 Mo × temps actif) | GraphQL `durableObjectsPeriodicGroups.sum.activeTime` | `cost-harness.json` : salle réveillée tant qu'un joueur bouge, hibernation au repos [MESURÉ local] |
| DO — requêtes | requêtes (WS entrants hibernés 20:1, RPC, alarmes) | `durableObjectsInvocationsAdaptiveGroups.sum.requests` | 25 joueurs en mouvement : 18 360 msgs entrants / joueur-heure, 1 454 alarmes / joueur-heure [MESURÉ local] |
| DO — messages WS sortants | non facturés à l'unité aujourd'hui, mais CPU + egress | `durableObjectsPeriodicGroups.sum.outboundWebsocketMsgCount` | 27 000 / joueur-heure, ≈ 24 Mo [MESURÉ local] |
| DO — stockage SQLite | Go-mois + lignes lues/écrites | `durableObjectsStorageGroups.max.storedBytes` | chat 50 msgs/salle, bans, présence |
| Workers (API) | requêtes + ms CPU | `workersInvocationsAdaptive` (requests, cpuTimeP50/P99) | requêtes par session de jeu (ticket, sauvegardes, économie) à compter côté client |
| Hyperdrive | requêtes (inclus dans Workers Paid aujourd'hui) | `hyperdriveQueriesAdaptiveGroups` | 1 connexion pg par requête d'auth (pool max 1) [MESURÉ] |
| Neon compute | CU-heures (temps actif × taille) | API Neon `consumption_history` (compute_time_seconds, active_time_seconds) | — |
| Neon stockage | Go-mois + historique (PITR) | API Neon (synthetic_storage_size, written_data_bytes) | taille du dump local : `test-results/backup-restore.json` |
| R2 | Go-mois, opérations A/B | `r2StorageAdaptiveGroups`, `r2OperationsAdaptiveGroups` | 1 sauvegarde/jour × rétention 35 j |
| Egress / e-mail / Turnstile | selon fournisseur | factures | — |
Requête GraphQL prête : `infra/cost/cf-usage.graphql` (jeton API « Account Analytics: Read » uniquement).

## 2. Comment
1. **Cloudflare GraphQL** (source de vérité de facturation) : fenêtre exacte de chaque scénario (`$from`/`$to`),
   filtrée par `namespaceId` (RoomDO, DirectoryDO, TableDO, TradeDO, PresenceDO) et `scriptName`
   (`yoland-api-uat`). Délai d'ingestion : relire ≥ 15 min après la fin du scénario [PROPOSITION].
2. **metrics.emit** (nos compteurs applicatifs, déjà en place : `room.*`, `trade.settled`, `account.finalized`,
   `ops.check`, `http.internal_error`) → table `ops.metrics` via `runOpsCheck` toutes les 5 min. On y ajoute en
   Phase C, si nécessaire [PROPOSITION] : `player.session_seconds` (au départ d'une salle) pour le dénominateur
   « joueur-heure » mesuré côté serveur, indépendamment des scripts de charge.
3. **Neon** : API `GET /api/v2/consumption_history/projects?from=…&to=…&granularity=hourly` (clé API lecture
   d'Alessandro) avant/après chaque scénario.
4. **Charge** : réutiliser les clients de `test/e2e/cost.test.ts` / `resilience.test.ts` (WebSocket réels, tickets
   réels) pointés vers uat, comptes de test créés par script sur uat uniquement (jamais de données de production).

## 3. Formule par joueur-heure
```
PH  = Σ (secondes de présence en salle de chaque joueur) / 3600           (ops.metrics ou script de charge)
DO$ = (activeTime_s × 0,125 Go × prix_GBs) + (requêtes_DO / 1e6 × prix_Mreq) + stockage_DO
W$  = (requêtes_Worker / 1e6 × prix_Mreq_W) + (CPU_ms / 1e6 × prix_Mms)
N$  = (CU_h × prix_CUh) + (Go_mois × prix_Go) au prorata de la fenêtre
R2$ = (Go_mois × prix_Go_R2) + opérations A/B                               (quasi fixe, hors joueur)
coût / joueur-heure = (DO$ + W$ + N$_variable) / PH        ;  fixes (forfait Workers Paid, Neon plan, R2) à part
```
Prix unitaires : page tarifs du jour (Cloudflare DO/Workers, Neon), notés dans le fichier de résultats avec la date.
Rappel [ESTIMATION Phase B, DO seuls, borne haute] : 0,000586 $/joueur-heure à 100 % en mouvement, 0,000176 $ à
30 % en mouvement (`cost-harness.json`) — API, Neon, R2 et egress non inclus.

## 4. Scénarios (uat, une fenêtre horodatée chacun)
| # | Scénario | Durée | But |
|---|---|---|---|
| S1 | 1 salle × 25 joueurs, 100 % en mouvement | 15 min | borne haute DO (compare au harnais local) |
| S2 | 1 salle × 25 joueurs, 30 % en mouvement / 70 % immobiles | 15 min | profil « réaliste » [PROPOSITION 30 %] |
| S3 | 20 salles × 25 joueurs (500), profil S2 | 30 min | coût à l'échelle + Hyperdrive / Neon sous charge |
| S4 | 500 joueurs au repos (aucun message) | 30 min | hibernation : activeTime doit tendre vers 0 |
| S5 | tempête de reconnexion 500 + plafond WS 24 h simulé (`WS_MAX_LIFETIME_S=3600`) | 1 h | coût des reconnexions forcées |
| S6 | économie : 1 000 achats + 1 000 cadeaux + 100 échanges | 10 min | CPU Worker, requêtes Hyperdrive, Neon compute |
| S7 | job de rétention : 500 comptes échus | 1 cron | durée `finalize_deletions` (local : 50 en 31 ms) |

## 5. Seuils [PROPOSITION — à valider par Alessandro, décision d'argent]
- **Vert** : coût variable ≤ 0,001 $ / joueur-heure (toutes briques), S4 activeTime ≤ 1 % de S2.
- **Orange** : 0,001–0,003 $ → optimisations avant prod (tick adaptatif, delta-compression des états, batch des
  sauvegardes).
- **Rouge** : > 0,003 $ ou toute brique > 50 % du total inattendue → pas de prod, revue d'architecture.
- Neon : compute autosuspend vérifié (uat inactive → 0 CU-h la nuit). Hyperdrive : p95 latence requête ≤ 50 ms.
- Alerte budget Cloudflare + Neon configurée par Alessandro (montant à choisir par lui).

## 6. Où vont les chiffres
- `server/test-results/phase-c-cost/<date>-<scénario>.json` (brut GraphQL + Neon + compteurs + prix du jour),
  produit par le script de mesure ; **résumé** commité dans `docs/PHASE_C_COST_RESULTS.md` (tableau par scénario :
  MESURÉ vs ESTIMATION Phase B, écart, verdict vert/orange/rouge).
- Séries continues : `ops.metrics` (Postgres) ; tableau de bord hébergé = décision Phase C (aucun branché).
