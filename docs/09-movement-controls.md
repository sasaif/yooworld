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

## Audit des échecs e2e (18/11) — causes et corrections

| Échec observé | Cause | Correction |
|---|---|---|
| 22,5° à 64–88 %, « butée » d=1 à 82 %, anim max = run 0,56 | **Harnais** : couloir vérifié sur 2,4 m mais l'avatar parcourait ~2,6 m avant la fin de la fenêtre (le doigt glisse pendant ~0,3–0,6 s à 5 fps) → il arrivait au meuble en bout de couloir pendant la mesure | couloirs de 3,4 m, fenêtre dimensionnée pour finir dans la partie libre (distance déjà parcourue + 0,3 s + fenêtre ≤ couloir − 0,25 m) ; être bloqué dans un couloir libre = échec réel, jamais retenté |
| « butée » lue d≈0,973 | **Jeu** : rayon de course du stick calculé avec `getBoundingClientRect` pendant la transition `scale(1.03)` de la base → rayon faux de ~3 % selon le moment de l'appui | rayon depuis les tailles de mise en page (`offsetWidth`), test unitaire ; le test « butée » pousse le doigt au-delà du bord (1,25 R) et exige d = 1 exactement |
| NaN à 0° / 180° (iPad), erreur de cap 60° | **Harnais** : aucune image rendue dans la fenêtre (gel du rendu SwiftShader) ; le cap et la vitesse réutilisaient alors les points de la mesure précédente | état de mesure remis à zéro à chaque essai ; fenêtre inutilisable (0 image / < 3 images) = nouvel essai journalisé (max 2) |
| « stick recentré, avatar idle » (iPhone 15) | **Harnais** : lecture unique alors que le knob revient avec une transition CSS de 0,14 s et que la pose idle est posée par l'image suivante (5 fps) | vérification répétée ≤ 1,5 s après relâchement, détails journalisés |
| « assis + joystick → se lever » (Pixel 7, une fois) | **Harnais** : modes lus par sondage depuis node toutes les 120 ms + latence → phase « standing » manquée | modes enregistrés à chaque image par l'échantillonneur dans la page |
| « caché en mode Décorer, de retour en jeu » (iPad) | **Harnais** : 300 ms fixes alors que le fondu d'opacité avance par image (gels de compilation de shaders en mode Décorer) | attente de la visibilité réelle ≤ 3 s |
| iPad sans `?joystick=1` | Chrome headless 1024×768 ; un vrai iPad annonce `pointer: coarse` | **Jeu** : joystick aussi sur tout écran tactile sans pointeur fin survolant (`maxTouchPoints > 0` et pas `(hover: hover) and (pointer: fine)`) ; l'iPad est maintenant testé sans paramètre |
| tap-to-move après le joystick : 0,34 m en 2,4 s (iPad, en ligne) | **Jeu** : `Character` bornait dt à 0,05 s par image → sous 20 fps, tap-to-move et animations tournaient au ralenti (25 % à 5 fps, pieds en retard sur le corps piloté par le joystick) | dt borné à 0,25 s comme le contrôleur, tap-to-move en sous-pas de ≤ 0,05 s (trajet identique), test unitaire 5 fps = 60 fps |
| pincement : d 0,45 → 0,60 | **Harnais** : Chrome livre les mouvements tactiles alignés sur l'image suivante → dernier mouvement pas encore reçu | `stickTo` attend que le stick du jeu lise le déplacement demandé ; comparaison sur `stick.mag` |
