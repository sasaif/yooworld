# 14 · Yoo Games Club : jalon M1, Dominos en mode local contre des bots

Branche `feature/games-club-dominoes`, partie de `origin/feature/gameplay-polish` @ `5d810fa`, puis `origin/feature/gameplay-polish` @ `59f577c`
fusionnée dedans (correctif de la posture assise `f70179c`, approuvé le 19/11/2026). **Non fusionnée ailleurs, non déployée.**
Validé par le propriétaire le 19/11/2026 : « Yes, start the first milestone on its own branch, no merge or deploy » ; Dominos d'abord,
puis la Belote classique ; mises en Or : à décider plus tard (aucune ici).
Spécification : `worlds/EXPANSION_PROPOSAL.md` (§3 architecture, §6 jalon M1) et `rulebook/OWNER_BRIEF_EXPANSION_SOCIAL_GAMES_2026-11-19.md`.

## 1. Ce qui marche

- **Lieux → « Yoo Games Club » 🎲** avec le fondu existant (`travelWithFade`). Aussi `?lieu=club` (ou `?lieu=jeux`).
- Le club est une salle fixe de 7,2 × 6 m (même gabarit et même kit de murs que l'appart, donc **même cadrage caméra, avatars ~93 px
  sur iPhone 15**), meublée uniquement avec des modèles Kenney déjà dans le dépôt : 3 tables basses (tapis vert dessus), 10 chaises,
  bibliothèques, plantes, fauteuil. Panneau « YOO GAMES CLUB » et affiches Dominos / Belote / Dames dessinés par code (canvas).
- **Table de dominos** (4 chaises) jouable ; tables **Belote** et **Dames** présentes mais « bientôt ».
- Toucher la table → menu « 🎲 Jouer aux dominos » (avec le badge local) → fiche : **2, 3 ou 4 joueurs (toi + 1 à 3 bots)**,
  **1 manche** ou **match en 100 points** → « S'asseoir et jouer ». L'avatar marche jusqu'à sa chaise et s'assoit avec le système
  d'interactions existant (sièges `computeSeats`, approche latérale `resolveApproaches`, transitions `seatMotion`) ; la partie
  commence quand il est assis.
- Interface de table (2D, paysage d'abord) : bandeau haut (badge **« Mode local · contre des bots »**, joueurs, nombre de dominos,
  points, pioche, Quitter), ligne de jeu au-dessus, main en bas ; **le centre de l'écran reste libre** : l'avatar assis reste visible.
  Toucher un domino jouable le pose ; s'il va des deux côtés, deux boutons « ◀ / ▶ » apparaissent. Boutons « Piocher » / « Passer »
  quand c'est le seul coup légal.
- **Les bots sont de vrais avatars YooWorld assis à la table** (mêmes corps, mêmes animations et transitions assis / debout que le joueur,
  tenues variées prises dans le catalogue existant, aucun nouvel asset ; `src/game/club/botAvatars.ts`, `src/render/club/ClubBots.tsx`).
  Étiquette de nom normale « Bot n 🤖 » (plus d'étiquette flottante). Bulles existantes : « 🤔 … » pendant qu'un bot réfléchit,
  « Je pioche », « Je passe », « Domino ! ». Les tenues des bots sont de l'affichage : rien n'est possédé, acheté ni enregistré.
- **Tour actif évident** : anneau doré pulsé au sol sous la chaise du joueur actif (1 mesh), pastille du joueur qui brille dans le
  bandeau (vert pour toi, or pour un bot) avec les « … » animés quand un bot réfléchit, bandeau « À toi de jouer ! » et main entourée
  de vert à ton tour, texte d'aide (« Touche un domino qui brille », « Choisis le bout de la ligne »).
- **Ligne lisible même longue** (`src/ui/club/chainLayout.ts`) : les dominos ne rétrécissent plus jusqu'à 9 px ; la ligne s'enroule
  en serpent (rangée 1 de gauche à droite, rangée 2 de droite à gauche, dominos retournés pour que les moitiés qui se touchent
  correspondent), demi-domino de 22 px max (19 px sur écran bas type iPhone SE), **jamais moins de 16 px**, 3 rangées max.
  Le dernier domino posé est surligné ; quand un domino va des deux côtés, les deux bouts clignotent (bleu = début, orange = fin)
  et se touchent directement, ou via les boutons « ◀ n » / « n ▶ » de la même couleur.
- Résumé de manche (mode points, avec barre de progression vers 100) puis **écran de résultats** : classement 🥇🥈🥉, points, dominos
  restants, récapitulatif des manches (gagnant, Domino ! / bloqué, points), nombre de joueurs, mode, coups, durée.
  **« Rejouer »** (même table, mêmes réglages, mêmes bots restés assis, nouvelle donne), **« Changer de partie »** (fiche de la table,
  tu restes assis, les bots se lèvent) et **« Quitter »**.
- **Quitter en sécurité** : « Quitter » pendant une partie ouvre une fenêtre « Quitter la table ? » (pas `window.confirm`) ; **les bots
  sont mis en pause** tant qu'elle est ouverte (« Rester » reprend). Un seul chemin de fermeture : l'hôte local est arrêté (aucun
  minuteur restant), les bots se lèvent puis disparaissent, ton avatar se lève, et une nouvelle partie peut commencer tout de suite.
  Couvert : pendant le tour d'un bot, entre deux manches, depuis les résultats (sans confirmation), pendant l'installation
  (« Annuler »), en voyageant (Lieux / fondu : table fermée sans bruit) et si l'avatar quitte sa chaise par un autre moyen (filet de
  sécurité : partie abandonnée + message). À table, une couche transparente empêche qu'un toucher au sol fasse lever l'avatar.
- Pendant la partie, le joystick, le bouton de course, le dock et la barre du haut sont masqués.

## 2. Ce qui n'est PAS fait (volontairement)

- **Pas de multijoueur** : aucun serveur, aucun autre joueur. Le mot « multijoueur » n'apparaît nulle part (vérifié par l'e2e).
- **Pas d'Or, pas d'XP, pas de récompense, pas de mise, pas de statistiques enregistrées.** Les points sont des points de table.
  Les gains d'activité existants (s'asseoir / danser) sont **coupés dans le club** (`useActivityRewards`) pour que jouer ne rapporte rien.
- **Rien n'est sauvegardé** : le résultat reste en mémoire pour la session (`club.s.history`), le club n'est jamais enregistré comme
  lieu courant (`LocationDef.remember: false`), un rechargement ramène à l'appart / à la plage. Aucun fichier de sauvegarde ou de
  stockage n'est modifié (l'isolation des sauvegardes vit sur `feature/save-isolation`).

## 3. Règles exactes (Dominos, « jeu de la pioche », double-six) : **approuvées par le propriétaire le 19/11/2026**

1. Jeu de 28 dominos 0-0 … 6-6. 2 joueurs : 7 dominos chacun ; 3 ou 4 joueurs : 5 chacun. Le reste forme la pioche.
2. Ouverture : le joueur qui a le plus gros double (6-6, sinon 5-5…) commence et doit poser ce double. Si personne n'a de double,
   le joueur qui a le domino le plus lourd (plus de points, puis plus grand côté) commence avec lui. Même règle à chaque manche.
3. Ordre : sièges 0, 1, 2, 3 dans le sens des aiguilles d'une montre autour de la table (toi = siège 0).
4. À ton tour, tu **dois** poser un domino qui touche un des deux bouts de la ligne si tu peux. Sinon tu pioches un domino
   (et tu recommences tant que rien ne va) ; si la pioche est vide, tu passes.
5. La manche s'arrête quand un joueur pose son dernier domino (« Domino ! ») ou quand le jeu est **bloqué** (tous les joueurs
   passent d'affilée, pioche vide).
6. Points : « Domino ! » → le gagnant marque la somme des points restant dans les mains adverses. Bloqué → le joueur qui a le
   moins de points en main gagne et marque la somme des autres mains ; en cas d'égalité sur le minimum, manche nulle, personne ne marque.
7. Partie : « 1 manche » ou « match en 100 points » (manches jusqu'à ce qu'un joueur atteigne 100 en fin de manche).
   Classement final : points (haut d'abord), puis points restants à la dernière manche (bas d'abord), puis siège.

## 4. Framework réutilisable (`src/minigames/`)

| Fichier | Rôle |
|---|---|
| `types.ts` | `GameRules<S, M, V, O>` (pur, déterministe, état JSON), `BotPlayer`, `GameRoom` / `SeatSlot` / `Occupant`, `GameResult`, `RulesError` |
| `rng.ts` | RNG mulberry32 dont l'état est un entier rangé dans l'état du jeu (rejouable à l'identique, sur l'appareil ou un serveur) |
| `turnEngine.ts` | moteur de tours générique et pur : `seq` croissant, validation (tour, légalité, `stale_seq`, partie finie), journal des coups, minuteur de tour (`deadline`, `timeoutMove`), `advance` entre manches |
| `LocalGameHost.ts` | hôte local : fait jouer les bots après un délai (`thinking` = siège du bot qui réfléchit), refuse qu'on joue à la place d'un bot, `pause()` / `resume()` (fenêtre « Quitter ? »), `stop()` = abandon sans minuteur restant (`hasTimer`), résultat en mémoire |
| `lobby.ts` | `LobbyService` (create / join / leave / fillWithBots / setStatus) + `LocalLobbyService` en mémoire ; une implémentation serveur viendra après choix du backend |
| `registry.ts` | catalogue du club (`dominoes` jouable, `belote` et `checkers` « bientôt ») et le libellé unique `LOCAL_BADGE` |
| `dominoes/rules.ts`, `dominoes/bot.ts` | module de règles Dominos + bot « facile » (pose le domino le plus lourd, double d'abord, hasard seedé entre égaux) |

Interface d'un jeu :

```ts
interface GameRules<S, M, V, O> {
  id: string; seats: { min: number; max: number; teams?: number[][] };
  setup(seatCount, seed, options?): S;          // tout l'aléatoire vient de seed, gardé dans S
  currentSeat(s): number | null;                // null = entre deux manches / fini
  legalMoves(s, seat): M[];
  apply(s, seat, move): S;                      // pur, lève RulesError si illégal
  advance?(s): S;                               // étape hors tour (manche suivante)
  viewFor(s, seat | 'spectator'): V;            // masque les mains adverses et l'ordre de la pioche
  isOver(s): boolean; result(s): { ranking, scores, winners, teams? };
  timeoutMove?(s, seat): M; sameMove(a, b): boolean;
}
```

Ajouter la Belote, le Rami, le Puissance 4… = `<jeu>/rules.ts` + `<jeu>/bot.ts` + une entrée dans `registry.ts` + son interface de table ;
le club, les tables, les sièges, les avatars des bots assis, l'anneau de tour, le lobby, le moteur de tours, la pause / l'abandon
et la fermeture propre de la table sont partagés (aucun de ces jeux n'est ajouté ici). En ligne plus tard, un serveur
de salle fera tourner le même module et le même moteur, et n'enverra à chaque client que `viewFor(siège)`.

Intégration au jeu : `src/game/club/clubLayout.ts` (salle, tables, chaises dans l'ordre des sièges, `chairsFor`),
`src/game/club/ClubController.ts` (s'asseoir → distribuer, bots assis, coups humains, quitter / pause, rejouer, changer de partie),
`src/game/club/botAvatars.ts`, `src/app/clubService.ts`, `src/render/club/ClubView.tsx`, `src/render/club/ClubBots.tsx`, `src/ui/club/*`. Changements hors club, volontairement petits : `locations.ts` (+ lieu `club`,
champ `remember`), `GameController` (entrée dans le club, pas d'écriture de `profile.location` pour un lieu non mémorisé),
`startLocation.ts` (`deepLinkPlace`), `App.tsx`, `Hud.tsx` (bouton « 🎲 Jeux », dock / barre masqués à table),
`ApartmentView.tsx` (`Floor` et `Walls` exportés), `useActivityRewards.ts` (pas d'Or dans le club). Jalon M1 polish : `Character.tsx`
(props optionnelles `npcLabel`, `lite`, `tagClass` ; sans elles, rendu identique), `useCustomAvatar.ts` (un avatar supplémentaire
choisit son corps par l'URL du modèle), `App.tsx` (anneau de sélection masqué à table : l'anneau de tour le remplace).
Aucun code de sauvegarde / stockage touché.

## 5. Tests

- `tests/dominoes-rules.test.ts` : jeu complet, distribution, ouverture, coups légaux, pioche, passe, refus des coups illégaux
  sans muter l'état, orientation de la ligne, « Domino ! », jeu bloqué (gagnant / égalité), mode points et manche suivante,
  vue sans info cachée, sérialisation JSON, **300 parties bots seedées (2–4 joueurs, 2 modes)** : toujours finies, coups des bots
  toujours légaux, 28 dominos conservés.
- `tests/turn-engine.test.ts` : moteur (tour, légalité, `stale_seq`, fin, journal, minuteur), lobby, hôte local avec 1 humain +
  1 à 3 bots jusqu'au résultat, abandon, registre et libellé honnête.
- `tests/games-club.test.ts` : lieu jouable non mémorisé, gabarit = appart, meubles dans la salle sans chevauchement, 4 sièges
  face à la table et atteignables à pied, chaises par nombre de joueurs, voyage sans écriture du lieu dans la sauvegarde.
- `tests/games-club-polish.test.ts` : pause pendant le tour d'un bot (aucun minuteur, aucun coup, coups humains refusés, reprise),
  arrêt en pause / entre deux manches sans minuteur restant ; ligne : 1 à 28 dominos tiennent à ≥ 16 px en ≤ 3 rangées sur
  iPhone SE et iPhone 15, serpent (rangées impaires retournées), 20+ dominos à ≥ 18 px ; tenues des bots : objets du catalogue
  existants, bon corps, emplacements requis remplis, pas d'accessoire ni de cheveux à attaches, tenues différentes à une table.
- `tools/e2e-club.mjs` (téléphone paysage tactile, vrais touchers), scénarios A à G : partie complète jusqu'aux résultats avec les
  bots assis (avatars, étiquettes normales, aucune étiquette flottante), tour actif (anneau, pastille, « À toi de jouer ! »,
  « … » des bots), résultats (classement, récap, 3 boutons), « Rejouer » (mêmes bots assis), quitter pendant le tour d'un bot
  (fenêtre, pause vérifiée, « Rester », « Quitter »), quitter entre deux manches (3 joueurs, 100 points), « Changer de partie »
  puis quitter depuis les résultats, voyage en pleine partie puis retour par le dock et nouvelle partie, **ligne longue** (donne
  fixe `?clubseed=2`, 2 joueurs, 27 dominos) ; après chaque départ : table fermée, bots partis, aucun minuteur ; badge, jamais
  « multijoueur », pas d'Or gagné, club jamais sauvegardé, draw calls / triangles, taille d'avatar, 0 erreur console.
  `DEV=iphone15|se PLAYERS=2|3|4 [SHOTS=dossier] [BOTMS=150] node tools/e2e-club.mjs http://127.0.0.1:PORT/`
  (`?botms=` accélère les bots et `?clubseed=` fixe la donne : pour les tests uniquement).

## 6. Performances (Chrome headless + SwiftShader : FPS non représentatif)

Mesures `window.__info` (e2e-club, 19/11/2026, iPhone 15 852×393 et iPhone SE 667×375).
Les budgets ci-dessous (et les assertions e2e) portent sur la **passe principale**. Depuis UAT, `window.__info.calls` /
`triangles` incluent aussi la passe d'ombres (~21 appels, ~28 k triangles dans le club) ; le détail est dans
`callsMain` / `callsShadow` / `trianglesShadow`.

| Situation | Passe principale (budget) | + ombres | Total |
|---|---|---|---|
| Club, au repos (Juanita + Juan) | 33 appels / 48 113 triangles | 21 / 28 393 | 54 / 76 506 |
| À table, 2 joueurs (1 bot) | 36 appels / 60 733 triangles (doc d'origine) | 21 / ~28 k | 57 / 89 126 (mesuré après fusion UAT) |
| À table, 4 joueurs (3 bots) | 40 appels / ≈ 82 000 triangles (81 963 – 82 680) | 21 / 28 393 | 61 / ~110 000 |

Avatar complet = 4 draw calls (corps, contour, cheveux, ombre ronde), ≈ 21 k triangles. Avec 3 bots complets : 47 calls / 112 k
triangles (mesuré), donc hors budget. Les bots sont des avatars `lite` : pas de coque de contour, pas d'ombre ronde, pas de passe
d'ombre, pas d'accessoire ni de cheveux à attaches (2 calls, ≈ 11 k triangles chacun) ; l'anneau de sélection est remplacé à table
par l'anneau de tour (1 mesh). Pas mesuré sur un vrai iPhone.

## 7. Points ouverts pour le propriétaire

- Règles approuvées le 19/11/2026 (voir §3). Belote : règles exactes à écrire avant le code ; mises en Or : plus tard.
- Les bots n'ont pas le contour sombre des avatars joueurs (budget triangles) : différence légère, visible de près.
- À 4 joueurs, les étiquettes des bots des chaises sud et est peuvent se chevaucher un peu à l'écran.
- Sur iPhone SE, une ligne de 20+ dominos (2 rangées) recouvre l'étiquette de nom du joueur assis (la tête reste visible).
- Belote et Dames : tables posées, « bientôt ».
