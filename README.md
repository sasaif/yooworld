# YooWorld — prototype de jeu social 3D (inspiré de YoWorld)

Appartement isométrique décorable, deux avatars (Juanita & Juan), mobile d’abord.
Vite 5 · React 18 · React Three Fiber 8 · three 0.170 · TypeScript · vitest.

## Lancer
```bash
npm install
npm run dev          # http://localhost:5173  (ajouter ?fresh pour une partie neuve non sauvegardée, ?q=low|high pour forcer la qualité)
npm test             # 26 tests vitest (logique pure)
npm run build        # build de production dans dist/
```
Test de bout en bout mobile (optionnel, Chrome + playwright-core) : lancer `npx vite --port 5202` puis `node tools/e2e.mjs`.
Captures : `node tools/shot.mjs overview,ui_m@mobile` → `shots/`.

## Commandes
| | Mobile | Ordinateur |
|---|---|---|
| Marcher | toucher le sol | clic gauche sur le sol |
| Courir | double-toucher | double-clic |
| Déplacer la vue | glisser 1 doigt | glisser clic gauche |
| Zoom / rotation | pincer / 2 doigts | molette / clic droit |
| Objet | toucher → menu (s’asseoir, allumer, regarder, déplacer…) | clic |
| Changer d’avatar | toucher l’autre avatar | clic |

Dock : **Lieux** · **Décorer** (Ajouter, Sol & murs, Tourner / Déplacer / Ranger) · **Sac** (Mon sac / Boutique en pièces virtuelles) · **Danse** · **Chat** (local, hors ligne).

## Documentation (français)
- `docs/01-audit.md` — audit du projet appartement d’origine
- `docs/02-avatars.md` — évaluation des avatars (squelettes, matériaux, poids, corrections)
- `docs/03-architecture.md` — architecture cible et modules
- `docs/04-plan.md` — plan phases 1 à 5 (effort, dépendances, statut)
- `docs/05-technique.md` — pipeline avatar, scène, persistance, interactions, multijoueur
- `docs/LICENCES.md` — licences

## Branches
`main` ← `phase-1` (fondations, avatars) ← `phase-2` (appartement éditable). Le jeu est jouable à chaque fusion.

## Licences
Tous les assets sont CC0 (Polygonal Mind 100Avatars, Kenney, Quaternius) ; bibliothèques MIT. Détails : `docs/LICENCES.md`.
Multijoueur : **non implémenté** — le second avatar est local, l’interface affiche « Hors ligne ».
