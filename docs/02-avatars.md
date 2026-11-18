# 02 — Évaluation des avatars (`yooville_juanita_pair_light.zip`)

## Contenu de l'archive (vérifié fichier par fichier)
| Fichier | Taille | Triangles | Matériau | Texture | Remarques |
|---|---|---|---|---|---|
| `juanita_female.glb` | 4 570 916 o | 13 504 | 1 primitive, 1 matériau, **KHR_materials_unlit** | 2048² PNG RGBA (3,07 Mo) | pas de COLOR_0 |
| `juanita_male.glb` | ≈3,47 Mo | 11 261 | 1 matériau PBR | 2048² PNG RGB (2,05 Mo) | COLOR_0 présent |
| `juanita_male.vrm` | 3 480 096 o | 11 261 | idem | idem | VRM 0.x, 30 os humanoïdes mappés, 17 groupes de blendshapes |
| `README.md` + `work/` | — | — | — | — | scripts Blender de construction du mâle |

Manquent dans l'archive : `juanita_src.glb`, l'albédo source et `male_stage.blend` → **l'archive seule ne permet pas de reconstruire le mâle**. Les scripts sont conservés dans `assets-src/avatars/blender/`, les originaux dans `assets-src/avatars/`.

## Squelettes : GLB vs VRM (vérifié, pas supposé)
- Les trois fichiers ont **41 joints** et **11 morph targets** (visage : yeux, bouche).
- Noms et hiérarchie des os **identiques** entre GLB F, GLB H et VRM H (rig Mixamo). Le VRM original de Juanita a le même ensemble de noms dans un ordre différent.
- **Poses de repos différentes** : hanches du mâle à 0,307 m contre 0,274 m (jambes plus longues) ; les bras du mâle portent des rotations de repos (édition « arm shift »).
- Conséquence : le retarget doit travailler en **espace monde** (c'est le cas) — un simple partage de clips en espace local donnerait des bras tordus sur le mâle.
- Le VRM mâle casse la convention T-pose VRM0 (rotations de repos non identité) et n'a pas été validé avec three-vrm → **on utilise les GLB en jeu**, le VRM reste une source.

## Visage, yeux, cheveux, matériaux
- Visage peint dans la texture (style chibi Polygonal Mind), yeux = géométrie + texture, 11 morphs : Blink_L, Blink_R, angry, sorrow, happy, joy, mouth_a/e/i/o/u (prêts pour clignement automatique, expressions d’emote et lip-sync voix plus tard).
- Cheveux : maillage low-poly dans le même matériau/atlas → 1 draw call par avatar. Bon pour le mobile.
- **Défaut principal** : la femme est en *unlit* et l'homme non → les deux ne réagissent pas pareil à la lumière.

## Cohérence de style et adéquation mobile
- Même famille visuelle (≈0,93 m, ≈4,7 têtes, chibi « Juanita ») : cohérent entre eux, **mais c'est l'identité visuelle de Yooville**. Pour YooWorld, une direction artistique propre est recommandée (voir plan, phase 4 « garde-robe/identité »).
- Polygones (11–13,5 k) : acceptables pour 2–8 avatars à l'écran sur mobile ; au-delà de 15 avatars il faudra un LOD.
- Taille / mémoire : trop lourdes en l'état (textures 2048).

## Corrections appliquées (Phase 1)
`tools/optimize_avatar.py` (Blender non requis, pygltflib/PIL) :
1. Texture redimensionnée en **1024² JPEG q88**.
2. Suppression de `KHR_materials_unlit`, roughness 1 / metallic 0.
3. En jeu : `MeshLambertMaterial` (map + vertexColors) pour **les deux** avatars → ombrage identique, éclairé par le soleil, l'hémisphère et les lampes.

| | Avant | Après |
|---|---|---|
| GLB femme | 4,57 Mo | **1,67 Mo** |
| GLB homme | 3,47 Mo | **1,59 Mo** |
| Mémoire GPU texture / avatar | ≈16–21 Mo | **≈4–5 Mo** |
| Draw calls / avatar | 1 | 1 |

Testé en jeu : captures `shots/close.png`, `shots/sit.png`, `shots/walk.png`.

## Recommandations restantes
- Cuire (bake) les clips retargetés hors ligne → supprimer le coût de retarget au chargement.
- Quantification géométrie (meshopt / `KHR_mesh_quantization`) : −30 à −50 % de plus.
- Texture KTX2/Basis : mémoire GPU encore ÷4.
- Définir une identité d'avatar YooWorld propre (plus proche d'un style « doll » moderne de YoWorld) et un système de garde-robe par slots (cheveux, haut, bas, chaussures).
