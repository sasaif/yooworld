# 01 — Audit du projet « appartement » (base de départ)

Source auditée : `/workspace/yooville/apartment/app` (commit `631fd66` « baseline » de ce dépôt).
Taille : ~600 lignes TypeScript dans 9 fichiers, Vite 5 + React 18 + React Three Fiber 8 + drei 9 + three 0.170.

## 1. Structure
| Fichier | Rôle | Remarque |
|---|---|---|
| `App.tsx` | Canvas, caméra, boutons HTML, choix d'avatar | mélange rendu + logique + UI |
| `Room.tsx` | sol procédural, murs Kenney, meubles, sièges | 1 `<primitive>` cloné par meuble → aucune instanciation |
| `layout.ts` | taille de pièce + liste de meubles en dur | positions en mètres, pas de grille, pas de validation |
| `nav.ts` | grille d'occupation + A* | correct, réutilisé |
| `world.ts` | état mutable global (12 lignes) | pas de typage des modes |
| `Character.tsx` | chargement avatar, retarget, machine d'états | logique de déplacement dans le composant de rendu |
| `avatar/retarget.ts`, `boneMaps.ts` | retarget runtime Quaternius 23 os → Mixamo 41 os | fonctionne, coûteux au chargement |

Pas de routage (une seule scène), pas de tests, pas de persistance, pas de réseau.

## 2. Ce qui fonctionnait
- Pièce isométrique lisible (caméra orthographique), parquet procédural, meubles Kenney CC0.
- Clic sol → marche avec A* + lissage du chemin.
- Retarget des clips Idle / Walk / SitDown / StandUp / Victory sur Juanita et Juan.
- S'asseoir sur canapé / fauteuil, danse, bulle de chat locale.
- Harness de captures (`?shot=` + Playwright).

## 3. Ce qui était incomplet ou faux
- **Avatars non éclairés** : Juanita utilise `KHR_materials_unlit` → aspect plat, ne réagit ni au soleil ni aux lampes ; Juan était éclairé différemment → incohérence.
- **Poids** : GLB 4,57 Mo (F) et 3,47 Mo (H), textures 2048² PNG (≈16–21 Mo de mémoire GPU chacune avec mipmaps).
- **Pose assise** : bras tendu (piste de bras du clip SitDown), jambes dans le canapé.
- **Déplacement** : vitesse constante, pas d'accélération, pas de course, rotation instantanée.
- **Caméra** : souris seulement (pas de pan au doigt pensé pour le mobile), pas de suivi du joueur.
- **Meubles** : liste figée, pas de mode édition, pas de collisions de placement, pas d'objets posés sur des surfaces.
- **UI** : boutons HTML en haut à gauche, non pensés pour le pouce, pas d'inventaire ni de boutique.
- **Pas de sauvegarde** : tout est perdu au rechargement.
- **Pas d'abstraction réseau** : la « seconde personne » n'était qu'un deuxième avatar local, sans frontière claire.

## 4. Goulots de performance identifiés
1. Retarget des animations à l'exécution, sur le thread principal (≈ quelques centaines de ms au chargement sur mobile).
2. GLB avatars lourds + textures 2048 RGBA PNG.
3. Un draw call par sous-maillage de chaque meuble (pas d'`InstancedMesh`), murs en pièces séparées.
4. Ombres : aucune politique de qualité (taille de shadow map fixe, pas de profil mobile).

## 5. Dette technique
- Rendu, logique et UI entremêlés (impossible à tester sans navigateur).
- Données (meubles, positions) codées en dur dans des composants.
- État global mutable non typé.
- Aucune donnée versionnée → impossible de migrer une sauvegarde plus tard.

## 6. Décision
Pas de réécriture : le code utile (nav A*, retarget, harness de captures, assets) est **conservé et déplacé** dans une architecture modulaire (voir `03-architecture.md`). Chaque étape est un commit sur une branche dédiée (`phase-1`, `phase-2`) fusionnée dans `main` uniquement quand le jeu tourne et que les tests passent.
