# 13 · Interactions : transitions, registre des meubles, chat repliable

Branche `feature/interaction-polish`, partie de `feature/polish-experience` (800930b). En ligne : https://sasaif.github.io/yooworld/interactions/
Le cadrage, la taille des avatars (V3, environ 93 px sur iPhone 15), l'interface et la direction visuelle n'ont pas changé : ils sont validés par l'utilisateur.

## 1. Transitions (debout ↔ assis ↔ allongé ↔ debout)

La logique pure est dans `src/game/interact/seatMotion.ts`, une machine d'états testée. Le rendu est dans `src/render/Character.tsx` et `src/render/avatar/sitPose.ts`.

```
arrivée ─► turn ─► down ─► seated                     (chaise, tabouret, canapé, fauteuil, bord du lit)
                       └► recline ─► lying           (lit : s'asseoir au bord, puis s'allonger)
se lever = les mêmes courbes à l'envers depuis la pose actuelle : lying ─► unrecline ─► up ─► libre
```

- **turn** : l'avatar marche les derniers centimètres jusqu'au point d'approche (les pieds bougent) et se retourne dos au siège. La durée est proportionnelle à l'angle : 0,45 s au maximum pour un demi-tour, 0,18 s au minimum. Le joystick n'a plus de rotation instantanée.
- **down** (0,55 à 0,7 s selon le preset) : la racine glisse sous l'assise et le poids de la pose assise monte de 0 à 1. Le bassin **monte d'abord à la hauteur du coussin, puis recule** : il ne traverse plus l'avant d'un tabouret haut ou d'une chaise.
- **recline** (1,1 s, lit) : courbes décalées. Les jambes s'allongent d'abord (0 à 55 %), puis le buste bascule en arrière (5 à 85 %), puis le bassin remonte sur le matelas (30 à 100 %) avec un petit arc de 3 cm. Les bras glissent le long du corps, la tête se penche sur l'oreiller et le sac à dos rétrécit au lieu de disparaître d'un coup. **unrecline** dure 0,9 s, **up** de 0,5 à 0,55 s.
- **Interruption** (joystick, tap ou clic ailleurs) : la transition repart à l'envers depuis la pose du moment. Par exemple, interrompu à 45 % de « down », l'avatar se relève en environ 0,25 s, sans saut.
- **Approche quand l'avant du siège est bloqué** (chaise sous la table, canapé contre un meuble) : `resolveApproaches()` dans `worldSync.ts` recule un peu le point d'arrivée, sinon l'avatar arrive par le côté et glisse latéralement sur le siège. Avant, il glissait à travers les meubles sur 0,65 m.

**Bug corrigé en chemin (important) :** le `PropertyMixer` de Three.js ne réécrit un os que si la valeur animée a changé. Les modifications du calque procédural restaient donc d'une image à l'autre et s'accumulaient : le bassin rebondissait jusqu'à 16 cm par image pendant les fondus. `SitPose.snapshot()` et `restore()` sauvegardent la pose animée et la remettent en place avant chaque `mixer.update`.

### Mesures

Mesuré en temps virtuel à 60 i/s exactes (`tools/seq-capture.mjs`). On compare l'avatar d'une image à la suivante : position au sol, os du bassin (Hips), os de la tête, orientation. La pénétration est le point du corps le plus bas sous la surface de l'assise, dans l'emprise du meuble (un point sur deux, une image sur trois).

**Pendant les transitions** (les images où l'on marche sont exclues) :

| Siège | Racine max / image | Bassin max / image | Rotation max / image |
|---|---:|---:|---:|
| tabouret | 0,99 cm | 3,50 cm | 10° |
| chaise en bois | 1,62 cm | 2,72 cm | 10° |
| chaise de bureau | 0,94 cm | 1,93 cm | 10° |
| canapé | 1,55 cm | 2,08 cm | 10° |
| fauteuil | 1,58 cm | 2,08 cm | 10° |
| bord du lit | 0,86 cm | 1,97 cm | 10° |
| s'allonger et se relever | 2,06 cm | 2,07 cm | 10° |
| interruption en s'asseyant | 1,55 cm | 2,04 cm | 10° |
| interruption en s'allongeant | 1,71 cm | 1,97 cm | 10° |

Les seuils demandés étaient moins de 6 cm et moins de 15° par image. Sur toute la séquence, marche comprise, le plus grand saut est de 3,74 cm : c'est la vitesse de marche normale sur la dernière image avant le demi-tour.

**Pénétration maximale sous l'assise pendant une transition :**

| Siège | iPhone 15 | Ordinateur |
|---|---:|---:|
| tabouret | 7,4 cm (pendant down et up) | 7,4 cm |
| chaise de bureau | 1,9 cm | – |
| canapé | 1,5 cm | 1,5 cm |
| fauteuil | 1,4 cm | – |
| chaise en bois | 0 | 0 |
| bord du lit | 0 | – |
| s'allonger | 6,4 cm (pendant le demi-tour, au pied du lit) | 1,3 cm |
| interruption en s'allongeant | 1,2 cm | 1,2 cm |

Le 7,4 cm du tabouret vient de quelques points de l'arrière du corps qui passent juste sous l'avant de l'assise pendant le « saut » sur le tabouret. On ne le voit pas sur les planches. Les mêmes chiffres sont dans `shots/interactions/raw/metrics_*.json`, qui n'est pas versionné : relance l'outil pour le recréer.

### Planches et vidéo (relues image par image)

- `shots/interactions/seq_<siège>_iphone15.png` : stool, chair, deskChair, sofa, armchair, bedEdge, lie, interruptSit, interruptLie.
- `shots/interactions/seq_<siège>_desktop.png` : stool, chair, sofa, lie, interruptSit, interruptLie.
- `shots/interactions/transitions_iphone15.mp4` : 35 s, iPhone 15 en paysage, temps virtuel à 30 i/s. On y voit les 9 séquences à la suite.

## 2. Registre d'interactions (`src/data/interactionRegistry.ts`)

Une entrée par type de meuble :
- `interactions` : `sit`, `lie`, `watch` ou `use` ;
- `sit[]` : places avec `x`, `hipZ`, la hauteur réelle du coussin `h` et un `preset` ;
- `lie[]` : places pour s'allonger avec `footZ`, `h` et `edge`, la place du bord du lit par laquelle on monte.

Les presets sont `stool`, `chair`, `deskChair`, `sofa`, `armchair`, `bedEdge` et `lie`. Chacun fixe les directions des os (`SitStyle`), la distance d'approche, la position des pieds et les durées de transition.
- Le canapé design a maintenant 3 places, le canapé rose et le canapé d'angle 2. Le lit double a 2 places allongées et 2 places au bord : Juanita et Juan peuvent partager le lit ou le canapé. L'occupation est gérée par `freeSeat()`.
- Le champ `seat` du catalogue est **dérivé** du registre par `legacySeat()`. Il n'y a donc qu'une seule source.
- `validateRegistry()` est testé : places dans les dimensions du modèle, hauteur du coussin dans le modèle, durées et distances d'approche raisonnables, places voisines espacées d'au moins 0,34 m, places allongées liées à leur bord.
- **Ajouter une chaise :** une entrée dans le registre, avec la hauteur mesurée par `tools/seat_heights.py`. Rien à changer dans le rendu ni dans l'interface.
- **Transats de Yoo Plage : pas encore migrés.** Ils gardent l'ancienne animation SitDown, sans nouvelles transitions. Il faudrait mesurer la hauteur et l'inclinaison du transat, avec un preset « couché incliné ».

## 3. Chat

Le design ne change pas.
- **Repliable :** une flèche ▾ ou ▸ sur le titre replie la carte en un bandeau de 44 px, avec un compteur de messages non lus. Toucher le titre la rouvre. L'état est gardé dans `localStorage` (`yw.chatCollapsed`).
- **Longs messages :** `overflow-wrap:anywhere` et `bdi` / `dir="auto"` pour l'arabe (هاي). La liste défile verticalement, avec une hauteur maximale, et le dernier message est toujours visible. Une bulle au-dessus de l'avatar fait au plus 220 px, sur une ligne avec « … ».
- **Note « Mode local » :** elle n'est plus coupée. Une ligne courte (« Visible seulement sur cet appareil. ⓘ ») s'affiche, et un toucher déplie le texte complet.
- **Réponses rapides :** elles défilent à l'intérieur de la carte, avec une marge et un fondu à droite. La dernière est entièrement visible une fois la rangée défilée.
- Vérifié avec `tools/chat-shots.mjs` (10 vérifications) et les captures `shots/interactions/chat_*_iphone15.png`.

## 4. Limites (honnêtes)

- Tout a été vérifié en émulation (Chrome headless, iPhone 15 en paysage et ordinateur), pas encore sur le vrai iPhone pour cette branche.
- ~~Pieds dans le vide sur les chaises et le tabouret~~ : réglé par l'option C (§5).
- Allongée, le chignon touche le bord de la tête de lit, comme avant.
- Le « saut » sur le tabouret a une petite pénétration de l'arrière du corps (7,4 cm mesurés, invisible sur les planches).
- Quand l'avant d'un siège est bloqué, l'avatar s'assoit en glissant de côté. C'est plausible, mais moins naturel qu'en reculant.
- Après s'être relevé, c'est le lissage de rotation habituel du joystick qui reprend la main. Je ne l'ai pas mesuré et je n'ai pas touché au système de déplacement.
- Transats de la plage : ancienne animation.

## 5. Branche `feature/gameplay-polish` (passe gameplay)

### Déplacement
- Profils de marche `?walk=a|b|c` : a 1,615 m/s, **b 1,482 m/s (défaut)**, c 1,33 m/s ; course 1,9 m/s avec le bouton 🏃
  (ou la touche R). `?move=classic` garde exactement l'ancien contrôleur (accélération 14 / freinage 32 1/s, 1,9 m/s).
- Vitesse lissée au 2e ordre (filtre critique, `walkProfile.ts` `SMOOTH` : départ ω = 10, arrêt ω = 18) : 50 % de la
  vitesse en 0,17 s, 95 % en 0,47 s ; à l'arrêt, l'avatar glisse 2·v/ω (≈ 16 cm à 1,48 m/s) et s'arrête en ≈ 0,3 s.
- Allure : la marche et la course jouent à vitesse / foulée **mesurée** du clip (`animBlend.ts` `STRIDE` marche 0,377,
  course 1,9 × échelle 1,14). Avant, la foulée de marche était surestimée d'environ 2,2× (les pieds glissaient de 54 %).
- Double toucher au sol : il ne marchait jamais (la mise à jour du dernier toucher était dans un commentaire) ; corrigé et testé.

### Option C : meubles abaissés (validée par l'utilisateur : « ajuste les meubles, sans allonger les tibias »)
Seuls les pieds des meubles sont raccourcis (`src/data/furnitureReshape.ts`) : les sommets sous le bas de l'assise sont
compressés, tout ce qui est au-dessus descend d'autant. Largeur, profondeur, dossier et squelette des avatars : inchangés.

| Meuble | Assise avant → après | Pieds de l'avatar |
|---|---|---|
| chaise | 0,288 → 0,195 m | à plat au sol |
| chaise de bureau | 0,280 → 0,195 m | à plat au sol |
| tabouret de bar | 0,522 → 0,422 m (−10 cm) + **repose-pied circulaire** (haut 0,26 m, rayon 0,17 m, centré 11 cm vers l'avant) | posés sur l'anneau |
| canapé, fauteuil, canapé d'angle | 0,276 → 0,216 m (−6 cm) | à plat au sol |

- Pose assise : quand un preset a `soleY` (hauteur visée des semelles), l'inclinaison des cuisses est calculée pour chaque
  jambe à partir des vraies longueurs d'os (`sitPose.ts` `solveDroop`), pour Juanita comme pour Juan.
- Ancrages retouchés pour éviter que les cuisses rentrent dans l'assise : canapé/fauteuil assis au bord (hipZ 0,25),
  canapé d'angle −0,08, chaise de bureau 0,20, tabouret 0,13 ; tibias du canapé un peu vers l'avant (−18°).
- **Pouf : non ajouté.** Avec −6 cm, les pieds touchent déjà le sol ; un pouf devant le canapé serait exactement sur la
  case où l'avatar se place pour s'asseoir. À rediscuter si l'utilisateur veut un pouf comme meuble à part.

Mesures (`tools/seq-capture.mjs`, temps virtuel 60 i/s, Juanita / Juan ; « peau dans le meuble » = sommet le plus profond à
l'intérieur des triangles du meuble, pendant toute l'assise et le relevé) :

| Siège | Semelles assis, avant → après (m) | Peau dans le meuble, avant → après (cm) |
|---|---|---|
| chaise | 0,119 / 0,098 → 0,002 / 0,002 | 0,7 / 0,3 → 1,0 / 0,8 |
| chaise de bureau | 0,111 / 0,091 → 0,002 / 0,003 | 0,9 / 1,1 → 1,0 / 0 |
| tabouret | 0,336 / 0,315 → 0,266 / 0,266 (anneau à 0,26) | 0 / 0 → 0,5 / 0 (0,8 si on arrive par le côté) |
| canapé | 0,160 / 0,146 → 0,001 / 0,001 | 1,1 / 1,7 → 0,9 / 1,5 |
| fauteuil | 0,160 / 0,146 → 0,001 / 0,001 | 0,9 / 1,5 → 0,9 / 1,5 |
| canapé d'angle | 0,160 → 0,001 | 0,7 → 0,6 / 0,2 |

Limites vérifiées par `CHECK=1` (et en CI) : semelles ≤ 1 cm du sol, semelles du tabouret à 0,26 ± 0,012 m et anneau sous
les deux pieds, peau dans le meuble ≤ 1,0 cm (tabouret), 1,2 cm (chaises), 1,6 cm (canapé, fauteuil), 1,0 cm (angle).
Captures avant/après : `gameplay/screens/r2_<siège>_<f|m>_before_after.png` (hors dépôt).

### Interface
- Le dock ne recouvre plus le bouton 🏃 : sur un écran étroit (iPhone SE 667×375, il le recouvrait de 36 px) il commence
  8 px après ; il reste centré quand il tient. En paysage ≤ 740 px, 58 px sont gardés à droite pour le bouton Humeur
  d'Art & Avatars (qui se place à côté du dock à ces tailles). `tools/e2e-layout.mjs` le vérifie de 667 à 932 px, avec et
  sans un bouton Humeur émulé, en mode normal et `?move=classic`.
- Étiquettes de nom jamais sous les puces du haut ; chat au-dessus du clavier iOS (hauteurs visibles 100 à 170 px).

### Tests et CI
- `.github/workflows/ci.yml` : tsc, vitest, build, puis les e2e en headless (gameplay, sièges `CHECK` pour Juanita et Juan,
  step2, joystick nouveau modèle et `?move=classic`, mise en page, expérience, perf). Chaque job et chaque étape e2e a un
  `timeout-minutes`.
- `tools/e2e-joystick.mjs` : sous `?move=classic`, les 3 contrôles d'origine (vitesse des clips, accélération, arrêt
  immédiat) sont inchangés ; avec le nouveau modèle, ils sont remplacés par leurs équivalents chiffrés (formules exactes
  du filtre critique, ±5 % / ±3 images ; foulée ±3 %).

### Limites
- Tout est vérifié en émulation (Chrome headless + SwiftShader), pas encore sur le vrai iPhone.
- Canapé d'angle : un saut de 7,5 cm sur une image au moment de se tourner (il existait avant : 8,2 cm) ; hors limites,
  donc il n'est pas dans le lot `CHECK` de la CI.
- Le contact « peau dans l'assise » de ~1 cm sur les chaises est celui d'un coussin qui s'enfonce (avant : 0,3 à 1,1 cm).
