# Better Auth — revue technique (Phase B, 2026-11-20)

> Livrable de revue. **La décision d'adoption appartient à Alessandro.** Étiquettes : [MESURÉ] = exécuté ici,
> [VÉRIFIÉ-WEB] = source publique lue le 2026-11-20, [NON VÉRIFIÉ] = pas encore testé.

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
| Révocation de session | Session révoquée → 401 dès la 1ʳᵉ requête (≈24 ms) ; émission de ticket WS → 401 ; sign-out → 401 ; reset de mot de passe → toutes les sessions révoquées (`revokeSessionsOnPasswordReset`) ; jeton de reset à usage unique (30 min). | PASS (HTTP) — limite ci-dessous |
| Énumération de comptes | Corps de réponse identiques compte existant / inconnu pour sign-in, sign-up (vérification e-mail obligatoire → utilisateur synthétique) et request-password-reset. Temps, N = 50 essais entrelacés : sign-in p50 77,5 / 76,8 ms (p95 120 / 99), sign-up p50 72,8 / 73,4 ms (p95 93 / 88), reset p50 20,2 / 21,2 ms (p95 31 / 39) — écart de p50 ≤ 1 ms. | PASS |

**Limite (révocation)** : un WebSocket déjà ouvert reste connecté après révocation (le ticket n'est vérifié qu'à
l'ouverture). [PROPOSITION] Phase C : hook `databaseHooks.session.delete.after` (ou bannissement) → appel RPC
`disconnect(player)` aux RoomDO où le joueur est présent (index de présence par joueur), ou durée de vie WS bornée
(reconnexion forcée toutes les N minutes avec nouveau ticket). Non bloquant pour l'adoption.

## Suppression / export de compte [MESURÉ]
- `POST /api/me/delete` (session < 10 min + mot de passe) : `eco.close_account` (échanges ouverts annulés,
  sauvegardes/blocages/confidentialité effacés, événements possédés annulés) + anonymisation auth
  (`deleted+<id>@deleted.invalid`, sessions/comptes/2FA supprimés). Le grand livre reste append-only : +2 lignes
  (annulation de l'échange), 0 ligne supprimée, réconciliation à 0, chaîne d'audit intacte ; l'e-mail est réutilisable.
- `GET /api/me/export` : JSON (compte sans hash/jetons/secret 2FA + `eco.export_player`), `no-store`, pièce jointe.
- **Solde et objets du compte supprimé** : actuellement GELÉS sur place (aucune écriture). Options [PROPOSITION,
  décision Alessandro] : (a) délai de grâce 30 j puis transfert vers un portefeuille système par transaction de
  grand livre ; (b) transfert immédiat ; (c) objets révoqués / retournés au stock. Recommandation : (a).

## Bloquants / points ouverts avant adoption
1. **Fournisseur d'e-mail** absent (vérification d'adresse, reset) : `sendVerificationEmail` / `sendResetPassword`
   lèvent une erreur hors local. Phase C : compte d'Alessandro (ex. Resend), domaine + SPF/DKIM.
2. **Hyperdrive / pooling** pour Neon (latence et nombre de connexions) — non testé (pas de compte).
3. Déconnexion des WebSockets ouverts à la révocation — voir limite ci-dessus.
4. Fraîcheur de session admin : heuristique `session.createdAt ≥ user.updatedAt` (fail-closed) ; une vraie
   « step-up » 2FA par action admin serait plus robuste (proposition).
5. Turnstile : crochet prêt (`TURNSTILE_MODE`), clé réelle requise en uat/prod (Phase C).

## Recommandation technique [PROPOSITION]
Les 3 tests conditionnant l'adoption passent. Adoptable pour le périmètre utilisé (cœur + TOTP + codes de secours)
sous conditions : version épinglée + veille GHSA, Hyperdrive, fournisseur e-mail, déconnexion WS à la révocation.
Décision finale : Alessandro.
