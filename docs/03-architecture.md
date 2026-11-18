# 03 — Architecture cible

Principe : **données → logique pure → rendu → UI**, reliés par un contrôleur. La logique ne dépend ni de React ni de WebGL, donc elle est testée sous Node (vitest).

```
src/
  app/          racine de composition : App.tsx (Canvas), services.ts (choix des implémentations), shots.ts (captures)
  core/         Store<T> minimal + hook useStore (useSyncExternalStore)
  data/         catalogues data-driven : avatars, furniture (37 meubles), finishes (sols/murs), locations, defaultApartment, style
  game/         LOGIQUE PURE
    GameController.ts   façade unique appelée par l'UI (modes, édition, achats, interactions, chat)
    world.ts            état de simulation des personnages (position, chemin, mode, siège, bulle)
    character/          locomotion (accélération, arrivée, virages, course)
    nav/                NavGrid A* 8 voisins + string-pulling
    apartment/          ApartmentModel (grille, règles de placement, empilement) + worldSync (nav + sièges)
    inventory/          Inventory (pièces virtuelles, sac, achats) — aucune monnaie réelle
    social/             interfaces Chat/Friends/Presence/Trade/Events + implémentations locales
  persistence/  GameRepository (interface) + LocalStorageRepository + MemoryRepository, enveloppe versionnée
  net/          NetworkTransport (interface) + OfflineTransport ; union NetMessage
  render/       RENDU R3F : Lighting, CameraRig, Character, Stats, quality, avatar/*, apartment/*
  ui/           HUD React (docks, barres, feuilles), InteractionMenu
tests/          vitest : locomotion, apartment, persistence, controller
tools/          optimisation avatar, mesure des meubles, captures, test e2e mobile
assets-src/     sources originales (GLB/VRM d’origine, scripts Blender) — non servies
public/         assets optimisés servis au jeu (+ licences)
```

## A. Système avatar (`render/avatar`, `data/avatars.ts`)
- `buildAvatar(def)` : charge le GLB optimisé, applique `litAvatarMaterials` (Lambert), attache un `AnimationMixer`.
- `avatarClips(body)` : retarget (cache par corps) des clips Quaternius ; correction assis = jambes de SitDown + bras d’Idle ; suppression du root motion.
- Données : `AVATARS` (url, rig, orientation, couleur de tag, `sitForward`), `ANIM_LIBRARY`, `CLIPS`.
- Évolution : slots de garde-robe (`Appearance` dans `persistence/types.ts` est prévu pour ça).

## B. Contrôleur de personnage (`game/character`, `game/world.ts`, `render/Character.tsx`)
- `stepMover` (pur) : accélération 3,5 m/s², décélération 5, marche 0,85 m/s, course 1,9 m/s, rotation lissée, ralentissement dans les virages, coupe des coins.
- `goTo(id, p, {seat, run})` : chemin A* ; si un siège est demandé, s’assoit à l’arrivée.
- Le composant de rendu ne fait que lire l’état et choisir le clip (idle / walk / run / sit / emote), `timeScale` lié à la vitesse.

## C. Monde (`render/Lighting`, `render/CameraRig`, `data/locations.ts`)
- Caméra orthographique isométrique ; suivi doux du joueur ; tactile : 1 doigt = déplacer, pincer = zoom (+ rotation 2 doigts) ; souris : gauche = déplacer, droit = tourner, molette = zoom ; un tap (< 8 px) = action.
- Lumière bon marché : hémisphère + 1 directionnelle avec ombre ; lampes allumées = point lights limitées par profil qualité.
- `locations.ts` : « Mon appart » jouable ; Café, Plage, Disco, Boutiques déclarés « prévus » (Phase 3).

## D. Appartement & meubles (`game/apartment`, `render/apartment`, `data/furniture.ts`)
- Grille de 0,3 m (pièce 24×20 cases = 7,2×6 m). Couches : `floor` (meubles posés au sol), `rug` (tapis, on peut marcher et poser des meubles dessus), `top` (petits objets à poser sur une surface : table, meuble TV…).
- `canPlace` renvoie une raison (`bounds`, `collision`, `door`, `noSurface`, `unknown`) affichée en français.
- Rotations par quart de tour ; un meuble déplacé/tourné emporte les objets posés dessus.
- Rendu : un `InstancedMesh` par (meuble × partie de matériau), murs fusionnés par matériau, textures procédurales de sol/mur.

## E. Social (`game/social`, `net/`)
- Interfaces : `ChatService`, `FriendsService`, `PresenceService`, `TradeService`, `EventsService`.
- Implémentations locales : `LocalChatService` (passe par le transport, marque `local: true`), `LocalFriendsService`.
- `NetworkTransport` + `OfflineTransport` : aucun faux multijoueur ; l’UI affiche « ● Hors ligne » et le second avatar est un personnage **local**.

## F. Inventaire & économie (`game/inventory`)
- `Inventory {coins, items}` ; `buy`, `spend`, `addItem`, `takeItem` purs. Pièces virtuelles uniquement (500 au départ), pas d’argent réel.
- Les finitions achetées sont stockées comme `floor:walnut` / `wall:night` et se réappliquent gratuitement.

## G. UI (`ui/`)
- Mobile d’abord : dock bas (Lieux, Décorer, Sac, Danse, Chat), feuilles glissantes (catalogue, finitions, chat, profil, lieux), barres d’édition au-dessus du pouce, zones de sécurité iOS.
- Menu contextuel 3D (`InteractionMenu`) au tap sur un meuble : S’asseoir, Allumer/Éteindre, Regarder, En-cas, Déplacer.
