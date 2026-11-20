# Phase C — runbook + infrastructure-as-code (préparé en Phase B, RIEN de créé)

> Étiquettes : [FAIT] = fichier présent dans le dépôt ; [MESURÉ] = exécuté localement ; [NON MESURÉ] = ne peut être
> exécuté qu'avec les comptes d'Alessandro ; [PROPOSITION] = choix à valider. **Alessandro possède tous les comptes.**
> Aucun script ci-dessous ne crée quoi que ce soit sans `--apply` exécuté par lui, connecté à SES comptes.
> Paramètres encore en attente d'Alessandro : **fournisseur d'e-mail** et **domaine** (`EMAIL_PROVIDER`,
> `*_EMAIL_FROM`, `*_API_HOST`, `*_APP_HOST`).

## 0. Fichiers [FAIT]
| Fichier | Rôle |
|---|---|
| `infra/phase-c.params.example` | Paramètres non secrets (ids, hôtes) → copier en `server/.local/phase-c.params` (ignoré par git) |
| `infra/cloudflare/wrangler.phase-c.template.jsonc` | envs uat/prod : routes, vars, Hyperdrive (1 config par rôle), crons `*/5`, DO + migrations v1–v3 |
| `infra/cloudflare/render-wrangler.mjs` | rend le gabarit → `.local/wrangler.phase-c.jsonc` ; refuse paramètres absents/invalides |
| `infra/cloudflare/hyperdrive.sh` | 3 configs Hyperdrive par env (app_api / app_auth / admin_ops), cache désactivé ; dry-run par défaut |
| `infra/neon/setup.sh` | projet Neon, branche `uat`, migrations, mots de passe des rôles ; dry-run par défaut |
| `infra/neon/migrate-url.mjs` | migrations vers une URL (garde-fous env/sslmode/prod) |
| `infra/neon/setup-roles.sql` | mots de passe par env + assertions de moindre privilège |
| `.github/workflows/backup-r2.yml` | sauvegarde pg_dump → age → R2 + exercice de restauration (B4) ; **manuel uniquement**, inerte |

## 1. Comptes à créer par Alessandro (tous avec 2FA) — étape par étape
Ordre conseillé ; chaque compte : e-mail d'Alessandro, mot de passe unique (gestionnaire de mots de passe), **2FA
TOTP** (appli d'authentification) + **codes de secours imprimés/stockés hors ligne**, pas de SMS si évitable.
1. **Cloudflare** (dash.cloudflare.com → Sign up). Profil → Authentication → *Two-Factor Authentication* → TOTP →
   noter les codes de secours. Ajouter le moyen de paiement seulement quand le plan Workers Paid est requis
   (Durable Objects SQLite : disponible sur le plan gratuit avec limites ; Hyperdrive et charge réelle → **Workers Paid,
   5 $/mois [ESTIMATION, tarif public à revérifier le jour J]** — décision d'argent d'Alessandro).
   Noter l'**Account ID** (barre latérale droite d'un domaine / Workers) → `CF_ACCOUNT_ID`.
2. **Neon** (console.neon.tech → Sign up avec e-mail, pas via GitHub pour séparer les risques). Account settings →
   *Two-factor authentication* → activer. Plan gratuit pour uat ; prod → plan payant selon la mesure (§ coût).
3. **Domaine** (registrar au choix d'Alessandro ; le plus simple : Cloudflare Registrar dans le même compte) →
   2FA du registrar + verrou de transfert. **EN ATTENTE** : nom de domaine.
4. **Fournisseur d'e-mail** (ex. Resend / Postmark / SES — **EN ATTENTE**) : compte + 2FA, domaine d'envoi vérifié
   (SPF, DKIM, DMARC `p=quarantine`), clé API restreinte à « envoi » → secret `EMAIL_API_KEY`.
5. **Cloudflare Turnstile** (même compte Cloudflare → Turnstile → Add site, hôtes uat + prod) → `TURNSTILE_SECRET`
   par env (site key côté client).
6. **GitHub** (compte d'Alessandro, propriétaire du dépôt) : 2FA déjà requise par GitHub ; créer les
   *Environments* `backup-uat`, `backup-prod`, `backup-restore-drill` (ce dernier avec **Required reviewer =
   Alessandro**), protection de branche `main`/`uat` (revue obligatoire, pas de force-push).
7. **age** (local, hors ligne) : `age-keygen -o yoland-backup-owner.key` sur une machine d'Alessandro ; la clé privée
   reste hors ligne (coffre / clé USB chiffrée) ; seule la clé publique va dans `AGE_RECIPIENTS`. Une 2ᵉ paire
   « drill » sert à l'exercice de restauration automatique (clé privée dans l'environnement protégé
   `backup-restore-drill`). [PROPOSITION] : faire tourner la paire drill tous les 90 jours.

## 2. Neon (par environnement)
```bash
cd server
infra/neon/setup.sh create-project prod            # dry-run : affiche la commande neonctl
infra/neon/setup.sh create-project prod --apply    # Alessandro, après `npx neonctl auth`
export NEON_PROJECT_ID=...                         # sortie précédente
infra/neon/setup.sh create-uat-branch uat --apply  # branche uat séparée (rôles avec mots de passe distincts)
NEON_OWNER_URL='postgres://neondb_owner:…@<host>/neondb?sslmode=require' infra/neon/setup.sh migrate uat --apply
APP_API_PW=… APP_AUTH_PW=… APP_RW_PW=… ADMIN_OPS_PW=… BACKUP_RO_PW=… REPORTING_RO_PW=… MIGRATOR_PW=… \
  NEON_OWNER_URL=… infra/neon/setup.sh roles uat --apply
```
Rôles (de `0001_roles.sql`) : `eco_owner` NOLOGIN propriétaire ; `app_api` (EXECUTE sur liste blanche),
`app_auth` (schéma auth seul), `app_rw`, `admin_ops`, `reporting_ro`, `backup_ro` (pg_read_all_data), `migrator`
(DDL CI seulement, membre d'`eco_owner`, 2 connexions max). `setup-roles.sql` échoue si un rôle applicatif est
superuser / createrole / bypassrls ou membre d'`eco_owner`. Prod : `migrate-url.mjs` exige `--i-am-alessandro`.
[MESURÉ, local] `migrate-url.mjs` sur une base locale vierge (`YOLAND_ENV=local --allow-loopback`) : 13 migrations
appliquées, 2ᵉ passage = rien à faire ; refus vérifiés : uat sur loopback, uat avec « prod » dans l'URL, prod sans
`--i-am-alessandro`. `setup-roles.sql` rejoué dans une transaction annulée (psql absent ici → variables substituées) :
chemin nominal « roles ok », et refus si un rôle applicatif est membre d'`eco_owner`. `hyperdrive.sh` / `setup.sh`
en dry-run : commandes affichées, mots de passe masqués, garde « uat ≠ prod ». [NON MESURÉ] contre Neon / Cloudflare.

## 3. Hyperdrive + Worker
```bash
NEON_HOST=… NEON_DB=neondb APP_API_PW=… APP_AUTH_PW=… ADMIN_OPS_PW=… infra/cloudflare/hyperdrive.sh uat          # dry-run
… infra/cloudflare/hyperdrive.sh uat --apply                                                                       # Alessandro
cp infra/phase-c.params.example .local/phase-c.params   # remplir ids + hôtes
node infra/cloudflare/render-wrangler.mjs .local/phase-c.params
npx wrangler deploy -c .local/wrangler.phase-c.jsonc --env uat --dry-run --outdir .local/dry
```
**Écart de code à combler en Phase C [PROPOSITION, non construit]** : le Worker lit aujourd'hui `DATABASE_URL` /
`AUTH_DATABASE_URL` / `ADMIN_DATABASE_URL` (secrets). Avec Hyperdrive, il faudra prendre
`env.HD_API.connectionString` (etc.) lorsqu'un binding est présent, et adapter le schéma d'environnement (l'hôte
Hyperdrive n'a pas `sslmode=require`). Petit changement, mais non testable sans compte → hors Phase B.
Crons : `*/5 * * * *` → `scheduled()` = `runOpsCheck` (alertes, réconciliation, purge métriques, **job de rétention**
`finalize_deletions` + effacement auth). Migrations DO : v1 (RoomDO, DirectoryDO, TableDO), v2 (TradeDO),
v3 (PresenceDO) — déployées dans l'ordre, jamais réécrites.

## 4. Secrets par environnement (qui crée quoi)
Tous créés par **Alessandro** (ou sous sa supervision) : `npx wrangler secret put <NOM> --env <uat|prod>` ; jamais
dans git ; valeurs différentes entre uat et prod ; générées par `openssl rand -base64 48` sauf mention.
| Secret | uat | prod | Créé par / source | Vérifié par |
|---|---|---|---|---|
| `DATABASE_URL` (app_api) | ✓ | ✓ | Alessandro — mot de passe de `setup-roles.sql` (ou Hyperdrive, §3) | `validateEnv` (rôle, sslmode, pas « prod » en uat) |
| `AUTH_DATABASE_URL` (app_auth) | ✓ | ✓ | idem | idem |
| `ADMIN_DATABASE_URL` (admin_ops) | ✓ | ✓ | idem | idem |
| `BETTER_AUTH_SECRET` | ✓ | ✓ | Alessandro, `openssl rand` | ≥ 32 car., ≠ autres secrets, pas de mot « dev/example » |
| `TICKET_SECRET` | ✓ | ✓ | idem | idem |
| `RESULT_SECRET` | ✓ | ✓ | idem | idem |
| `TURNSTILE_SECRET` | ✓ | ✓ | Cloudflare Turnstile (§1.5) | `validateEnv` (mode turnstile obligatoire) |
| `EMAIL_API_KEY` | ✓ | ✓ | fournisseur e-mail (**EN ATTENTE**) | test d'envoi uat |
| vars `WS_MAX_LIFETIME_S` | 86400 | 86400 | gabarit | `validateEnv` (≥ 3600 hors local) |
| GitHub `backup-<env>` : `BACKUP_DATABASE_URL` (backup_ro), `AGE_RECIPIENTS`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` (jeton R2 limité au bucket, écriture) | ✓ | ✓ | Alessandro | 1ʳᵉ exécution manuelle |
| GitHub `backup-restore-drill` : `AGE_DRILL_IDENTITY`, jeton R2 **lecture seule** | — | ✓ | Alessandro (relecteur obligatoire) | exercice B4 |
Rotation [PROPOSITION] : secrets applicatifs 180 j (et immédiatement en cas de fuite) ; `BETTER_AUTH_SECRET` tourne
avec déconnexion générale acceptée.

## 5. Sauvegardes R2 (B4)
Bucket R2 `yoland-backups-<env>` (Alessandro), règle de cycle de vie 35 jours [PROPOSITION], **pas** d'accès public.
Workflow `backup-r2.yml` : `workflow_dispatch` seul + saisie `RUN-BACKUP` ; pg_dump 17 (`-Fc`, rôle `backup_ro`) →
age (destinataires seulement) → R2 ; job `restore-drill` (approbation d'Alessandro) : téléchargement en lecture seule,
déchiffrement avec la clé drill, `0001_roles.sql` puis `pg_restore` dans un Postgres 17 jetable, vérifications
réconciliation = 0, chaîne d'audit intacte, comptes ledger/audit identiques. Programmation (`schedule:` quotidien)
ajoutée **seulement** après un premier passage manuel réussi. [NON MESURÉ] (pas de compte, pas de pg_dump ici) ;
le même flux est [MESURÉ] localement avec dump COPY + émulateur S3 (`test/backup`).

## 6. Ordre de mise en service uat → prod
1. Comptes §1 → 2. Neon §2 (uat) → 3. Hyperdrive + secrets uat §3–4 → 4. `wrangler deploy --env uat` (Alessandro) →
5. tests de fumée uat (inscription + e-mail, 2FA, salle, échange, suppression/restauration, cron visible dans les logs)
→ 6. mesures de coût (`docs/PHASE_C_COST_PLAN.md`) → 7. sauvegarde + exercice B4 → 8. décision prod d'Alessandro.
