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

## Bloquants / points ouverts avant adoption
1. **Fournisseur d'e-mail** absent (vérification d'adresse, reset) : `sendVerificationEmail` lève une erreur hors
   local. Phase C : compte d'Alessandro (ex. Resend), domaine + SPF/DKIM.
2. **Hyperdrive / pooling** pour Neon (latence et nombre de connexions) — non testé (pas de compte).
3. Codes de secours 2FA : stockage et usage [NON VÉRIFIÉ].
4. Révocation de session immédiate (sign-out partout, bannissement) : attendue (sessions en base, cookieCache off)
   mais [NON VÉRIFIÉ] en e2e.
5. Énumération de comptes à l'inscription / reset : [NON VÉRIFIÉ].
6. Fraîcheur de session admin : heuristique `session.createdAt ≥ user.updatedAt` (fail-closed) ; une vraie
   « step-up » 2FA par action admin serait plus robuste (proposition).

## Recommandation technique [PROPOSITION]
Adoptable pour le périmètre utilisé (cœur + TOTP) sous conditions : version épinglée + veille GHSA, Hyperdrive,
fournisseur e-mail, et les points 3–5 testés en Phase C. Décision finale : Alessandro.
