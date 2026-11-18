# Licences des assets et du code

| Élément | Fichier(s) | Licence | Source |
|---|---|---|---|
| Juanita (femme) | `assets-src/avatars/juanita_female*.{glb,vrm}`, `public/models/avatars/juanita_female.glb` | **CC0** (crédit facultatif : « Juanita, 100Avatars by Polygonal Mind ») | 100Avatars R3, Polygonal Mind |
| Juan (homme) | `assets-src/avatars/juanita_male.{glb,vrm}`, `public/models/avatars/juanita_male.glb` | **CC0** (œuvre dérivée de Juanita) | dérivé Yooville (scripts dans `assets-src/avatars/blender/`) |
| Animations | `public/models/anim/QACP_Casual_Female_23bones.glb` | **CC0** | Quaternius — Animated Characters Pack |
| Meubles, murs | `public/models/furniture/*.glb` | **CC0** (`LICENSE_Kenney_FurnitureKit.txt`) | Kenney — Furniture Kit 2.0 |
| Miniatures du catalogue | `public/thumbs/*.webp` | **CC0** | rendus isométriques du Kenney Furniture Kit (convertis en WebP) |
| Textures sol/mur | générées par code (`render/apartment/finishTextures.ts`) | code du projet | — |
| Bibliothèques | three, @react-three/fiber, @react-three/drei, React, Vite, vitest | MIT | npm |

- Aucun asset Daydaze ni aucun asset sous licence restrictive n’est inclus.
- Aucun achat, aucun compte créé.
- « YoWorld » est une marque d’un tiers : le nom du projet (« YooWorld ») est un nom de travail ; ne pas reprendre logos, assets ou noms de YoWorld. À vérifier avec un juriste avant toute publication commerciale.

## Ajouts branche `polish-mobile`
| Élément | Fichier(s) | Licence | Source |
|---|---|---|---|
| Icônes PWA | `public/icons/*.png` | code/œuvre du projet | générées par script Python (PIL) |
| Tableaux, guirlande, tapis « Bienvenue », rayons de soleil | `src/render/apartment/Decor.tsx` | code du projet | textures procédurales (canvas), aucun asset externe |
| Expressions faciales | blendshapes déjà présents dans Juanita/Juan (CC0) | CC0 | 100Avatars R3 |

Aucun nouvel asset téléchargé, aucun achat.

## Ajouts branche `surprise-plage` (Yoo Plage)
| Élément | Fichier(s) | Licence | Source |
|---|---|---|---|
| Tout le décor de Yoo Plage : ponton, café, bancs, transats, serviettes, parasols, palmiers, cabine DJ, piste de danse, rochers, château de sable, dunes, voilier, mouettes, guirlandes | `src/render/beach/beachProps.ts`, `src/render/beach/BeachView.tsx` | code du projet | géométrie **100 % procédurale** (boîtes, cylindres, cônes, sphères), aucun modèle téléchargé |
| Mer animée, sable, scintillements | `src/render/beach/water.ts` | code du projet | shaders GLSL + texture canvas générés par code |
| Panneaux « Café Yoo », menu, « Yoo Plage » | `src/render/beach/BeachView.tsx` | code du projet | textures canvas générées (police système) |
| Teaser vidéo et captures | `shots/surprise/*` | œuvre du projet | rendus du jeu (Chrome headless) ; carton-titre en police Poppins (SIL Open Font License, utilisée seulement pour le rendu de l’image, non embarquée dans le jeu) |

Aucun nouvel asset téléchargé, aucun achat, aucun service tiers.

## Ajouts branche `feature/avatar-fashion-economy` (Style, boutique mode, économie)
| Élément | Fichier(s) | Licence | Source |
|---|---|---|---|
| Base des avatars personnalisés | Juanita / Juan (ci-dessus) | **CC0** | 100Avatars R3 — Polygonal Mind (Juan : dérivé du projet) |
| Correction UV des jambes de Juan (permet les shorts) | `public/models/avatars/juanita_male.glb` (original dans `assets-src/`) | **CC0** (dérivé) | script `tools/fashion/build_parts.py` |
| Masque d'atlas, métadonnées de pièces | `public/models/avatars/atlas_mask.png`, `*.parts.json` | code du projet | générés par `tools/fashion/build_parts.py` à partir des GLB CC0 |
| Morphs du visage (formes de visage, yeux, nez, bouche, sourcils) | `src/render/avatar/custom/faceMorphs.ts` | code du projet | calculés en code sur la géométrie CC0 |
| Coiffures, barbes, bottes, capuche/col fourrure, tous les accessoires | `src/render/avatar/custom/builders.ts` | code du projet | géométrie **100 % procédurale** ou réutilisation des mèches/chignons CC0 de Juanita/Juan |
| Recoloration, motifs, imprimés, maquillage, taches de rousseur | `src/render/avatar/custom/composite.ts`, `decals.ts` | code du projet | peints par code (Canvas 2D) |
| Miniatures de la boutique | `public/thumbs/fashion/*.webp` | **CC0** (dérivé) | rendus automatiques du jeu (`tools/fashion/thumbs.mjs`) |
| Icônes | emoji système | — | aucune image téléchargée |

Aucun nouvel asset téléchargé, aucun achat, aucun fournisseur de paiement connecté.
