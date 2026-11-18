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
- Pieds dans le vide sur les chaises et le tabouret (jambes chibi courtes), comme avant.
- Allongée, le chignon touche le bord de la tête de lit, comme avant.
- Le « saut » sur le tabouret a une petite pénétration de l'arrière du corps (7,4 cm mesurés, invisible sur les planches).
- Quand l'avant d'un siège est bloqué, l'avatar s'assoit en glissant de côté. C'est plausible, mais moins naturel qu'en reculant.
- Après s'être relevé, c'est le lissage de rotation habituel du joystick qui reprend la main. Je ne l'ai pas mesuré et je n'ai pas touché au système de déplacement.
- Transats de la plage : ancienne animation.
