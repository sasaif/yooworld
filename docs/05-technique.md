# 05 — Documentation technique

## 1. Pipeline avatar
1. **Sources** (`assets-src/avatars/`) : GLB/VRM d’origine + scripts Blender de construction du mâle. Jamais modifiés.
2. **Optimisation** : `python3 tools/optimize_avatar.py <in.glb> <out.glb>` → texture 1024 JPEG q88, retrait de `KHR_materials_unlit`, roughness 1 / metallic 0. Sortie dans `public/models/avatars/`.
3. **Chargement** (`render/avatar/AvatarModel.ts`) : `buildAvatar` clone le GLB (SkeletonUtils), remplace les matériaux par `MeshLambertMaterial` (lumière cohérente, peu coûteux), active les ombres.
4. **Animations** : clips Quaternius 23 os (`public/models/anim/QACP_Casual_Female_23bones.glb`) retargetés à l’exécution vers le rig Mixamo 41 os (`retarget.ts`, table `boneMaps.ts`), en espace monde (gère les poses de repos différentes F/H). Cache par corps. Root motion retiré (idle, walk, run, emote). Assis = jambes SitDown/StandUp + bras Idle.
5. **Ajouter un avatar** : déposer la source dans `assets-src`, optimiser, ajouter une entrée dans `data/avatars.ts` (url, rig, `facing`, `sitForward`, couleur). Pas de code à écrire si le rig est Mixamo.
6. **À faire** : cuire les clips retargetés dans le GLB (supprime le coût de chargement), meshopt + KTX2.

## 2. Architecture de scène
- `App.tsx` : `<Canvas shadows dpr=Q.dpr>` → `Lighting` → `ApartmentView` → un `Character` par avatar → `CameraRig` → `Stats`. Le HUD React est un overlay DOM.
- **Qualité** (`render/quality.ts`) : profil `low` (pointeur tactile / petit écran) ou `high`, forçable par `?q=low|high`. Low : DPR ≤ 1,5, shadow map 1024, 2 lumières ponctuelles max ; High : DPR ≤ 2, 2048, 4.
- **Meubles** : `flattenModel` aplatit chaque GLB en parties par matériau ; `FurnitureBatch` = un `InstancedMesh` par (définition × partie). Les murs sont fusionnés par matériau. Résultat mesuré (`renderer.info`, passe d’ombre incluse) : ≈ 70–75 draw calls desktop, ≈ 53–56 mobile, ≈ 30 k triangles, 8 textures pour toute la scène (2 avatars + 26 meubles).
- **Effets** : lampe allumée = `pointLight` + sphère émissive ; TV = plan émissif animé + lumière ; musique = notes HTML ; tous plafonnés par le profil qualité.
- **Captures** : `?shot=overview|close|sit|walk|edit|decor|ui|ui_m` + `node tools/shot.mjs mode[@mobile]` (dev server sur :5202).

## 3. Persistance
- Interface `GameRepository` (`persistence/types.ts`) : `load/save` de `Profile`, `ApartmentLayout`, `Inventory`.
- `LocalStorageRepository` : clés `yooworld:profile`, `yooworld:apt:<id>`, `yooworld:inv:<ownerId>`, enveloppe `{schema, savedAt, data}` (`SCHEMA = 1`) ; `migrate(key, from, data)` gère les anciennes versions (v0 = objet nu). **Règle** : toute modification de format incrémente `SCHEMA` et ajoute un pas de migration + un test.
- `MemoryRepository` : tests, captures (`?shot`) et `?fresh`.
- Sauvegarde automatique : `GameController.persist()` regroupe les écritures (250 ms) après chaque édition, achat, renommage.
- **Serveur plus tard** : implémenter `ServerRepository` (REST/WebSocket) avec la même interface et le brancher dans `app/services.ts` — aucun autre fichier ne change.

## 4. Système d’interactions
- Chaque meuble déclare `interaction` dans `data/furniture.ts` : `sit` (avec `seat.slots` et `depth`), `bed`, `light`, `tv`, `music`, `fridge`, `look`.
- Tap sur un meuble → `GameController.tapItem` → `InteractionMenu` (actions possibles selon le mode).
- `interact(uid, action)` : `sit` → `freeSeat` choisit une place libre (2 avatars peuvent partager un canapé) puis `goTo(..., {seat})` ; `toggle` → `toggleItem` (lumière, TV, musique ; musique fait danser l’avatar) ; `snack`/`look` → bulle.
- Mode édition : tap = sélection ; `SelectionBar` (Tourner, Déplacer, Ranger) ; `PlacingBar` avec fantôme vert/rouge et raison du refus.
- Ajouter une interaction : nouvelle valeur dans le type `interaction`, une branche dans `interact`, éventuellement un effet dans `ItemEffects`.

## 5. Points d’intégration multijoueur
- **Transport** : `net/NetworkTransport.ts` — `connect(roomId, playerId)`, `send(NetMessage)`, `onMessage`. Aujourd’hui `OfflineTransport` (no-op). À ajouter : `ColyseusTransport` ou `SocketIoTransport`.
- **Messages** (`NetMessage`) : `presence`, `move` (chemin + course), `sit`, `chat`, `emote`, `furniture` (place/move/remove/toggle), `leave`.
- **Déjà émis** : chaque édition d’appartement envoie `furniture`, la danse envoie `emote`, le chat passe par `LocalChatService` → transport (et les messages `chat` reçus sont assainis).
- **À brancher** : `goTo` doit émettre `move` ; un `RemoteCharacter` alimente `world.chars` à partir des messages reçus (interpolation sur le chemin, la locomotion existe déjà).
- **Autorité serveur** (indispensable) : le serveur rejoue `canPlace` (le module `ApartmentModel` est pur et partageable côté Node), valide les achats (`buy`) et la propriété de l’appartement, assainit le chat (`sanitize` + modération), limite le débit. Le client n’est jamais source de vérité pour les pièces.
- **Salles** : 1 room = 1 appartement ou 1 lieu public ; `presence` au join, `leave` au départ.
