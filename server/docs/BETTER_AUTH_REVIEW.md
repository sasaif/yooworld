# Better Auth — revue technique (Phase B, 2026-11-20)

> **DÉCISION (M4, 2026-11-20) : Better Auth 1.7.27 ADOPTÉ, version épinglée** — décision du directeur de projet
> sous délégation vérifiée des décisions techniques d'Alessandro. Étiquettes : [MESURÉ] = exécuté ici,
> [VÉRIFIÉ-WEB] = source publique lue le 2026-11-20, [NON VÉRIFIÉ] = pas encore testé.

## Règles d'exploitation (M4) — veille d'avis + montée de version sous 48 h
1. **Épinglage** : `"better-auth": "1.7.27"` exact dans `server/package.json` + `package-lock.json` committé ;
   `npm ci` partout (CI comprise). Toute montée de version = commit dédié + revue.
2. **Veille** (hebdomadaire, + abonnement « Watch → Security alerts » du dépôt `better-auth/better-auth` sur le compte
   GitHub d'Alessandro) : GitHub Security Advisories du dépôt, `npm audit --omit=dev` (déjà en CI), notes de version.
   Responsable : l'équipe technique ; trace écrite dans ce fichier (tableau « Journal de veille » ci-dessous).
3. **Règle des 48 h** : tout avis de gravité **haute ou critique** touchant le **cœur**, `twoFactor`, l'adaptateur
   Postgres ou la gestion des sessions/cookies → version corrigée testée et poussée **sous 48 h** après publication :
   `npm i better-auth@<x.y.z> --save-exact` → `npm run typecheck` → `npm run test:coverage` → `npm run test:e2e`
   (dont `account.test.ts` : codes de secours, révocation + fermeture WS, énumération, suppression) → déploiement uat
   → prod. Si aucune version corrigée n'existe : mitigation (désactiver la route concernée par configuration) et
   note d'incident. Gravité moyenne/basse sur ces composants : prochaine release (≤ 14 jours). Plugins non utilisés :
   pas d'action, juste la trace.
4. **Interdits** : `^`/`~` sur better-auth, `cookieCache`/secondary storage (cf. GHSA-fvxx-76fc-893x) sans nouvelle revue,
   plugins supplémentaires sans revue.

| Date | Source | Avis | Nous concerne | Action |
|---|---|---|---|---|
| 2026-11-20 | GHSA + npm audit | 30 avis 2026 relus (tableau ci-dessous) ; 0 vulnérabilité `npm audit` | non (tous corrigés ≤ 1.7.16) | aucune |

## Version
- `better-auth` **1.7.27**, épinglée exactement dans `server/package.json` (plus de `^`). C'est la `latest` npm du
  2026-11-20 [VÉRIFIÉ-WEB]. `npm audit --omit=dev` : 0 vulnérabilité [MESURÉ].
- Plugins utilisés : **aucun plugin externe** ; uniquement le cœur (`emailAndPassword`, `emailVerification`,
  `rateLimit` en base) et `twoFactor` (TOTP), adaptateur Postgres via `pg`.

## Avis de sécurité (GitHub Security Advisories du dépôt better-auth/better-auth) [VÉRIFIÉ-WEB]
30 avis publiés en 2026, dont des critiques. Ceux qui touchent le **cœur** sont tous corrigés en ≤ 1.7.16 :
| GHSA | Gravité | Sujet | Corrigé en | Nous concerne ? |
|---|---|---|---|---|
| GHSA-fvxx-76fc-893x | moyenne | sessions révoquées encore valides avec secondary storage / cookie cache | 1.7.16 | Non (cookieCache désactivé, pas de secondary storage) |
| GHSA-hwq2-v29r-p69r | moyenne | liens de changement d'e-mail restent valides | 1.7.16 | Non (changement d'e-mail non activé) |
| GHSA-9hm7-xhfp-cx58 | moyenne | OAuth : e-mail fournisseur non vérifié traité comme vérifié | 1.7.16 | Non (pas d'OAuth) |
| GHSA-2f9c-7xj7-gh55 | moyenne | OTP e-mail : course sur la limite d'essais | 1.7.16 | Non (pas d'OTP e-mail) |
| GHSA-q747-mqgr-4gh7 | haute | numéros de téléphone réclamés avant vérification | 1.7.16 | Non (pas de plugin phone) |
| GHSA-965c-763c-88jm | critique | état OAuth utilisable comme magic link | 1.7.7 | Non |
| GHSA-r4xp-prcw-77qf | haute | OAuth Proxy | 1.7.7 | Non |
Les autres avis critiques/hauts visent des plugins non utilisés (sso, scim, expo, electron, stripe, oauth-provider,
passkey). **Constat : cadence d'avis élevée** → politique proposée : version épinglée, veille GHSA hebdomadaire,
montée de version sous 48 h pour toute criticité haute/critique touchant le cœur ou `twoFactor`.

## Cookies / CSRF [MESURÉ, e2e `test/e2e/slice.test.ts`]
- Cookie de session `__Secure-better-auth.session_token` : `HttpOnly`, `Secure`, `SameSite=Lax`.
- Better Auth refuse une `Origin` étrangère sur ses routes (mesuré au spike A6) ; en plus, notre middleware refuse tout
  appel non-GET sur `/api/*` sans `Origin == APP_ORIGIN` (403 `bad_origin`, testé, y compris Origin absente).
- `trustedOrigins = [APP_ORIGIN]`, `baseURL` validé par le schéma d'environnement (https obligatoire hors local).

## Limites de débit [MESURÉ]
- Stockage en base (`auth.rateLimit`), IP depuis `cf-connecting-ip` uniquement.
- Connexion : 5/min/IP → 6e et 7e tentatives 429 ; une autre IP n'est pas affectée (testé).
- Inscription 5/h/IP, `verify-totp` 5/min/IP (configurés ; seul sign-in est testé e2e).
- Point d'attention : chaque requête d'auth écrit en base pour le compteur → coût/latence Postgres ; à mesurer en
  Phase C avec Hyperdrive.

## Compatibilité workerd [MESURÉ]
- Fonctionne sous `wrangler dev --local` (workerd) avec `nodejs_compat` et le driver `pg` : inscription, lien de
  vérification (boîte `auth.dev_mail` locale), connexion, `get-session`, activation TOTP, défi 2FA à la connexion.
- Une instance Better Auth **par requête** (pool `max: 1`, fermé via `waitUntil`) : pas de socket partagé entre
  requêtes (règle Workers). Coût : 1 connexion TCP Postgres par requête d'auth → **Hyperdrive requis en Phase C**.
- Base indisponible : les routes Better Auth répondent 503 + `Retry-After: 5` (testé, `resilience.test.ts`).

## Milestone 3 — les 3 tests qui conditionnent l'adoption [MESURÉ, `test/e2e/account.test.ts` → `test-results/auth-gaps.json`]
| Test | Résultat | Verdict |
|---|---|---|
| Codes de secours 2FA | 10 générés, stockés chiffrés (`storeBackupCodes: "encrypted"` par défaut, pas en clair en base) ; 1 usage → 9 restants ; réutilisation du même code → 401 ; code faux → 401 ; 2ᵉ code → 8. Route `/two-factor/verify-backup-code` limitée à 5/60 s. | PASS |
| Révocation de session | Session révoquée → 401 dès la 1ʳᵉ requête (≈24 ms) ; émission de ticket WS → 401 ; sign-out → 401 ; reset de mot de passe → toutes les sessions révoquées (`revokeSessionsOnPasswordReset`) ; jeton de reset à usage unique (30 min). | PASS (HTTP) ; WS : voir M4 |
| Énumération de comptes | Corps de réponse identiques compte existant / inconnu pour sign-in, sign-up (vérification e-mail obligatoire → utilisateur synthétique) et request-password-reset. Temps, N = 50 essais entrelacés : sign-in p50 77,5 / 76,8 ms (p95 120 / 99), sign-up p50 72,8 / 73,4 ms (p95 93 / 88), reset p50 20,2 / 21,2 ms (p95 31 / 39) — écart de p50 ≤ 1 ms. | PASS |

**Révocation des WebSockets — FAIT en M4 (les deux mécanismes)** [MESURÉ, `account.test.ts`, `lifetime.test.ts`] :
- (i) **Fermeture immédiate (4401 `revoked`)** : `databaseHooks.session.delete.after` (vérifié dans le code de
  1.7.27 : `deleteSession`, `deleteSessions`, `deleteUserSessions` passent tous par `deleteWithHooks` /
  `deleteManyWithHooks`, donc sign-out, revoke-session(s), revoke-other-sessions, reset de mot de passe et nettoyage
  d'expiration déclenchent le hook pour chaque session). Les tickets portent l'id de session (`sid`, signé) ; un
  `PresenceDO` par joueur indexe (session, salle) à l'émission du ticket ; le hook appelle `RoomDO.revoke(joueur, sid)`.
  `/api/me/delete` révoque toutes les sessions + ferme tout. Le `PresenceDO` garde une pierre tombale (10 min) des
  sessions révoquées et l'horodatage « tout révoqué » : un ticket signé juste avant la révocation (valide 30 s) est
  refusé à l'ouverture (401 `session_revoked`). Mesuré : socket fermé ≤ 3 s après revoke-other-sessions (attente du
  test ; temps réel noté dans `auth-gaps.json`), sign-out, reset → 4401 ; une autre session du même joueur reste
  connectée. Fenêtre résiduelle [ESTIMATION] : quelques ms entre l'admission du ticket et l'attachement du socket.
  Un échec du hook est journalisé, ne bloque jamais la révocation HTTP.
- (ii) **Durée de vie bornée (4402 `lifetime`)** : `WS_MAX_LIFETIME_S` (défaut 86400 = 24 h ; local ≥ 2 s,
  uat/prod ≥ 3600 s ; max 7 j). Échéance par socket, alarme de la salle (partagée avec le tick 10 Hz), plus contrôle à
  chaque message. Le client (`Reconnector`) traite 4402 comme réessayable : nouveau ticket via
  `/api/rooms/*/join` (session vérifiée à ce moment-là). Mesuré avec 3 s : fermeture à ≈ 2,9–3,0 s, les pairs reçoivent
  `left` (reason `lifetime`), la reconnexion avec un nouveau ticket fonctionne, l'ancien ticket est refusé.

## Suppression / export de compte — politique (a) décidée [MESURÉ, `test/db/account-grace.test.ts`, `account.test.ts`]
- **Demande** `POST /api/me/delete` (session < 10 min + mot de passe + `confirm: "DELETE"`) → `eco.close_account` :
  compte fermé, `deletion_due_at = now + account.delete_grace_days` (30, clé de config `eco.config`), échanges ouverts
  annulés (escrow rendu), activités terminées, événements possédés annulés, sanctions de gel conservées
  (`frozen_before_close`). Toutes les sessions supprimées, tous les WebSockets fermés (4401). **Identifiants conservés
  pendant la grâce** ; sauvegardes conservées.
- **Pendant la grâce** : connexion possible ; `GET /api/me` (état `pending_deletion` + date), `GET /api/me/export` et
  `POST /api/me/restore` autorisés, tout le reste → 403 `account_pending_deletion` (les fonctions SQL refusent aussi).
  `restore` rétablit le compte (gel antérieur restauré). Audit `account_deletion_requested` / `account_restored`.
- **Fin de grâce** (job planifié : `runOpsCheck` = `scheduled()` en Phase C, `/dev/ops/check` en local) :
  `eco.finalize_deletions(50)` (savepoint par compte) → objets → joueur SYSTÈME `00000000-…` (`item_moves` raison
  `account_deleted`) ou révoqués si `account.sweep_items_to_system = 0` ; soldes → **une transaction de grand livre**
  `account_sweep` vers le portefeuille système `sink:account_closed` ; sauvegardes, membres d'événements, blocages,
  confidentialité effacés ; titres d'événements → `[supprimé]` ; audit `account_finalized` (acteur `system:retention`).
  Puis côté auth (rôle `app_auth`) : e-mail `deleted+<id>@deleted.invalid`, nom `deleted`, image nulle, sessions /
  comptes / 2FA / vérifications supprimés → `eco.mark_auth_erased` (audit `account_auth_erased`).
- Grand livre : lignes existantes inchangées (empreinte md5 identique avant/après), lignes pseudonymes (uuid seul),
  réconciliation 0, chaîne d'audit intacte (0 rupture), e-mail réutilisable. Mesuré : 1 compte finalisé en 3 ms,
  lot de 50 en 31 ms (Postgres local).
- `GET /api/me/export` : JSON (compte sans hash/jetons/secret 2FA + `eco.export_player`), `no-store`, pièce jointe.

## Bloquants / points ouverts avant adoption
1. **Fournisseur d'e-mail** absent (vérification d'adresse, reset) : `sendVerificationEmail` / `sendResetPassword`
   lèvent une erreur hors local. Phase C : compte d'Alessandro (ex. Resend), domaine + SPF/DKIM.
2. **Hyperdrive / pooling** pour Neon (latence et nombre de connexions) — non testé (pas de compte).
3. ~~Déconnexion des WebSockets ouverts à la révocation~~ — fait en M4 (voir ci-dessus).
4. Fraîcheur de session admin : heuristique `session.createdAt ≥ user.updatedAt` (fail-closed) ; une vraie
   « step-up » 2FA par action admin serait plus robuste (proposition).
5. Turnstile : crochet prêt (`TURNSTILE_MODE`), clé réelle requise en uat/prod (Phase C).

## Statut
ADOPTÉ (1.7.27 épinglée). Conditions restantes pour la Phase C : Hyperdrive, fournisseur e-mail + domaine
(paramètres en attente d'Alessandro), clé Turnstile — voir `docs/PHASE_C_RUNBOOK.md`.
