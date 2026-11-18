# Yoo Plage — second lieu (branche `surprise-plage`)

Un lieu **public** accessible depuis le menu **Lieux** : une plage isométrique chaleureuse avec ponton,
café, bancs, transats sur serviettes, parasols, palmiers, cabine DJ + piste de danse lumineuse,
et une ambiance **jour / coucher de soleil** (ou cycle automatique lent).

## Jouer
- Dock → **Lieux** → **Yoo Plage · Y aller →** : fondu de transition (~1 s), Juanita et Juan arrivent sur le ponton.
- Toucher le sable / le ponton : marcher (double-toucher : courir). Pincer / molette : zoom. La caméra suit l’avatar.
- Toucher un **banc**, un **transat** ou une **serviette**, une **chaise de terrasse** → *S’asseoir / S’installer* (même système de sièges que l’appartement).
- Toucher la **cabine DJ** ou la **piste** → *Lancer la musique* (piste qui s’illumine au rythme, faisceaux, notes) et **💃 Danser** (l’avatar marche jusqu’à la piste puis danse).
- Toucher le **café** → *Commander* (bulle) ; panneau, château de sable, glacière… → *Regarder*.
- Dock → **☀️ Jour / 🌅 Coucher / 🔄 Auto** : lumière, ombres longues, brume, couleur de la mer, lanternes et lucioles suivent l’ambiance.
- Le lieu courant est **sauvegardé** (profil local) : on revient à la plage après rechargement. Retour : Lieux → Mon appart.
- Pas de faux joueurs : seuls les deux avatars locaux sont présents ; l’interface reste « Hors ligne ». Pas de PNJ.

## Architecture
| Fichier | Rôle |
|---|---|
| `src/game/beach/beachLayout.ts` | **pur** (testé) : dimensions, rivage `shoreX(z)`, ponton, liste des props (position, orientation, empreinte bloquante, sièges, actions), `beachNav()`, `beachSeats()` (ids `<prop>:<slot>` → `freeSeat()` réutilisé), spawn, points de danse |
| `src/game/GameController.ts` | `location` dans l’état + profil, `travel(id)`, `travelWithFade(id)`, `tapProp` / `interactProp`, `setMood` / `cycleMood`, `beachMusic` ; l’édition de meubles ne touche jamais la navigation de la plage |
| `src/render/beach/meshBuilder.ts` | fusionne des centaines de primitives colorées en **une** géométrie (couleurs par sommet + poids de vent `aSway` animé dans le vertex shader) |
| `src/render/beach/beachProps.ts` | construction procédurale de tous les props |
| `src/render/beach/water.ts` | shader de mer (profondeur, vaguelettes, écume qui monte et descend, sable mouillé, reflets dorés au coucher), texture de sable, scintillements |
| `src/render/beach/BeachView.tsx` | scène : sol, mer, props, voilier, mouettes, guirlandes, piste, faisceaux DJ, zones de toucher invisibles, menu contextuel, `BeachAmbience` (lumières, brouillard, cycle) |
| `src/ui/TravelFade.tsx` | fondu de voyage piloté par `requestAnimationFrame` |

## Performance (Chrome headless SwiftShader, mesuré via `window.__info`)
Voir `shots/surprise/metrics.json`.

| Scène | Draw calls | Triangles |
|---|---|---|
| Appartement (référence `polish-mobile`) | 80 (iPhone) / 83 (desktop) | ≈ 59 k |
| Yoo Plage, jour | **15–18** | ≈ 73 k |
| Yoo Plage, DJ + faisceaux | 18–19 | ≈ 73,5 k |
| Yoo Plage, coucher de soleil + DJ | 20–22 | ≈ 73,5 k |

Bien sous l’objectif de 150 draw calls ; ~59 k triangles viennent des deux avatars (contour cartoon compris), le décor complet de la plage ≈ 14 k.
Tout le décor statique = 1 draw call (+1 ombre) ; piste, guirlandes et mouettes sont instanciées. 2 lumières ponctuelles seulement (allumées au coucher).

## Tests
52 tests vitest au total (39 existants + 13 nouveaux), `tsc --noEmit` OK.
- `tests/beach.test.ts` : registre des lieux, mer/sable/ponton, registre des sièges (ids uniques, accessibles depuis le spawn, jamais dans l’eau), points de danse, changement de lieu aller/retour, fondu, persistance du lieu (et sauvegardes anciennes/inconnues → maison), s’asseoir (banc, serviette → transat), DJ (musique, danse), ambiance.
- `tools/e2e-beach.mjs` : bout en bout tactile iPhone paysage (menu Lieux, fondu, marcher, s’asseoir, danser, ambiance, persistance, retour maison, aucune erreur console / HTTP).
- `tools/surprise.mjs` : captures ; `tools/teaser.mjs` + `tools/teaser.sh` : teaser vidéo enregistré dans le vrai jeu (temps virtuel image par image).

## Limites connues
- S’asseoir *par terre* n’existe pas (pas d’animation au sol dans la bibliothèque Quaternius) : les serviettes portent un transat, toucher la serviette installe l’avatar sur le transat.
- Pas de baignade : la mer n’est pas praticable (le ponton s’avance au-dessus de l’eau).
- FPS non mesurable en headless (rendu logiciel) ; à vérifier sur un vrai téléphone.
- Multijoueur toujours non implémenté : la plage est « publique » dans le modèle de données (`public:beach` côté transport) mais hors ligne.
