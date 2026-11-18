# « Je n’arrive pas à accéder à la plage » — enquête (Task A)

## Ce qui a été testé (site en ligne, émulation Chrome)
iPhone 15 paysage / portrait (UA Safari iOS 17), Pixel 7 paysage / portrait ; chacun : visite neuve, après une partie sur `/yooworld/`
(sauvegarde de la version principale), après une partie sur `/yooworld/polish/`. Script : `tools/probe-plage.mjs`, captures `shots/taskA/`.

| Constat | Résultat |
|---|---|
| `/yooworld/plage/` | 200, se charge sans erreur dans les 12 cas |
| `/yooworld/plage` (sans /) | 301 → `/plage/` (OK) |
| Service worker | aucun (pas de cache SW possible) |
| Manifest | `start_url`/`scope` = `./` relatifs au dossier → `/plage/` a son propre manifest correct |
| Sauvegarde partagée (même origine `sasaif.github.io` → `localStorage` commun aux 3 versions) | même format, aucun plantage |
| **Lieu au démarrage** | **toujours l’appartement** : le lien « plage » ouvrait le même appartement que `/polish/` ; la plage n’était accessible que par **Lieux → Yoo Plage** |
| Portrait téléphone | écran « Tourne ton appareil » par-dessus (il faut tourner ou « Continuer en portrait ») |

## Cause la plus probable
Le lien `/plage/` **ne montrait pas la plage** : il ouvrait l’appartement, identique à la version améliorée, et rien n’indiquait
qu’il fallait passer par le bouton « Lieux ». (Non reproductible : un vrai plantage iOS / mémoire WebGL — non testable sans appareil réel.)

## Corrections
- `/plage/` ouvre **directement sur Yoo Plage** (build `VITE_DEFAULT_LIEU=beach`, une fois par session ; ensuite le lieu sauvegardé).
- Lien direct **`?lieu=plage`** (ou `?lieu=appart`) qui marche sur n’importe quelle version contenant la plage.
- Les liens de comparaison `?v=1|2|3` ouvrent dans l’appartement.
- Badge **« Nouveau »** sur le bouton Lieux tant qu’il n’a jamais été ouvert.
- Chargement robuste d’une sauvegarde venant d’une autre version (meubles inconnus ignorés au lieu de risquer un plantage).
