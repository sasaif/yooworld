# YooWorld · fichier de passation

> Pour un bot ou un développeur qui reprend le projet **sans contexte**. À lire en entier avant de toucher au code.
> Propriétaire : **S Ben Salah** (GitHub `sasaif`). Il écrit en français et teste sur un **vrai iPhone**, en paysage dans Safari.

## 1. Le projet en bref

YooWorld est un jeu social 3D dans le navigateur, inspiré de YoWorld : avatars chibi, un appartement à décorer, la plage
« Yoo Plage » (ambiance boîte de nuit / DJ tropical), une boutique de mode avec Gold et Diamants, un chat et des interactions
avec les meubles (s'asseoir, s'allonger, regarder la télé). Il est d'abord pensé pour le mobile en paysage et marche aussi
sur ordinateur. **Pas de vrai multijoueur pour l'instant** : tout est local, et l'interface l'affiche clairement (« Mode local »).

- **Stack :** React 18, Vite, TypeScript, Three.js r170, React Three Fiber + Drei, vitest, playwright-core (tests e2e
  dans Chrome headless, avec de vrais événements tactiles envoyés par CDP).
- **Dépôt :** https://github.com/sasaif/yooworld
- **Branche à reprendre :** `feature/interaction-polish` (la plus récente ; elle contient toutes les autres).

## 2. Organisation du dépôt

| Chemin | Contenu |
|---|---|
| `src/app/` | démarrage, plein écran mobile (`viewportFill.ts`), variantes de vue (`variant.ts`, `?v=`), lieu de départ (`startLocation.ts`, `?lieu=`) |
| `src/render/` | scène R3F : `Character.tsx` (avatar, animations, transitions assis/allongé), `CameraRig.tsx`, `cameraFit.ts`, `avatar/` (avatars personnalisables, `sitPose.ts` = pose assise/allongée procédurale), `perf/` (compteur FPS) |
| `src/game/` | logique pure et testée : `world.ts`, `GameController.ts`, `apartment/` (plan, navigation, sièges `worldSync.ts`), `interact/` (`anchors.ts`, `seatMotion.ts` = machine d'états des transitions, `interactions.ts` = menu), `movement/` (joystick, tap-to-move, click-to-move), `beach/` (Yoo Plage) |
| `src/data/` | catalogue des meubles (`furniture.ts`), **registre des interactions** (`interactionRegistry.ts` : places, poses, durées par meuble), appartement de départ, avatars |
| `src/fashion/`, `src/economy/` | boutique de mode, inventaire, Gold/Diamants, échange de Gold en local, architecture de paiement future (sans paiement réel) |
| `src/net/` | statut réseau (« Mode local »), transport de chat local |
| `src/ui/` | HUD, chat, menu d'interaction, écran « tourne ton téléphone » |
| `src/input/` | joystick virtuel, clavier |
| `public/models/` | modèles GLB (meubles Kenney, avatars). Licences dans `docs/LICENCES.md` |
| `tests/` | tests unitaires vitest |
| `tools/` | tests e2e, captures, sondes, scripts Python de planches et mesures |
| `shots/` | captures de référence avant/après par chantier |
| `docs/` | documentation (voir §8) |

## 3. Branches (de la plus ancienne à la plus récente)

Chaque branche part de la précédente : `phase-1` → `phase-2` → `main` → `polish-mobile` → `surprise-plage` →
`feature/avatar-fashion-economy` → `feature/movement-controls` → `feature/perf-foundations` →
`feature/polish-experience` → `feature/interaction-polish` → `feature/gameplay-polish`.

| Branche | Contenu |
|---|---|
| `phase-1` | structure modulaire, avatars éclairés, GLB d'avatars optimisés pour le mobile |
| `phase-2` | docs d'audit, d'avatars, d'architecture, plan, licences |
| `main` | phase 2 fusionnée, plus la base Vite configurable pour GitHub Pages. **C'est la seule branche fusionnée.** |
| `polish-mobile` | plein écran paysage mobile, safe areas, écran de rotation, avatars plus grands, cadrage, interface compacte |
| `surprise-plage` | Yoo Plage (lieu social plage/DJ), vidéo teaser, comparaison V1/V2/V3. **V3 = vue choisie par l'utilisateur, par défaut** |
| `feature/avatar-fashion-economy` | personnalisation des avatars, boutique de mode en 12 catégories, Gold/Diamants, inventaire, échange de Gold local |
| `feature/movement-controls` | étape 1 joystick virtuel ; étape 2 tap-to-move mobile (option, désactivé par défaut) et click-to-move sur ordinateur avec repère de destination |
| `feature/perf-foundations` | compteur FPS (dev ou `?perf=1`, F9), fuite mémoire plage ↔ appart corrigée, ressources partagées, `tools/perf-baseline.mjs` |
| `feature/polish-experience` | plein écran iPhone sans bande vide, caméra bornée à la pièce, plage de zoom (dézoom = tout l'appart, zoom = avatar), vraie pose assise procédurale, pose allongée, chat compact, badge « Mode local », poussière dans la lumière, checklist pour vrai appareil |
| `feature/interaction-polish` | Transitions fluides debout ↔ assis ↔ allongé ↔ debout, registre d'interactions par meuble (canapé 3 places, lit double à 2 places), chat repliable et longs messages. Voir `docs/13-interaction-polish.md` |
| `feature/gameplay-polish` | **passe gameplay (non fusionnée, non déployée).** Marche plus lente `?walk=a|b|c` (défaut b 1,48 m/s) avec accélération/arrêt progressifs, bouton 🏃 course, `?move=classic` = ancien contrôleur ; allure calée sur la foulée mesurée ; double toucher corrigé ; transats de la plage sur le système d'interactions ; **option C** : chaise, chaise de bureau, tabouret (+ repose-pied) et canapés abaissés pour que les pieds touchent le sol ; dock qui ne recouvre plus le bouton 🏃 ; CI GitHub Actions. Voir `docs/13-interaction-polish.md` §5 |

`gh-pages` contient uniquement les builds publiés (voir §4).

## 4. Versions en ligne (GitHub Pages)

| URL | Build de |
|---|---|
| https://sasaif.github.io/yooworld/ | `main` |
| https://sasaif.github.io/yooworld/polish/ | `polish-mobile` |
| https://sasaif.github.io/yooworld/plage/ | `surprise-plage` (s'ouvre sur la plage) |
| https://sasaif.github.io/yooworld/fashion/ | `feature/avatar-fashion-economy` |
| https://sasaif.github.io/yooworld/move/ | `feature/movement-controls` |
| https://sasaif.github.io/yooworld/perf/?perf=1 | `feature/perf-foundations` |
| https://sasaif.github.io/yooworld/experience/ | `feature/polish-experience` |
| https://sasaif.github.io/yooworld/interactions/ | `feature/interaction-polish` (**la plus récente**) |

Paramètres d'URL :
- `?walk=a|b|c` : vitesse de marche (b par défaut) ; `?move=classic` : ancien contrôleur (branche `feature/gameplay-polish`).
- `?v=1|2|3` : variante de taille et de cadrage (V1 environ 75 px, V2 environ 85 px, **V3 = caméra rapprochée, par défaut**).
- `?lieu=plage|beach|appart|home|maison` : lieu de départ.
- `?joystick=1` force le joystick, `?joystick=0` le cache.
- `?perf=1` : compteur FPS et draw calls réels (total = passe principale + passe d'ombres, affichés séparément ; F9 pour le masquer).
- `?fresh=1` : partie neuve sans la sauvegarde (utilisé par les tests).
- `?shot=…` : modes de capture des outils.

## 5. Travailler sur le projet

```bash
git clone https://github.com/sasaif/yooworld && cd yooworld && git checkout feature/interaction-polish
npm ci
npm run dev                         # http://localhost:5173
npx tsc --noEmit -p .               # types
npx vitest run                      # tests unitaires (225 sur feature/gameplay-polish)
npx vite build --outDir /tmp/exp_local && npx serve -l 5270 /tmp/exp_local   # build local pour les e2e (ou tout serveur statique)
```

Tests e2e (Node + playwright-core + Chrome ; URL en 1er argument, par défaut un serveur local) :

| Script | Rôle | Valeurs de `DEV=` |
|---|---|---|
| `tools/e2e-experience.mjs` | plein écran, caméra, zoom, chat, sièges et lit, télé | `iphone15`, `pixel7`, `ipad`, `desktop` |
| `tools/e2e-step2.mjs` | tap-to-move et click-to-move | `iphone15`, `desktop` |
| `tools/e2e-joystick.mjs` | joystick avec vrais touchers (nouveau modèle par défaut ; ajouter `?move=classic` à l'URL pour l'ancien contrôleur) | `iphone15`, `pixel7`, `se`, `ipad` |
| `tools/e2e-desktop-move.mjs`, `e2e-beach.mjs`, `e2e-fashion.mjs`, `e2e.mjs` | anciens lots : clavier/souris, plage, boutique, base | |
| `tools/perf-baseline.mjs --check` | refuse une hausse du total des draw calls (ombres comprises) de plus de 20 % (`tools/perf-baseline.json`), et affiche l'écart au budget | |
| `tools/seq-capture.mjs` | **transitions image par image en temps virtuel 60 i/s** : sauts par image, peau à l'intérieur du maillage du meuble, hauteur des semelles assis, position des pieds ; `CHECK=1` vérifie les limites, `CHAR=f|m` choisit l'avatar ; `tools/contact_sheet.py` pour les planches | `iphone15`, `desktop` |
| `tools/e2e-gameplay.mjs` | profils de marche, course, allure vs foulée, glissement des pieds, étiquette vs puces, chat + clavier | iPhone 15 |
| `tools/e2e-layout.mjs` | dock vs joystick / bouton 🏃 / place du bouton Humeur, de 667 à 932 px | |
| `tools/chat-shots.mjs` | chat : replié, déplié, longs messages, vérifications de mise en page | iPhone 15 |

Exemple : `DEV=iphone15 node tools/e2e-experience.mjs http://127.0.0.1:5270/`.
Lignes à lire dans la sortie : `PASS`, `FAIL` et `SUMMARY`.
Arguments de Chrome headless : `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`
(chemin `/usr/bin/google-chrome`). Le rendu est lent en headless (5 à 15 i/s), et un test de chronométrage peut parfois
échouer par hasard : relance-le seul avant de conclure.

### Déployer une branche dans un sous-dossier de GitHub Pages

```bash
node tools/e2e-save-isolation.mjs --build   # OBLIGATOIRE avant toute publication : sauvegardes isolées (docs/SAVE_ISOLATION.md)
GH_PAGES=1 GH_PAGES_BASE=/yooworld/<dossier>/ VITE_YW_ENV=test/<dossier> npx vite build --outDir /tmp/xdist   # env de sauvegarde test/<dossier>
git fetch origin gh-pages && git worktree add /tmp/ghp origin/gh-pages && cd /tmp/ghp && git checkout -B gh-pages
rm -rf <dossier> && cp -r /tmp/xdist <dossier> && git add -A <dossier>
git -c user.name=sasaif -c user.email=5468710+sasaif@users.noreply.github.com commit -m "deploy <dossier>/" && git push origin gh-pages
cd - && git worktree remove --force /tmp/ghp
gh api repos/sasaif/yooworld/pages/builds/latest --jq '.status+" "+.commit'   # attendre "built <commit>"
curl -s https://sasaif.github.io/yooworld/<dossier>/ | grep -o 'index-[^"]*js'   # vérifier le nouveau bundle
```

Base Vite et env de sauvegarde (`tools/save-env-rules.mjs`) : `GH_PAGES=1` exige `GH_PAGES_BASE` explicite ; `/yooworld/` = `prod`
(clés historiques `yooworld:*` / `yw.*`), `/yooworld/<dossier>/` = `test/<dossier>` (clés `yooworld:e:test.<dossier>:*`), sinon `dev`.
Un sous-dossier configuré en `prod` fait échouer le build. Voir `docs/SAVE_ISOLATION.md`.
La racine du site (`/yooworld/`) correspond à `main` : ne la remplace pas sans l'accord de l'utilisateur.

**Identité des commits (obligatoire) :** `git -c user.name=sasaif -c user.email=5468710+sasaif@users.noreply.github.com commit …`

## 6. Règles fixées par l'utilisateur (à respecter)

- **Identité visuelle :** garder la direction artistique actuelle (chibi mignon, tons roses). Ne rien refaire en entier.
  Ne pas remplacer les avatars, les meubles ou l'interface sans son accord.
- **Validés, à ne pas changer :** le cadrage de la caméra et la taille des avatars (vue **V3**, environ **93 px sur iPhone 15**
  au zoom par défaut), l'interface générale. Le zoom/dézoom par pincement reste en plus.
- **Pas de faux multijoueur :** ne pas simuler de joueurs en ligne et ne pas prétendre qu'une fonction marche en ligne si
  ce n'est pas le cas. Le « Mode local » doit rester clairement indiqué, et Juan est marqué « PNJ ».
- **Économie :** pas de vrai paiement, pas de fausse confirmation de paiement, aucun prestataire de paiement sans son accord.
  Les Diamants ne peuvent être ni transférés, ni échangés, ni offerts. Aucune conversion Gold ↔ Diamants. Pas de sécurité
  des soldes réels uniquement côté client.
- **Pas d'achat** d'assets ou de services sans son accord. Garder les sources et les licences (`docs/LICENCES.md`).
- **Méthode :** travailler par petites étapes sur des branches, avec des tests, en gardant le jeu jouable et toutes les
  fonctions et sauvegardes existantes. Ne pas toucher aux systèmes qui ne sont pas concernés.
- **Honnêteté :** ne jamais dire qu'une chose marche parce que les tests passent. Il faut l'avoir **vérifiée visuellement
  dans le jeu** (captures ou planches), et dire clairement ce qui n'a été testé qu'en émulation.
- **Performance :** suivre `docs/10-performance-foundations.md` (pas d'objets créés à chaque image, ressources partagées
  et libérées, peu de draw calls, pensé pour le mobile). **Pas de grosse phase d'optimisation pour l'instant** : pas de LOD,
  pas de graphismes adaptatifs, pas de refonte du rendu.
- **Communication :** en français, simple. L'utilisateur teste sur un vrai iPhone : à chaque livraison, donner le lien et
  ce qu'il doit vérifier.

## 7. Limites connues et points ouverts

- ~~Pieds dans le vide~~ : très réduit sur `feature/gameplay-polish` par l'option C (meubles abaissés, squelette inchangé).
  Pieds encore 1 à 5 cm au-dessus du sol sur chaises et canapé (cuisses limitées à 25°) ; pouf non ajouté (il bloquerait la place où l'avatar s'assoit) : à rediscuter.
- **Canapé d'angle :** un saut de 7,5 cm sur une image en se tournant (déjà là avant, 8,2 cm).
- **Couché sur le lit :** le chignon touche le bord de la tête de lit (jusqu'à environ 4 cm) et les mollets flottent de
  quelques cm au-dessus de la couette.
- **Contact avec l'assise :** au plus 1 à 1,5 cm de peau dans le coussin (mesuré sur le vrai maillage), comme avant.
- **Vérification sur vrai appareil :** tout a été testé en émulation (Chrome headless). Le clavier iOS a été simulé. Une
  capture de l'utilisateur sur iPhone a confirmé l'assise sur le tabouret et le chat. Checklist : `docs/12-real-device-checklist.md`.
- **Visages, coiffures et animations des avatars :** améliorations proposées, en attente de son accord.
- **Multijoueur réel et paiements réels :** non commencés, et ils exigent son accord.
- Voir aussi la section « Limites » de `docs/13-interaction-polish.md`.

## 8. Index de la documentation

| Fichier | Sujet |
|---|---|
| `docs/01-audit.md` | audit initial du prototype |
| `docs/02-avatars.md` | avatars (Juanita/Juan, pipeline GLB) |
| `docs/03-architecture.md` | architecture du code |
| `docs/04-plan.md` | plan par phases |
| `docs/05-technique.md` | notes techniques |
| `docs/06-yoo-plage.md` | la plage |
| `docs/07-direction-artistique-lieux-sociaux.md` | direction artistique des lieux sociaux |
| `docs/08-avatar-fashion-economy.md` | mode, Gold et Diamants, paiement futur |
| `docs/09-movement-controls.md` | joystick, tap-to-move, click-to-move |
| `docs/10-performance-foundations.md` | règles de performance et compteur FPS |
| `docs/11-experience-audit.md`, `docs/11-progress.md` | audit et avancement du chantier « expérience » |
| `docs/12-real-device-checklist.md` | checklist pour tester sur un vrai iPhone |
| `docs/13-interaction-polish.md` | transitions, registre d'interactions, chat repliable ; §5 passe gameplay (déplacement, option C, dock, CI) |
| `docs/LICENCES.md` | licences des assets |
| `docs/COMPARE_V.md`, `docs/POLISH_AUDIT.md`, `docs/PLAGE_ACCESS.md` | comparaison V1/V2/V3, audit du polish, accès à la plage |

## 9. Prochaines étapes suggérées

1. Faire passer la checklist de `docs/12-real-device-checklist.md` à l'utilisateur sur l'URL `/interactions/`, puis
   corriger ce qu'il signale.
2. Faire tester `feature/gameplay-polish` (vitesse de marche, course, meubles abaissés) sur le vrai iPhone, après son accord
   pour un déploiement de test, puis une intégration contrôlée avec les branches d'Art & Avatars (bouton Humeur).
3. Améliorer visages, coiffures et animations des avatars, **seulement après son accord**.
4. Quand il le demandera : vrai multijoueur (serveur, présence, chat en ligne), puis économie côté serveur, avant tout
   paiement réel.
5. Quand le jeu sera stable : la phase d'optimisation graphique complète, qu'il a reportée.
