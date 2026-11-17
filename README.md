# Yooville – Appartement (prototype YoWorld-like)

Vite + React Three Fiber. Une pièce isométrique (vue orthographique) avec meubles, Juanita (F) et Juan (H).

## Lancer
```
npm install
npm run dev        # puis ouvrir http://localhost:5173
```
- Clic sur le sol : l'avatar sélectionné marche (pathfinding A* sur grille, contourne les meubles).
- Clic sur un avatar ou boutons en haut à gauche : changer d'avatar.
- 🛋️ Canapé / 🪑 Fauteuil : va s'asseoir. Cliquer le sol pour se relever et repartir.
- 🎉 Danse : animation Victory. 💬 : bulle de chat locale (pas de réseau).
- Molette = zoom, clic droit = déplacer, clic gauche glissé = tourner (limité).
- Captures : `?shot=overview|close|walk|sit` (script `tools/shot.mjs`, Chrome + playwright-core).

## Code
- `src/layout.ts` : taille de la pièce, murs, liste des meubles (x, z, orientation), palette de couleurs.
- `src/Room.tsx` : sol (parquet procédural), murs Kenney, placement des meubles, sièges.
- `src/nav.ts` : grille d'occupation + A* + lissage du chemin.
- `src/Character.tsx` : avatar, retarget runtime des clips Quaternius 23 os (Idle, Walk, SitDown, StandUp, Victory) vers le squelette Mixamo de Juanita, machine d'états marche/assis.
- `src/avatar/` : retarget + tables d'os (repris du prototype avatar).

## Licences des assets
- Juanita (F) : 100Avatars R3, Polygonal Mind, CC0 (crédit facultatif : "Juanita, 100Avatars by Polygonal Mind").
- Juan (H) : dérivé de Juanita (Yooville), CC0 par héritage.
- Meubles / murs : Kenney Furniture Kit 2.0, CC0 (`public/models/furniture/LICENSE_Kenney_FurnitureKit.txt`).
- Animations : Quaternius (Animated Characters Pack, 23 os), CC0.
- Code : à toi (aucune dépendance copyleft ; three / R3F / drei sont MIT).
