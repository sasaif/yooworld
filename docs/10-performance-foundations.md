# Fondations performance

Branche `feature/perf-foundations` (depuis `feature/movement-controls`). Ce n’est **pas** une phase d’optimisation graphique : pas de LOD, pas de qualité adaptative, pas de refonte des ombres ni du rendu. Le but est de poser de bonnes habitudes dès maintenant, tout en continuant à construire le jeu (gameplay et contenu visuel d’abord).

Une passe d’optimisation professionnelle est prévue plus tard, une fois les systèmes de jeu, les avatars, les lieux et les fonctions sociales stabilisés.

## Overlay FPS (mode développement)

Un petit moniteur dans le coin haut droit (sous la barre du haut, à l’écart du joystick et du dock, zones sûres respectées) affiche :

* FPS et temps de frame moyen / pire sur ~1,5 s
* draw calls, triangles, géométries, textures, programmes (`renderer.info`)
* nombre de matériaux uniques dans la scène

**Quand il apparaît**

* En `vite` (mode dev) : allumé par défaut.
* Sur un build déployé : ajouter `?perf=1` à l’URL, par ex. `https://sasaif.github.io/yooworld/perf/?perf=1`.
* Touche **F9** ou **\`** (backtick) pour le masquer / le réafficher (ignorée quand on tape dans un champ). Une fois masqué, le collecteur est démonté : coût nul.

**Pour les tests** : `window.__perf()` renvoie le dernier instantané (`fps`, `msAvg`, `msWorst`, `calls`, `triangles`, `geometries`, `textures`, `programs`, `uniqueGeometries`, `uniqueMaterials`, `visible`, `samples`). `window.__info` (déjà utilisé par les outils) reste alimenté.

En dev, un `console.warn` est émis si le FPS reste sous 25 pendant plusieurs secondes (rappel : en Chrome headless + SwiftShader on est typiquement à 3–8 fps, ce n’est pas représentatif d’un téléphone ou d’un ordinateur réel).

Le script `tools/perf-baseline.mjs` charge l’appartement et la plage en headless (desktop et iPhone 15 paysage) et enregistre `renderer.info`. Avec `--write` il met à jour `tools/perf-baseline.json`. Avec `--check` (défaut) il échoue si les draw calls dépassent la baseline de plus de 20 %.

```bash
# serveur local déjà lancé, ex. vite preview sur le port 5241
node tools/perf-baseline.mjs http://127.0.0.1:5241/ --check
```

## Règles pour les nouvelles fonctionnalités

À garder en tête en ajoutant un avatar, un meuble, un lieu ou une animation — surtout sur mobile :

1. **Géométries et matériaux partagés.** Un meuble du catalogue = une géométrie, un matériau palette, dessinés avec `InstancedMesh` (déjà le cas dans l’appartement). Un nouveau prop procédural va dans un batch (voir `MeshBuilder` de la plage) plutôt que dans un `mesh` par instance.
2. **Caches au niveau du module.** Textures procédurales, géométries statiques d’un lieu, matériaux de shader : les construire une fois (`Map` / variable de module), pas à chaque montage React. `useMemo` ne survit pas à un voyage vers un autre lieu.
3. **`dispose` à l’unmount.** Toute ressource créée impérativement (texture canvas, `InstancedMesh`, render target, matériau cloné) doit être libérée dans un `useEffect` de nettoyage. Les ressources **partagées / cachées** ne se disposent pas. Le helper `src/render/dispose.ts` (`useDispose`, `disposeMesh`) est là pour ça. Les géométries JSX (`<boxGeometry />`) sont déjà gérées par R3F.
4. **Pas d’allocation dans `useFrame` / la boucle d’animation.** Les `new THREE.Vector3()`, `Color()`, `Matrix4()`, `Quaternion()` se déclarent une fois (module ou `useRef`) et se réutilisent (`.set`, `.copy`, `.lerp`). Idem pour les tableaux / objets temporaires.
5. **Pas de chargement de texture en double.** Une URL / un canvas = une texture. Cloner seulement si l’on a vraiment besoin d’un `repeat` ou d’un wrapping différent, et disposer le clone.
6. **Budgets mobiles (repères souples, pas des plafonds durs).** S’en servir pour remarquer une régression, pas pour bloquer du contenu.

| Repère | Appartement (actuel) | Yoo Plage (actuel) | Souple, à ne pas dépasser sans raison |
|---|---|---|---|
| Draw calls (dernière frame, y compris ombres) | ~82–86 | ~21 | appartement 120, plage 40, nouveau lieu public 60 (à ne dépasser qu’avec une bonne raison) |
| Triangles | ~54 k | ~68 k | moins de 100 k par lieu en conditions normales |
| Textures (GPU) | ~12–13 | ~11 | préférer ≤ 1024 px (avatars déjà en 1024 JPEG) ; éviter d’ajouter une 2K « pour plus tard » |
| Lumières dynamiques avec ombre | 1 soleil | 1 soleil | ne pas multiplier les `castShadow` ; les lampes d’intérieur restent sans ombre |

Le lieu le plus chargé en *draw calls* aujourd’hui est l’appartement (meubles instanciés + déco + deux avatars + ombres). La plage est déjà très bien batchée (un appel pour presque tout le décor). Un nouveau lieu social devrait viser le modèle de la plage.

## Audit léger — corrections (sans changement visuel ni de gameplay)

Pas de réécriture. Seulement des fuites évidentes, des caches manquants et des allocations dans les boucles.

| Correction | Pourquoi |
|---|---|
| `StudioPreview` : vecteurs de caméra hissés hors de `useFrame` | 2 × `new Vector3()` à chaque frame du studio |
| `Character` : vecteur d’assise réutilisé | `new Vector3()` à chaque fois qu’un avatar s’assoit |
| `DanceFloor` : couleur « idle » réutilisée | `new Color('#fff6ee')` par dalle, à chaque beat à l’arrêt |
| `FurnitureBatch` : vecteur de position réutilisé | `new Vector3()` par meuble à chaque mise à jour des instances |
| `mergeSimple` : `dispose()` des géométries sources après fusion | clones intermédiaires (murs, meubles) laissés en mémoire |
| Sol de l’appartement : plus de `.clone()` de la texture cachée | le `repeat` est posé sur l’unique texture du fini ; le clone n’était pas disposé au changement de sol |
| `Ghost` / grille d’édition : `dispose` du matériau et de la géométrie | ressources impératives jamais libérées en quittant le mode Décorer |
| Murs : `dispose` des géométries fusionnées à l’unmount | elles n’étaient pas partagées et fuyaient au voyage |
| `Decor` : `dispose` des textures canvas, géométries et `InstancedMesh` | fuite à chaque aller-retour appart ↔ plage |
| Sable, mer, étincelles, géométrie des props / du bateau, matériaux sway, enseignes : cache module | recréés à chaque visite de la plage ; les shaders et textures s’accumulaient |
| Lanternes, piste de danse, mouettes : `dispose` des `InstancedMesh` impératifs | `<primitive>` n’est pas disposé par R3F |

Les draw calls et les triangles **au premier chargement** ne changent pas : la scène était déjà bien batchée (instances de meubles, un seul batch pour le décor de la plage). Le gain se voit sur les **allers-retours entre lieux** : sans ces corrections, géométries et textures GPU augmentaient à chaque voyage.

## Mesures (18 nov. 2026)

Chrome headless, SwiftShader (`--use-gl=angle --use-angle=swiftshader`). Le FPS (3–8) **n’est pas représentatif** d’un appareil réel — on s’appuie sur les compteurs `renderer.info`. Desktop 1440×900 @1x, iPhone 15 paysage 852×393 @3x. Qualité `high` sur desktop, `low` sur l’émulation iPhone (moins de lampes, d’où 4 draw calls et 2 géométries de moins dans l’appartement).

### Premier chargement (identique avant / après l’audit)

| Lieu | Appareil | Draw calls | Triangles | Géométries (GPU) | Textures | Programmes | Matériaux uniques |
|---|---|---:|---:|---:|---:|---:|---:|
| Appartement | Desktop | 86 | 54 267 | 84 | 13 | 21 | 46 |
| Appartement | iPhone 15 | 82 | 54 037 | 82 | 12 | 21 | 46 |
| Yoo Plage | Desktop | 21 | 68 213 | 20 | 11 | 16 | 48 |
| Yoo Plage | iPhone 15 | 21 | 68 213 | 20 | 11 | 16 | 48 |

### Cycle de voyage (le vrai avant / après)

Même session, desktop : appart → plage → appart → plage. On compare les compteurs GPU (géométries / textures), pas les draw calls (ils varient avec le frustum et la caméra).

| Étape | Avant (build `move/`, sans les corrections) | Après (`feature/perf-foundations`) |
|---|---|---|
| Appartement, 1ʳᵉ visite | geo 84 · tex 13 · prog 21 | geo 84 · tex 13 · prog 21 |
| Plage, 1ʳᵉ visite | geo 88 · tex 17 · prog 28 | geo 76 · tex 12 · prog 27 |
| Appartement, 2ᵉ visite | geo 100 · tex 20 · prog 32 | geo 83 · tex 15 · prog 29 |
| Plage, 2ᵉ visite | geo 105 · tex 24 · prog 28 | geo 76 · tex 12 · prog 27 (stable) |

Avant, chaque aller-retour ajoutait une quinzaine de géométries et ~7 textures. Après, la plage revient exactement aux mêmes compteurs ; l’appartement ne dérive plus. Les programmes shader des deux lieux restent un moment dans le cache du renderer (normal, hors périmètre).

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/render/perf/perfStats.ts` | fenêtre FPS, instantané, `window.__perf`, disponibilité, toggle |
| `src/render/perf/PerfOverlay.tsx` | collecteur R3F (monté seulement si l’overlay est allumé) + HUD HTML |
| `src/render/dispose.ts` | `useDispose` / `disposeMesh` |
| `tools/perf-baseline.mjs` + `tools/perf-baseline.json` | garde des draw calls |
| `tests/perf.test.ts` | unité : fenêtre, pire frame, toggle |
