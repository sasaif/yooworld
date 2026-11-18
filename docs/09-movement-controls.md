# Contrôles de déplacement — Étape 1 : joystick virtuel (mobile)

Branche `feature/movement-controls` (depuis `feature/avatar-fashion-economy`). L'étape 2 (tap-to-move optionnel dans
les réglages, click-to-move desktop) **n'est pas commencée**.

## Architecture (modulaire, configurable)

| Module | Rôle |
|---|---|
| `src/input/joystick/joystickState.ts` | état partagé du stick (objet mutable, aucun re-render React), normalisation du doigt sur le disque unité, reset (relâché / annulé / perte de capture / `blur` / onglet caché / `pagehide`), clavier desktop WASD/ZQSD/flèches (Maj = lent), désactivé pendant le studio / le mode Décorer et quand on tape dans un champ |
| `src/input/joystick/VirtualJoystick.tsx` | composant DOM en bas à gauche : Pointer Events + `setPointerCapture`, suit son propre `pointerId` (multi-touch : un autre doigt peut pincer/zoomer), `stopPropagation` sur tous ses évènements (jamais vus par la caméra ni par la scène 3D), `touch-action:none`, knob déplacé par `transform` direct |
| `src/game/movement/speedCurve.ts` | déplacement du stick → facteur de vitesse : zone morte 0–10 %, puis courbe cubique monotone (PCHIP) passant par 30 % / 60 % / 85 % / 100 % au centre de chaque palier — progressive, sans marche, ancres configurables |
| `src/game/movement/MovementController.ts` | contrôleur analogique pur : projection écran → sol via la caméra (360°, « haut » = s'éloigner de la caméra, direction exacte à l'écran malgré la vue iso), normalisation (diagonales pas plus rapides), accélération / décélération exponentielles intégrées analytiquement (indépendant du framerate), dt borné à 0,25 s, sous-pas de 4 cm à travers le collisionneur (pas de traversée), rotation douce. Config `MOVE_DEFAULTS` : `maxSpeed 1.9 m/s`, `accel 14/s`, `decel 32/s`, `turnRate 12/s` |
| `src/game/movement/collision.ts` | collisions sur la grille de navigation existante (murs, meubles, bords de la pièce, mer et décor de la plage) : disque de 8 cm, glissement le long des obstacles (résolution par axe), contournement des coins, sortie possible si on démarre en chevauchement |
| `src/game/movement/animBlend.ts` | mélange idle / marche / course piloté par la vitesse **réelle** ; vitesse de lecture = vitesse réelle / vitesse naturelle du clip (jamais plus rapide que le corps) |
| `src/game/movement/playerMotion.ts` | colle stick ↔ personnage actif : interrompt un trajet tap-to-move, fait se lever un avatar assis (animation « se lever »), arrête la danse, recolle la caméra au perso |
| `src/game/movement/debug.ts` | `window.__move()` pour les tests e2e |

## Cohabitation avec le tap-to-move existant (avant l'étape 2)

* Sur téléphone/tablette (pointeur grossier) le joystick est affiché et c'est le contrôle principal (bulle d'accueil
  « Utilise le joystick pour marcher ! »). Le tap-to-move existant (toucher le sol, double-tap = courir) reste actif tel quel.
* Pousser le joystick au-delà de la zone morte **annule immédiatement** tout trajet tap-to-move en cours (et un siège/une danse en attente).
* Quand le stick est relâché et que l'avatar est arrêté, le tap-to-move reprend la main normalement.
* Desktop : pas de joystick par défaut (souris inchangée) ; `?joystick=1` le force (tests), `?joystick=0` le masque.
* L'étape 2 rendra le tap-to-move optionnel via les réglages.

## Tests

* `tests/movement.test.ts` (vitest) : courbe de vitesse, mapping iso, diagonales, 30/60/120/144 fps, accélération/arrêt,
  collisions/glissement/bornes, animation, reset du stick, clavier, cohabitation tap-to-move / assis / danse.
* `tools/e2e-joystick.mjs` : vrai jeu, vrais évènements tactiles (CDP `Input.dispatchTouchEvent`) — `DEV=iphone15|pixel7|se|ipad`.
* `tools/e2e-desktop-move.mjs` : desktop (pas de joystick, clavier, chat, molette, `?joystick=1`).
