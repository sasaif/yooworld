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
- **Marche / course séparées (19 nov. 2026, branche `feature/walk-run-separation`)** : voir §6. Les profils `?walk=a|b|c`
  ci-dessous sont remplacés.
- (historique) Profils de marche `?walk=a|b|c` : a 1,615 m/s, b 1,482 m/s (défaut), c 1,33 m/s ; course 1,9 m/s avec le bouton 🏃
  (ou la touche R). `?move=classic` garde exactement l'ancien contrôleur (accélération 14 / freinage 32 1/s, 1,9 m/s).
- Vitesse lissée au 2e ordre (filtre critique, `walkProfile.ts` `SMOOTH` : départ ω = 10, arrêt ω = 18) : 50 % de la
  vitesse en 0,17 s, 95 % en 0,47 s ; à l'arrêt, l'avatar glisse 2·v/ω et s'arrête en ≈ 0,3 s.
- Allure : la marche et la course jouent à vitesse / foulée **mesurée** du clip (`animBlend.ts` `STRIDE` marche 0,377,
  course 1,9 × échelle 1,14). Avant, la foulée de marche était surestimée d'environ 2,2× (les pieds glissaient de 54 %).
- Double toucher au sol : il ne marchait jamais (la mise à jour du dernier toucher était dans un commentaire) ; corrigé et testé.

### Option C : meubles abaissés (validée par l'utilisateur : « ajuste les meubles, sans allonger les tibias »)
Seuls les pieds des meubles sont raccourcis (`src/data/furnitureReshape.ts`) : les sommets sous le bas de l'assise sont
compressés, tout ce qui est au-dessus descend d'autant. Largeur, profondeur, dossier et squelette des avatars : inchangés.

| Meuble | Assise avant → après | Pieds de l'avatar |
|---|---|---|
| chaise | 0,288 → 0,195 m | presque au sol |
| chaise de bureau | 0,280 → 0,195 m | presque au sol |
| tabouret de bar | 0,522 → 0,422 m (−10 cm) + **repose-pied circulaire** (haut 0,26 m, rayon 0,17 m, centré 11 cm vers l'avant) | posés sur l'anneau |
| canapé, fauteuil, canapé d'angle | 0,276 → 0,216 m (−6 cm) | 2 à 5 cm au-dessus du sol |

- Pose assise : quand un preset a `soleY` (hauteur visée des semelles), l'inclinaison des cuisses est calculée pour chaque
  jambe à partir des vraies longueurs d'os (`sitPose.ts` `solveDroop`), pour Juanita comme pour Juan.
- Ancrages retouchés pour éviter que les cuisses rentrent dans l'assise : canapé/fauteuil assis près du bord (hipZ 0,23),
  canapé d'angle −0,08, tabouret 0,13.
- **Pouf : non ajouté.** Un pouf devant le canapé serait exactement sur la case où l'avatar se place pour s'asseoir. À rediscuter si l'utilisateur veut un pouf comme meuble à part.

- La cuisse ne descend jamais à plus de 25° (posture validée, vérifiée par `e2e-experience` : cuisses ≤ 25°, genoux
  70–120°, semelles au-dessus du sol). Quand la jambe chibi ne suffit pas, les pieds restent donc un peu au-dessus du sol.

Mesures (`tools/seq-capture.mjs`, temps virtuel 60 i/s, Juanita / Juan ; semelles = sommet le plus bas assis ; « peau dans
le meuble » = sommet le plus profond à l'intérieur des triangles du meuble, pendant toute l'assise et le relevé) :

| Siège | Semelles assis, avant → après (m) | Peau dans le meuble, avant → après (cm) |
|---|---|---|
| chaise | 0,119 / 0,098 → **0,027 / 0,012** | 0,7 / 0,3 → 1,0 / 0,5 |
| chaise de bureau | 0,111 / 0,091 → **0,027 / 0,012** | 0,9 / 1,1 → 1,0 / 1,4 |
| tabouret | 0,336 / 0,315 → **0,266 / 0,266** (anneau à 0,26 : pieds posés dessus) | 0 / 0 → 0,5 / 0 |
| canapé | 0,160 / 0,146 → **0,047 / 0,024** | 1,1 / 1,7 → 1,0 / 1,9 |
| fauteuil | 0,160 / 0,146 → **0,047 / 0,024** | 0,9 / 1,5 → 1,0 / 1,9 |

Pour que Juanita pose vraiment les pieds à plat, il faudrait environ 2,5 cm de moins sur les chaises et 4,5 cm de moins
sur le canapé (ou un pouf, voir plus haut) : décision à prendre avec l'utilisateur.

Limites `CHECK=1` (CI) : semelles ≤ 3,5 cm (chaises) et ≤ 5,5 cm (canapé, fauteuil), tabouret 0,26 ± 0,012 m avec l'anneau
sous les deux pieds ; peau dans le meuble ≤ 1,0 (tabouret), 1,2 (chaises), 1,6 cm (canapé, fauteuil) pour Juanita ; Juan
(jamais contrôlé avant) : son contact d'avant l'option C + 0,3 cm. Captures avant/après :
`gameplay/screens/r2_<siège>_<f|m>_before_after.png` (hors dépôt).

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
- Juan allongé sur le transat de la plage : 1,0 cm dans la toile (limite 0,5, fixée pour Juanita) ; pas encore dans la CI.

## 6. Branche `feature/walk-run-separation` (marche / course séparées)

Bug signalé sur `combined-1` : course désactivée, l'avatar se mettait parfois à courir joystick poussé à fond.

**Cause.** L'animation était choisie par la seule vitesse réelle (`animBlend.gaitBlend`) : le clip de marche ne pouvait
pas dépasser 1,9× (≈ 0,82 m/s), donc au-delà le clip de **course** prenait le relais, même bouton 🏃 éteint. À fond
(1,48 m/s) le poids du clip de course était 1 (l'ancien `e2e-joystick` vérifiait même « max = run »). En plus, couper la
course en mouvement faisait chuter la vitesse d'un coup (plafond de vitesse du filtre = nouvelle vitesse max, en une image).

**Nouvelle logique** (`walkProfile.ts`, `animBlend.modeBlend`, `playerMotion.ts`) :
- Deux entrées indépendantes : la **zone morte** (10 %) et une courte rampe jusqu'à 25 % de course du stick, puis
  l'intensité ne change plus la vitesse ; **le mode** (marche / course) vient uniquement du bouton 🏃 (ou R au clavier).
  Marche par défaut, jamais mémorisé. Il n'y a plus de marche rapide ni de marche intermédiaire.
- Vitesse de marche retenue : **1,2 m/s**, celle de la « marche lente » de la première vidéo de comparaison
  (`041d39a`, `movement-reports/video/slow_walk.mp4`) — clip Walk à ≈ 2,79×, pieds posés. Sur l'ancien profil b
  de l'UAT (`59f577c`, fond 1,482 m/s), 1,2 m/s correspondait à un appui d'environ 73 % ; on ne reprend pas
  1,482 m/s, pour ne pas accélérer quand on pousse plus fort.
- Cibles (réglables, `?speeds=marche,course` pour tester sur iPhone) :

| Joystick | Course désactivée | Course activée |
|---|---|---|
| ≤ 10 % | arrêt (zone morte) | arrêt |
| 10–25 % | rampe douce vers 1,2 m/s | rampe douce vers 2,8 m/s |
| ≥ 25 % (y compris à fond) | **une seule marche, 1,2 m/s** | **course 2,8 m/s** |

- Animation : en mode marche, uniquement le clip **Walk** (poids du clip Run = 0, quelle que soit l'intensité du
  stick) à vitesse / foulée mesurée de marche, plafonné au rythme planté de 1,2 m/s (≈ 2,79×, ≈ 4,47 pas/s) —
  le « slow walk » de la première vidéo de comparaison. Ce plafond s'applique aussi pendant le ralentissement
  de 0,3 s (2,8 → 1,2), pour qu'une lecture plus rapide du clip Walk (l'ancien 4,2× à 1,8 m/s) ne joue jamais
  bouton course éteint. En mode course : clip Walk aux basses vitesses (rampe) puis fondu vers Run ; à 2,8 m/s
  = 1,29× (plafond 1,4).
- Course → marche en mouvement : la vitesse redescend en douceur de 2,8 à 1,2 m/s (≈ 0,3 s, filtre critique ω = 18).
  Le poids du clip Run s'estompe et le clip Walk reprend au rythme planté de 1,2 m/s (≈ 2,79×). Le plafond
  anti-dépassement du filtre ne coupe plus la vitesse d'un coup.
- Tap-to-move / clic : la course ne vient plus du double toucher, seulement du bouton 🏃 (`?move=classic` garde l'ancien
  comportement). Vitesses du trajet inchangées (0,85 / 1,9 m/s).
- Clavier : Maj (intensité 0,5) donne déjà la marche à 1,2 m/s, comme un stick poussé à fond ; R = bouton 🏃.

Tests : `tests/walk-profile.test.ts` (courbe, vitesses, mode, transitions) ; `tools/e2e-walk-run.mjs` (vrais touchers,
temps virtuel 60 i/s, iPhone 15 852×393 et SE 667×375 ; `VIDEO=dossier` enregistre la vidéo de comparaison).
