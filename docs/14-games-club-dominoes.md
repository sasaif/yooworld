# 14 · Yoo Games Club : jalon M1, Dominos en mode local contre des bots

Branche `feature/games-club-dominoes`, partie de `origin/feature/gameplay-polish` @ `5d810fa`. **Non fusionnée, non déployée.**
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
- Les bots n'ont pas d'avatar : une étiquette « 🤖 Bot n » au-dessus de leur chaise (DOM, 0 draw call), jamais présentés comme des joueurs.
- Résumé de manche (mode points) puis **écran de résultats** (classement, points, dominos restants), « Rejouer » ou « Quitter la table ».
- Pendant la partie, le joystick, le bouton de course, le dock et la barre du haut sont masqués ; « Quitter » demande confirmation
  si la partie est en cours (abandon).

## 2. Ce qui n'est PAS fait (volontairement)

- **Pas de multijoueur** : aucun serveur, aucun autre joueur. Le mot « multijoueur » n'apparaît nulle part (vérifié par l'e2e).
- **Pas d'Or, pas d'XP, pas de récompense, pas de mise, pas de statistiques enregistrées.** Les points sont des points de table.
  Les gains d'activité existants (s'asseoir / danser) sont **coupés dans le club** (`useActivityRewards`) pour que jouer ne rapporte rien.
- **Rien n'est sauvegardé** : le résultat reste en mémoire pour la session (`club.s.history`), le club n'est jamais enregistré comme
  lieu courant (`LocationDef.remember: false`), un rechargement ramène à l'appart / à la plage. Aucun fichier de sauvegarde ou de
  stockage n'est modifié (l'isolation des sauvegardes vit sur `feature/save-isolation`).

## 3. Règles exactes (Dominos, « jeu de la pioche », double-six)

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
| `LocalGameHost.ts` | hôte local : fait jouer les bots après un délai, refuse qu'on joue à la place d'un bot, `stop()` = abandon, résultat en mémoire |
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

Ajouter la Belote = `belote/rules.ts` + `belote/bot.ts` + une entrée dans `registry.ts` + son interface de table ;
le club, les tables, les sièges, le lobby, le moteur de tours et l'écran de résultats sont partagés. En ligne plus tard, un serveur
de salle fera tourner le même module et le même moteur, et n'enverra à chaque client que `viewFor(siège)`.

Intégration au jeu : `src/game/club/clubLayout.ts` (salle, tables, chaises dans l'ordre des sièges, `chairsFor`),
`src/game/club/ClubController.ts` (s'asseoir → distribuer, coups humains, quitter, rejouer), `src/app/clubService.ts`,
`src/render/club/ClubView.tsx`, `src/ui/club/*`. Changements hors club, volontairement petits : `locations.ts` (+ lieu `club`,
champ `remember`), `GameController` (entrée dans le club, pas d'écriture de `profile.location` pour un lieu non mémorisé),
`startLocation.ts` (`deepLinkPlace`), `App.tsx`, `Hud.tsx` (bouton « 🎲 Jeux », dock / barre masqués à table),
`ApartmentView.tsx` (`Floor` et `Walls` exportés), `useActivityRewards.ts` (pas d'Or dans le club).

## 5. Tests

- `tests/dominoes-rules.test.ts` : jeu complet, distribution, ouverture, coups légaux, pioche, passe, refus des coups illégaux
  sans muter l'état, orientation de la ligne, « Domino ! », jeu bloqué (gagnant / égalité), mode points et manche suivante,
  vue sans info cachée, sérialisation JSON, **300 parties bots seedées (2–4 joueurs, 2 modes)** : toujours finies, coups des bots
  toujours légaux, 28 dominos conservés.
- `tests/turn-engine.test.ts` : moteur (tour, légalité, `stale_seq`, fin, journal, minuteur), lobby, hôte local avec 1 humain +
  1 à 3 bots jusqu'au résultat, abandon, registre et libellé honnête.
- `tests/games-club.test.ts` : lieu jouable non mémorisé, gabarit = appart, meubles dans la salle sans chevauchement, 4 sièges
  face à la table et atteignables à pied, chaises par nombre de joueurs, voyage sans écriture du lieu dans la sauvegarde.
- `tools/e2e-club.mjs` (téléphone paysage tactile, vrais touchers) : Lieux → club, menu de la table, fiche, s'asseoir, **partie
  complète jusqu'à l'écran de résultats**, badge, jamais « multijoueur », pas d'Or gagné, club jamais sauvegardé, draw calls,
  taille d'avatar identique à l'appart, 0 erreur console.
  `DEV=iphone15|se PLAYERS=2|3|4 MODE=single|points [SHOTS=dossier] [BOTMS=150] node tools/e2e-club.mjs http://127.0.0.1:PORT/`
  (`?botms=` accélère les bots, pour les tests uniquement).

## 6. Performances (Chrome headless + SwiftShader : FPS non représentatif)

Mesures `window.__info` dans le club, iPhone 15 paysage (852×393) : voir le rapport de la branche (draw calls ≤ 40, triangles < 100 k).
Pas mesuré sur un vrai iPhone.

## 7. Points ouverts pour le propriétaire

- Règles : 5 dominos par joueur à 3–4 joueurs (variante courante) ; manche bloquée à égalité = nulle ; même règle d'ouverture à
  chaque manche (pas « le gagnant ouvre »). À confirmer ou changer.
- Mode par défaut : « 1 manche » (≈ 1–3 min). Le match en 100 points dure plutôt 10–20 min contre des bots.
- Bots en étiquettes (pas d'avatars) pour rester sous le budget de draw calls et ne jamais ressembler à de vrais joueurs.
- Belote et Dames : tables posées, « bientôt » ; la Belote classique demande d'écrire ses règles exactes avant le code.
