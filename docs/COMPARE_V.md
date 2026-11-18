# Comparatif taille / cadrage des avatars — V1 · V2 · V3 (+ Vue perso)

Même appartement (sauvegarde par défaut), même lumière, même angle isométrique, mêmes positions de départ.
Captures : `tools/compare-v.mjs` (Chrome headless, émulation mobile, rendu logiciel SwiftShader) → `shots/compare-v/raw/` ;
couverture d’écran : `tools/coverage.py` (fond peint en vert pur, HUD caché, % de pixels non verts) ;
images : `tools/compare_v.py` → `shots/compare-v/<appareil>.png` + `shots/compare-v/overview.png` ; chiffres : `shots/compare-v/numbers.json`.

## Variantes (`?v=1|2|3`, voir `src/app/variant.ts`)
| | Échelle modèle | Zoom caméra (× zoom ajusté) | Suivi caméra |
|---|---|---|---|
| **V1** actuelle | ×1,10 (1,05 m) | ×1,00 | 22 % vers le centre de la pièce |
| **V2** ≈ 85 px | ×1,14 (1,09 m) | ×1,094 | idem |
| **V3** caméra rapprochée | ×1,14 (1,09 m, taille V2) | ×1,20 | 12 % (plus centré sur les avatars) |

Pourquoi pas 85 px uniquement en agrandissant le modèle : il faudrait ×1,25 → ≈ 1,19 m, **plus grand que l’ouverture de porte (1,18 m)**.
V2 combine donc +3,6 % d’échelle (proportions réalistes) et +9,4 % de zoom caméra (la pièce et les avatars grandissent ensemble).

## Proportions (hauteur avatar debout mesurée, `__metrics().worldH`)
| | Avatar | / ouverture de porte 1,18 m | / frigo 1,10 m | / dossier du canapé 0,55 m |
|---|---|---|---|---|
| V1 | 1,047 m | 89 % | 95 % | ×1,90 |
| V2 / V3 | 1,085 m | 92 % | 98 % | ×1,97 |
(référence réelle : adulte 1,75 m / porte 2,0 m = 87 %.)

## Mesures (avatar = hauteur écran de Juanita debout, px CSS ; écran couvert = % de l’écran occupé par la pièce ; pièce visible = part de la pièce à l’écran)
| Appareil | V1 | V2 | V3 | Vue perso (V2/V3) |
|---|---|---|---|---|
| **iPhone 15 paysage 852×393** | **75 px · 76,0 % · 94 %** | **85 px · 84,7 % · 88 %** | **93 px · 91,4 % · 79 %** | 156 px · 100 % · 31 % |
| Pixel 7 paysage 915×412 | 81 px · 76,9 % · 93 % | 91 px · 85,5 % · 87 % | 100 px · 92,1 % · 78 % | 167 px · 100 % · 30 % |
| iPad paysage 1024×768 | 109 px · 71,0 % · 98 % | 124 px · 79,2 % · 92 % | 136 px · 86,7 % · 83 % | 226 px · 100 % · 35 % |
| Desktop 1440×900 | 128 px · 62,9 % · 100 % | 145 px · 72,4 % · 100 % | 159 px · 80,6 % · 93 % | 265 px · 100 % · 41 % |

Pieds et têtes entièrement visibles dans les 24 captures ; 0 erreur console.

## Recommandation
**V2 par défaut + bouton 🔍 Vue perso.** V2 atteint 85 px sur iPhone paysage en gardant 88 % de la pièce visible
(la cuisine et le lit restent à l’écran) et des proportions réalistes (92 % de la porte).
V3 donne 93 px mais coupe ~21 % de la pièce (coin cuisine, haut des murs) : l’appartement devient moins « immersif ».
Le besoin « gros plan » est mieux couvert par **Vue perso** (×2 du zoom ajusté, ~156 px, centrée sur l’avatar et qui le suit).

## Zoom optionnel
- Bouton **🔍 Vue perso / 🏠 Vue appart** dans la barre du haut : transition douce (650 ms, smoothstep, indépendante du nombre d’images/s),
  la caméra se recentre sur l’avatar (Vue perso) ou sur la pièce (Vue appartement). Préférence mémorisée (`localStorage yw.camView`).
- Pincement / molette toujours actifs (limites 0,7× → 3,2× du zoom ajusté) ; un pincement interrompt la transition.
