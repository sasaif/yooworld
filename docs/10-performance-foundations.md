# Fondations performance

Branche `feature/perf-foundations` (depuis `feature/movement-controls`). Ce n’est **pas** une phase d’optimisation graphique : pas de LOD, pas de qualité adaptative, pas de refonte des ombres ni du rendu. Le but est de poser de bonnes habitudes dès maintenant, tout en continuant à construire le jeu (gameplay et contenu visuel d’abord).

Une passe d’optimisation professionnelle est prévue plus tard, une fois les systèmes de jeu, les avatars, les lieux et les fonctions sociales stabilisés.

## Overlay FPS (mode développement)

Un petit moniteur dans le coin haut droit (sous la barre du haut, à l’écart du joystick et du dock, zones sûres respectées) affiche :

* FPS et temps de frame moyen / pire sur ~1,5 s
* draw calls **réels de la dernière image : total = passe principale + passe d’ombres**, affichés séparément (`draw 154 = 87 + ombre 67`), puis triangles, géométries, textures, programmes (`renderer.info`)
* nombre de matériaux uniques dans la scène

**Quand il apparaît**

* En `vite` (mode dev) : allumé par défaut.
* Sur un build déployé : ajouter `?perf=1` à l’URL, par ex. `https://sasaif.github.io/yooworld/perf/?perf=1`.
* Touche **F9** ou **\`** (backtick) pour le masquer / le réafficher (ignorée quand on tape dans un champ). Une fois masqué, le collecteur est démonté : coût nul.

**Pour les tests** : `window.__perf()` renvoie le dernier instantané (`fps`, `msAvg`, `msWorst`, `calls` = total, `callsMain`, `callsShadow`, `triangles` = total, `trianglesShadow`, `geometries`, `textures`, `programs`, `uniqueGeometries`, `uniqueMaterials`, `visible`, `samples`). `window.__info` (déjà utilisé par les outils) reste alimenté, avec les mêmes champs `calls` (total), `callsMain`, `callsShadow`.

En dev, un `console.warn` est émis si le FPS reste sous 25 pendant plusieurs secondes (rappel : en Chrome headless + SwiftShader on est typiquement à 3–8 fps, ce n’est pas représentatif d’un téléphone ou d’un ordinateur réel).

Le script `tools/perf-baseline.mjs` charge l’appartement et la plage en headless (desktop et iPhone 15 paysage) et enregistre les compteurs du renderer : draw calls **principal, ombres et total**, triangles (dont ombres), géométries, textures, programmes, buffers GPU, tas JS et temps de frame. Chaque scène × profil est mesurée `RUNS` fois (3 par défaut) sur `FRAMES` images (30 par défaut), voir « Répétabilité et variance » plus bas. Avec `--write` il met à jour `tools/perf-baseline.json` (médianes des runs + dispersion). Avec `--check` (défaut) il échoue si la **médiane** du total des draw calls dépasse la baseline de plus de 20 %. `--table` imprime le tableau min / médiane / max / écart-type. Il affiche aussi chaque scène face à son budget souple (appartement 120, plage 40) : `AU-DESSUS DU BUDGET` est écrit en clair, sans faire échouer la garde (la garde sert à repérer une régression, le budget à suivre l’objectif).

```bash
# serveur local déjà lancé, ex. vite preview sur le port 5241
node tools/perf-baseline.mjs http://127.0.0.1:5241/ --check
# tableau de variance (5 runs × 60 images)
RUNS=5 FRAMES=60 node tools/perf-baseline.mjs http://127.0.0.1:5241/ --table
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
| Draw calls (dernière frame, **total = principal + ombres**, voir ci-dessous) | 90–94 (83–87 + 7) | 31 (21 + 10) | appartement **< 120 (budget dur, `perf-baseline --check`)**, plage 40, nouveau lieu public 60 (à ne dépasser qu’avec une bonne raison) |
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

### Comptage des draw calls : la passe d’ombres était invisible (corrigé le 19 nov. 2026)

`three` r170 remet `renderer.info` à zéro **après** avoir dessiné les cartes d’ombre (`WebGLRenderer.render` : `shadowMap.render(...)`, puis `if (info.autoReset) info.reset()`). Avant cette correction, l’overlay, `window.__perf()`, `window.__info` et `perf-baseline` ne voyaient donc que la passe principale. `src/render/perf/drawCounter.ts` prend la main sur la remise à zéro (`info.autoReset = false`, une remise à zéro au début de chaque `render()`) et mesure la passe d’ombres en enveloppant `shadowMap.render`. Il est installé sur le renderer du jeu pendant toute la session (composant `Stats`).

Vérification : en comptant directement les appels WebGL `draw*` de chaque image (outil QA hors dépôt, Chrome headless SwiftShader), on obtient exactement les mêmes totaux que l’overlay.

| Lieu | Appareil (headless) | Principal | Ombres | **Total** | Budget souple | Triangles total (dont ombres) |
|---|---|---:|---:|---:|---:|---:|
| Appartement | Desktop | 87 | 67 | **154** | 120 → **dépassé (+34)** | 84 268 (30 001) |
| Appartement | iPhone 15 | 83 | 67 | **150** | 120 → **dépassé (+30)** | 84 038 (30 001) |
| Yoo Plage | Desktop | 21 | 10 | **31** | 40 | 112 282 (44 069) |
| Yoo Plage | iPhone 15 | 21 | 10 | **31** | 40 | 112 282 (44 069) |

**Mise à jour (branche `feature/qa-drawcalls`) : l’appartement passe à 94 (87 + 7) sur desktop et 90 (83 + 7) sur iPhone 15**, voir « Passe d’ombres et premiers voyages » plus bas.

Les chiffres du tableau « Premier chargement » ci-dessous (86/82/21/21) étaient donc la **passe principale seule**. Le budget de 120 reste la référence : l’appartement le dépasse aujourd’hui, à cause des 67 appels de la passe d’ombres (67 objets projettent une ombre). Le repère « moins de 100 k triangles » avait été posé sur la passe principale (54 k / 68 k) ; avec les ombres, la plage atteint 112 k triangles par image.

### Passe d’ombres et premiers voyages (19 nov. 2026, `feature/qa-drawcalls`)

Sans changement visuel ni de gameplay :

1. **Ombres de l’appartement : 67 → 7 appels.** Murs et meubles projetaient leur ombre un appel par partie (une par `InstancedMesh` / matériau). Ils s’affichent toujours pareil dans la passe principale (mêmes matériaux, instances, clics), mais avec `castShadow = false`. Leur géométrie (chaque instance, en coordonnées monde) est fusionnée dans **un seul maillage « ombre seulement »** par côté de matériau (`src/render/shadow/`). Ce maillage est caché, et rendu visible seulement pendant `shadowMap.render` (three r170 construit la liste de la passe principale avant les cartes d’ombre). La carte d’ombre reçoit les mêmes triangles (30 001) et se reconstruit seulement quand un meuble ou un fini change. Restent 7 appels d’ombre : ce maillage, le cadre de la déco et les 5 parties des deux avatars.
2. **Triangles de la plage : 19 008 → 16 320 dans le batch des props** (passe principale + ombres). On a retiré des faces jamais visibles : la moitié basse des dunes, sous le sable opaque ; les bouchons internes des troncs de palmier ; et le ballon de plage passe de 72 à 36 segments.
3. **Premiers voyages.** Le premier aller appart → plage liait 13 programmes de shaders d’un coup, et le retour en reliait 8. Dans le profil headless, ~90 % de la longue tâche venait de là. Désormais, une fois par session, 2,5 s après l’arrivée dans l’appartement et sur temps libre, la plage est montée 3 images dans une scène jamais rendue (événements coupés). Ses programmes sont alors compilés, avec les lumières et le brouillard de la plage, les avatars sous ces lumières et les variantes d’ombre, sur des matériaux gardés en vie. Ils sont ensuite « finis » (premier usage) un par tranche de temps libre (`src/render/prewarm/`). Résultat : 0 programme lié pendant les voyages (avant : 13 / 8 / 5 / 8). `?prewarm=0` désactive ce préchauffage.

Garde : `perf-baseline --check` échoue maintenant si le total de l’appartement n’est pas **strictement sous 120**.

### Répétabilité et variance des mesures (19 nov. 2026)

**Protocole de `perf-baseline`** (un run = un contexte de navigateur neuf) :

1. URL fixe, uniquement les paramètres de la scène (`?lieu=appart|plage&fresh=1&perf=1`) : sauvegarde en mémoire neuve, apparition et caméra par défaut. La position et l’orientation de la caméra sont relevées à chaque run ; l’outil signale toute différence (aucune observée).
2. Attente d’un état, pas d’un délai : jeu `ready`, puis compilation de tous les shaders de la scène (`renderer.compileAsync`), puis le même nombre de draw calls et de programmes pendant `STABLE` (10) images consécutives.
3. `FRAMES` images consécutives lues juste après chaque `renderer.render()`. En parallèle, les appels WebGL `draw*` sont comptés directement sur le contexte et séparés selon la cible (écran = passe principale, framebuffer = cartes d’ombre) : contrôle indépendant de `drawCounter.ts`.
4. Fin du run : buffers WebGL vivants, tas JS après deux GC forcés, temps de frame p50 / p95 / p99.

Par run on garde la médiane des images ; entre les runs on donne min / médiane / max / écart-type (σ, n − 1).

**Résultats : 5 runs × 60 images par scène et par profil.** Chrome headless + SwiftShader (rendu CPU), **pas un appareil réel**. Machine partagée avec d’autres tests (charge moyenne 14–32 sur 8 cœurs pendant la mesure).

| Scène · profil | Draw calls total (principal + ombres) | Triangles (dont ombres) | Buffers GPU | Tas JS (Mo) | Frame p50 (ms) | Frame p95 (ms) | Frame p99 (ms) |
|---|---|---|---|---|---|---|---|
| Appartement · desktop | 154 (87 + 67), σ 0 | 84 268 (30 001), σ 0 | 505, σ 0 | 10,90 / 10,93 / 10,94, σ 0,02 | 133 / 166,5 / 200,9, σ 24,1 | 311,9 / 417 / 434,7, σ 49,8 | 391,7 / 567,6 / 603,3, σ 86,1 |
| Appartement · iPhone 15 | 150 (83 + 67), σ 0 | 84 038 (30 001), σ 0 | 497, σ 0 | 10,88 / 10,94 / 10,94, σ 0,03 | 99,2 / 104,5 / 134,1, σ 14,4 | 203,6 / 257,2 / 430,6, σ 89,8 | 233,8 / 341,6 / 554,9, σ 123,4 |
| Plage · desktop | 31 (21 + 10), σ 0 | 112 282 (44 069), σ 0 | 205, σ 0 | 10,38 / 10,40 / 10,40, σ 0,01 | 422,4 / 503,6 / 572,1, σ 53,9 | 917,5 / 1 121,3 / 1 484,9, σ 223,7 | 1 069,4 / 1 281,4 / 1 760,3, σ 296,4 |
| Plage · iPhone 15 | 31 (21 + 10), σ 0 | 112 282 (44 069), σ 0 | 205, σ 0 | 10,42 / 10,44 / 10,44, σ 0,01 | 252,9 / 274,3 / 362, σ 47,0 | 513,8 / 661,3 / 719,5, σ 81,2 | 520,5 / 792,1 / 847,6, σ 132,3 |

Format des cellules à dispersion : min / médiane / max. Compteurs : min = médiane = max.

**Lecture :**

- **Déterministes** (σ = 0 sur 5 runs, identiques d’une image à l’autre) : les draw calls (principal, ombres, total), les triangles et les buffers GPU. Les draws WebGL bruts égalent le total déclaré à chaque run. On peut donc garder ces compteurs comme garde-fous exacts.
- **Quasi stable** : le tas JS (σ ≤ 0,03 Mo).
- **Non exploitable comme garde-fou** : les temps de frame (σ jusqu’à 30 % de la médiane, p99 jusqu’à 1,6× entre runs). Ils dépendent de la charge CPU de la machine ; avec 60 images, p99 est presque le maximum. À ne suivre qu’en tendance, jamais en seuil.

Données brutes : `RUNS=5 FRAMES=60 … --table`, JSON dans `OUT`.

## Mesures (18 nov. 2026)

Chrome headless, SwiftShader (`--use-gl=angle --use-angle=swiftshader`). Le FPS (3–8) **n’est pas représentatif** d’un appareil réel — on s’appuie sur les compteurs `renderer.info`. Desktop 1440×900 @1x, iPhone 15 paysage 852×393 @3x. Qualité `high` sur desktop, `low` sur l’émulation iPhone (moins de lampes, d’où 4 draw calls et 2 géométries de moins dans l’appartement).

### Premier chargement (identique avant / après l’audit) — draw calls de la passe principale seulement

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
| `src/render/perf/drawCounter.ts` | comptage exact des draw calls : passe principale, passe d’ombres, total |
| `src/render/perf/perfStats.ts` | fenêtre FPS, instantané, `window.__perf`, disponibilité, toggle |
| `src/render/perf/PerfOverlay.tsx` | collecteur R3F (monté seulement si l’overlay est allumé) + HUD HTML |
| `src/render/dispose.ts` | `useDispose` / `disposeMesh` |
| `tools/perf-baseline.mjs` + `tools/perf-baseline.json` | garde des draw calls (médiane de N runs) et tableau de variance |
| `tools/e2e-lifecycle.mjs` | e2e cycle de vie du rendu : draws déclarés = draws WebGL, buffers GPU stables en voyage, studio libéré (DOM, contexte WebGL) |
| `tests/perf.test.ts` | unité : fenêtre, pire frame, toggle |
