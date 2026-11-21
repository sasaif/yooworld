# Phase C — runbook + infrastructure-as-code (uat CRÉÉ le 20/11/2026, prod : RIEN de créé)

> **État réel uat : voir § 7.** Les §§ 1–6 décrivent la procédure ; la prod n'existe pas.

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
**Bindings Hyperdrive [FAIT, MESURÉ en uat]** : `HD_API` / `HD_AUTH` / `HD_ADMIN` remplacent `DATABASE_URL` /
`AUTH_DATABASE_URL` / `ADMIN_DATABASE_URL` quand ils sont présents (`envSchema.ts`, tests `test/unit/phase-c-uat-env.test.ts`).
[MESURÉ] l'URL fournie par Cloudflare n'a ni le rôle d'origine comme utilisateur ni l'hôte Neon : les règles d'URL ne
s'appliquent pas aux bindings ; le rôle est fixé par la config Hyperdrive (une par rôle) et `/api/health/db` renvoie le
rôle effectif (`app_api` mesuré). Refusés en local ; une URL `*.hyperdrive.local` écrite à la main est refusée.
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

## 7. uat — ressources réelles (créées le 20/11/2026, compte YoLand) [MESURÉ]
Aucun secret ici. Valeurs secrètes : `server/.local/uat.env` sur la box (600, ignoré par git) → **à copier dans le
gestionnaire de mots de passe d'Alessandro**. Rien de nommé « prod » n'a été créé ; aucun environnement prod déployé.

| Ressource | Valeur |
|---|---|
| Neon org / projet | `org-icy-cake-37269234` / `spring-recipe-02836917` « Yoland », aws-eu-central-1, PG 18 |
| Neon branche uat | `uat` = `br-rough-scene-bgxojamf` (enfant de la branche par défaut `production` `br-wandering-truth-bg4tcgj8`, **laissée vide et intacte**) |
| Neon endpoint uat | `ep-patient-dream-bgtymaii` (`ep-patient-dream-bgtymaii.c-9.eu-central-1.aws.neon.tech`), autoscaling max 1 CU |
| Base | `yoland` (propriétaire `neondb_owner`), `eco.env` = `uat`, 13 migrations |
| Rôles | `eco_owner` (NOLOGIN), `app_api`, `app_auth`, `app_rw`, `admin_ops`, `reporting_ro`, `backup_ro`, `migrator` — aucun superuser / createrole / bypassrls ; mots de passe uat neufs |
| Cloudflare compte | `9a7873168d77930d42e6b1183b338b2b` (YoLand) — plan gratuit |
| Sous-domaine workers.dev | `yoland` (créé par API) |
| Hyperdrive (cache désactivé) | `yoland-uat-api` `963510e5f39c4e20a4df414383fe6183` (app_api) · `yoland-uat-auth` `11f0acd4732f4a45ab42153c54e91789` (app_auth) · `yoland-uat-admin` `33bf6d98204a477091d51bd6375c6230` (admin_ops) |
| Worker | `yoland-api-uat` → **https://yoland-api-uat.yoland.workers.dev** ; config `infra/cloudflare/wrangler.uat.jsonc` (uat seul, pas d'env prod) ; DO RoomDO/DirectoryDO/TableDO/TradeDO/PresenceDO/OutboxDO (migrations v1–v4) ; cron `*/5 * * * *` |
| Secrets Worker | `BETTER_AUTH_SECRET`, `TICKET_SECRET`, `RESULT_SECRET` (`wrangler secret bulk`, neufs, ≠ local), `QA_OUTBOX_TOKEN` (QA outbox) |
| R2 | bucket **`yoland-backups-uat`** (créé le 20/11/2026 23:30 Paris après activation de R2 par Alessandro) : classe Standard, emplacement ENAM (aucun indice de région donné), juridiction par défaut, accès public r2.dev **désactivé**, aucune règle de cycle de vie ajoutée (seule la règle par défaut de Cloudflare : abandon des envois multipart après 7 jours), aucune option payante. Objets sous `uat/AAAA-MM-JJ/…dump.age`, chiffrés age |

**Dérogations uat (refusées en prod par `envSchema`, tests à l'appui)** :
- `TURNSTILE_MODE=fake` : seul le jeton public `local-fake-pass` passe ; l'inscription uat n'est **pas** protégée contre
  les robots. Refusé en prod par le schéma et, en plus, par `makeVerifier` (défense en profondeur). Limite d'inscription
  inchangée : **5 / heure / IP** (`AUTH_RATE_RULES`, testée).
- `EMAIL_MODE=capture` (décision du directeur, délégation d'Alessandro, 20/11/2026) : les e-mails de vérification /
  réinitialisation ne sont pas envoyés ; ils sont gardés **15 min** dans le Durable Object `OutboxDO` (instance
  `uat:qa-outbox`, purge à chaque appel + alarme, 200 messages max) et lisibles par la QA :
  `GET /qa/outbox?to=<email>` avec `Authorization: Bearer <QA_OUTBOX_TOKEN>` (ou `x-qa-token`), comparaison à temps
  constant ; 401 si jeton absent/faux ; **404 dès que le mode capture est éteint** (et toujours hors uat). Jeton :
  secret Worker `QA_OUTBOX_TOKEN` ; copie pour la QA sur la box dans `/workspace/games-3d/yooworld/qa/secrets/uat_qa_outbox_token`
  (600, hors dépôt). Pas de Resend, pas de domaine. (`EMAIL_MODE=disabled` reste possible en uat.)
- `APP_ORIGIN` = l'URL de l'API (pas encore de front uat).
- `GET /version` → `{ env, sha }` : commit déployé (`wrangler deploy … --var GIT_SHA:$(git rev-parse HEAD)`), sans secret.
- Durable Objects : migration **v4** = `OutboxDO` (après v1–v3, jamais réécrites).

**Particularités Neon (Postgres géré)** :
- `neondb_owner` n'est pas superuser → `migrate-url.mjs` retire `NOSUPERUSER` de `0001` (fichier inchangé) et pose
  `createrole_self_grant = 'set, inherit'` (PG16+) pour obtenir SET sur les rôles qu'il crée ;
- `setup-roles.sql` : `NOSUPERUSER` retiré (vérifié par les assertions) ; exécuté sans psql par `infra/neon/apply-roles.mjs` ;
- depuis la box, TCP 5432 est inaccessible : pilote WebSocket Neon (443) ; la restauration y utilise l'encodage JSON
  (`dumpWith(c, { via: 'json' })`) et, sans superuser, désactive les triggers USER table par table et charge dans
  l'ordre des clés étrangères (`fkOrder`).

**Fumée uat** (`infra/smoke/uat-smoke.mjs`) : résultats dans le rapport du 20/11/2026.

**Exercice de sauvegarde uat avec R2 [MESURÉ, 20/11/2026 23:31 Paris]** (`infra/neon/uat-backup-drill.mjs`) : dump de la
branche uat (rôle `backup_ro`, 48 tables, 78 lignes, 20 445 o) → age (clé X25519 éphémère, en mémoire seulement) →
envoi R2 `uat/2026-11-20/yoland-uat-1795213857381.dump.age` (20 645 o, 715 ms) → téléchargement (275 ms, sha256
identique, en-tête age, aucun texte en clair, une autre clé ne déchiffre pas) → déchiffrement identique → branche
scratch `scratch-restore-202611202230` + base neuve → 13 migrations → restauration (≈ 32 s) → **0 différence**
(empreinte md5 du contenu trié de chacune des 48 tables, source = restauré ; comptes de lignes égaux), réconciliation 0,
chaîne d'audit intacte → branche scratch supprimée (restent `uat` et `production`).
Accès R2 : via l'API Cloudflare avec le jeton existant (Workers R2 Storage Edit). **Aucune paire de clés S3 créée** : le
jeton ne peut pas créer de jetons (API 9109). Pour le workflow GitHub `backup-r2.yml` (S3/SigV4), Alessandro doit créer
un jeton R2 « Object Read & Write » limité au bucket `yoland-backups-uat` (et un jeton lecture seule pour l'exercice).
[DÉCISION 20/11, directeur technique] pour la prod : bucket R2 en juridiction **EU** (RGPD, données personnelles ; Neon est à Francfort). Le bucket uat en ENAM reste OK (données de test). Les jetons R2 S3 pour `backup-r2.yml` seront demandés à Alessandro lors de la préparation de la prod.

**Reste pour la prod** : décision d'Alessandro ; bucket R2 prod (juridiction EU, décidée) + jeton R2 limité ; domaine + Turnstile + fournisseur
d'e-mail (puis `TURNSTILE_MODE=turnstile`, `EMAIL_MODE=provider` câblé) ; branche/base prod Neon et mots de passe prod
distincts ; configs Hyperdrive prod ; Workers Paid si la charge l'exige (décision d'argent) ; `migrate-url.mjs --i-am-alessandro`.

**BUG-U5 (QA uat 20/11) — fermeture WS après révocation [MESURÉ, 21/11/2026 00:05–00:11 Paris, `c95674a`]** :
le hook Better Auth `session.delete.after` attend la diffusion PRESENCE → ROOM DO **dans** la requête sign-out /
revoke-session(s) / revoke-other-sessions, avant la réponse (pas de poll, pas de cron) ; la réponse porte
`x-ws-revoked: sessions=…;rooms=…;closed=…;ms=…`. `infra/smoke/uat-revocation.mjs`, 5 répétitions en ligne, seuil 2 s,
**PASS** — trame `session_revoked` puis trame de fermeture 4401 reçues (client `ws`), depuis le début de la requête :
sign-out 859/949/975 ms (min/médiane/max), revoke-sessions 839/872/930, revoke-other-sessions 921/931/995, socket
n'ayant jamais émis 877/928/960. Les 11–17 s de la QA viennent du **client** : `WebSocket` natif de Node (undici)
sur un socket qui n'a jamais rien envoyé reçoit la trame de fermeture en < 1 s (`readyState` = 2 CLOSING, envois
ignorés, aucun message serveur ensuite) mais ne déclenche `onclose` qu'à la fermeture TCP par le bord Cloudflare,
≈ 11 s plus tard (mesuré 10 857/10 966/11 033 ms) ; même client contre un serveur `ws` local : 314 ms ; dès que le
client a envoyé une trame (le jeu envoie un mouvement à l'arrivée) : < 1 s. Le serveur ne traite plus rien du socket
après la trame. e2e workerd (`test/e2e/account.test.ts`, 3 × 3) : 23–48 ms, seuil 2 s.

**U7 — lien de vérification réutilisé [MESURÉ en ligne]** : 302 vers `/?status=already_verified`, **aucun Set-Cookie**,
aucune session (autoSignIn désactivé ; e2e : nombre de sessions inchangé). Le raccourci n'est pris que si la
signature HS256 et l'expiration du jeton sont valides (pas de sondage d'adresses) ; un jeton falsifié va à Better Auth
→ `?error=INVALID_TOKEN` ; pas de redirection hors site.
