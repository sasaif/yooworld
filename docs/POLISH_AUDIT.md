# YooWorld — audit plein écran mobile & polish visuel (branche `polish-mobile`)

## 1. Pourquoi le jeu apparaissait « dans un cadre noir »

Le canvas faisait déjà 100 % de la fenêtre (mesuré : 100 % de couverture sur les 7 viewports). Le « cadre » venait de :

1. **Fond de scène sombre** : `<color attach="background" args={['#2f2440']}>` + `body { background:#2f2440 }`. La pièce est un diorama flottant ; tout ce qui n’est pas la pièce était peint en violet presque noir → 46 % (iPhone paysage) à 62 % (iPhone portrait) de l’écran était du « vide noir ».
2. **Zoom caméra fixe** : `zoom = small ? 70 : 122`, quel que soit l’écran ou l’orientation. Sur téléphone paysage, la pièce ne prenait que 54 % de l’écran ; avatars à 55 px de haut.
3. **Meta viewport sans `viewport-fit=cover`** : sur iPhone, Safari laisse des bandes (encoche / Dynamic Island / barre d’accueil) peintes avec la couleur du body (sombre) → vraies bandes noires sur l’appareil.
4. **`height:100%` au lieu de `100dvh`**, body non fixé : sauts de mise en page et rebond quand les barres du navigateur mobile apparaissent/disparaissent.
5. Pas de manifest PWA, pas de `apple-mobile-web-app-capable`, pas de `theme-color` → barre d’état noire, pas de mode plein écran installable.
6. HUD : `safe-area-inset-top/bottom` seulement (pas gauche/droite) → en paysage, la Dynamic Island pouvait recouvrir les chips.

## 2. Caméra (avant)
- `OrthographicCamera` drei (iso, direction `(1, 1.05, 1.2)`), OrbitControls : 1 doigt = pan, pincement = zoom/rotation, molette = zoom ; `minZoom 45 / maxZoom 420` fixes.
- Suivi du joueur : cible à mi-chemin entre le centre de la pièce et le joueur (`lerp 0.45`).
- Aucune adaptation à la taille d’écran ni à la rotation (le frustum suivait, pas le zoom).

## 3. Changements (par priorité)

### P1 — Plein écran mobile paysage
- `index.html` : `viewport-fit=cover`, `user-scalable=no`, `theme-color`, `apple-mobile-web-app-*`, `mobile-web-app-capable`, manifest + icônes.
- `public/manifest.webmanifest` : `display: fullscreen` (fallback standalone), `orientation: landscape`.
- CSS : `html, body { position:fixed; inset:0 }`, `100dvh`, plus de scroll/rebond ; `.stage` plein écran avec **fond chaud en dégradé** (le canvas est transparent) → plus aucun vide sombre.
- Safe areas : variables `--sat/--sar/--sab/--sal` (`env(safe-area-inset-*)`) appliquées au HUD, au dock, aux panneaux.
- `src/app/screen.ts` : au premier toucher sur téléphone → `requestFullscreen()` + `screen.orientation.lock('landscape')` (Android Chrome/Samsung) ; échoue silencieusement ailleurs. Chip « ⛶ » plein écran sur appareils tactiles.
- `RotateOverlay` : téléphone en portrait → écran « Tourne ton appareil » (bouton plein écran paysage sur Android, astuce « Sur l’écran d’accueil » sur iPhone, lien « Continuer en portrait »). Tablettes et desktop jamais bloqués.
- `cameraFit.ts` : zoom calculé à partir de la silhouette projetée de la pièce et de la taille d’écran, **recalculé à chaque resize/rotation** (le zoom choisi par le joueur est conservé en ratio).

### P2 — Avatars plus grands + cadrage
- Échelle avatars **×1,10** : 0,96 m → 1,06 m = 90 % de l’ouverture de porte (1,18 m), juste sous le haut du frigo (1,10 m). Assis : hanches recalées sur le coussin (vérifié en capture `sit`).
- Le reste du gain vient de la caméra (zoom ajusté à l’écran) → la pièce et les avatars grandissent ensemble, proportions conservées, iso conservé.
- Pieds toujours visibles : `fullyVisible = true` sur les 7 viewports (bbox écran mesurée).
- Pincement / molette : limites relatives au zoom ajusté (0,7× → 3,2×). Caméra qui suit le joueur de plus près (`lerp 0.22`).
- Cycles marche/course ralentis selon l’échelle → pas de glissement des pieds.

### P3 — Avatars plus vivants (modèles conservés)
- Clignement des yeux aléatoire (blendshapes `Blink_L/R` déjà présents), petit sourire au repos, sourire assis, grand sourire (`joy`) en dansant, **lèvres qui bougent** pendant les bulles de chat.
- Lumière de contour (rim) + légère auto-illumination de la texture : visages lisibles même à l’ombre, personnages qui ressortent du décor.
- Contour cartoon (inverted hull, 1 draw call par avatar).
- Danse : rebond sur le temps, balancement des hanches, rotation du corps par-dessus le clip « Victory ».
- Pas de remplacement de modèle : aucune alternative testée n’était meilleure que Juanita/Juan pour ce style (voir docs/02-avatars.md) ; ils restent par défaut.

### P4 — Appartement
- Ombres douces (PCF soft), lumière principale plus chaude, ambiance chaude.
- Vitres couleur ciel, couloir visible derrière la porte, 3 tableaux encadrés, guirlande lumineuse, rayons de soleil au sol sous les fenêtres, paillasson « Bienvenue » — tout en procédural (≈ 7 draw calls).
- Interaction : « 💃 Danser » sur la radio (allume la musique et lance la danse).

### P5 — UI mobile
- Téléphone paysage : dock fin translucide (flou), chips compactes, panneaux (Sac, Boutique, Chat, Sol & murs, édition) en **panneau latéral droit** au-dessus du dock → les personnages restent visibles au centre.

## 4. Mesures avant / après

Mesures automatiques (`tools/devices.mjs`, `window.__metrics()`) — hauteur écran de l’avatar Juanita debout, en px CSS ; « pièce » = % de l’écran occupé par la pièce (le reste était du vide sombre avant, c’est un fond chaud après).

| Viewport | Zoom avant → après | Avatar avant → après | Pièce à l’écran avant → après | Draw calls avant → après |
|---|---|---|---|---|
| **iPhone 15 paysage 852×393** | 70 → 86,4 | **55 → 75 px (+36 %)** | **54,2 % → 76,0 %** | 72 → 80 |
| Pixel 7 paysage 915×412 | 70 → 92,7 | 55 → 80 px (+45 %) | 48,7 % → 76,9 % | 72 → 80 |
| iPhone 15 portrait 393×852 | 70 → 75,5 | 55 → 65 px (+18 %) | 41,7 % → 45,6 % * | 54 → 62 |
| Pixel 7 portrait 412×915 | 70 → 79,1 | 55 → 69 px (+25 %) | 38,2 % → 44,6 % * | 54 → 62 |
| iPad paysage 1024×768 | 122 → 125,4 | 96 → 109 px (+14 %) | 68,0 % → 71,0 % | 72 → 83 |
| iPad portrait 768×1024 | 122 → 147,5 | 96 → 128 px (+33 %) | 58,2 % → 74,2 % | 57 → 62 |
| Desktop 1440×900 | 122 → 147 | 96 → 128 px (+33 %) | 43,5 % → 62,9 % | 72 → 83 |

\* en portrait téléphone, l’écran « Tourne ton appareil » s’affiche ; chiffres mesurés après « Continuer en portrait ».

- Couverture du canvas : 100 % avant et après (le problème n’était pas la taille du canvas mais le vide sombre + le zoom fixe). Vide sombre : de 24–62 % de l’écran → 0 %.
- Triangles : ~30 k → ~59 k (le contour cartoon double la géométrie des avatars) — reste très léger pour un mobile. FPS : non mesurable de façon fiable en headless (rendu logiciel SwiftShader) ; à vérifier sur appareil réel. Si besoin, le contour peut être désactivé en qualité `low`.

## 5. Captures
- `shots/before/*.png` (site en ligne, branche main), `shots/after/*.png`, `shots/after/extra/` (portrait « continuer », panneaux Chat/Sac en paysage).
- Comparatifs : `shots/compare/<viewport>.png`, vue d’ensemble `shots/compare/overview.png`.

## 6. Limites connues
- **iPhone Safari** ne permet ni de verrouiller l’orientation ni le plein écran d’une page : on affiche l’écran « Tourne ton appareil » ; le vrai plein écran paysage passe par « Partager → Sur l’écran d’accueil » (manifest `fullscreen`/`landscape`, iOS respecte surtout `display`).
- Android : le verrou paysage n’est accordé qu’en plein écran, après un geste (premier toucher ou bouton).
- Les tests ont été faits en émulation (Chrome headless, viewports/DPR/touch des appareils), pas sur appareils physiques ; les encoches/insets réels ne sont pas simulés par l’émulation (safe areas = 0).
- Cheveux / vêtements : améliorés par l’éclairage et le contour seulement ; une vraie amélioration de géométrie (volume des cheveux, détails des vêtements) demande un travail d’asset (Blender) — prévu pour une phase suivante.
