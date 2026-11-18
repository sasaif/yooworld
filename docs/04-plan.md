# 04 — Plan priorisé (phases 1 à 5)

Effort indicatif pour 1 développeur·se à plein temps. Chaque phase = une branche `phase-N`, fusionnée dans `main` seulement quand le jeu tourne, que `npm test` et `npm run build` passent.

| Phase | Contenu | Effort | Dépend de | Statut |
|---|---|---|---|---|
| **1. Fondations & avatar jouable** | architecture modulaire, avatars éclairés et optimisés, locomotion fluide + course, caméra tactile + suivi, pose assise corrigée, profils qualité, tests | 4–6 j | — | ✅ **fait** (fusionné) |
| **2. Appartement éditable** | mode Décorer (placer / déplacer / tourner / ranger), règles de placement, objets sur surfaces, sac + boutique en pièces, sols & murs, interactions (s’asseoir à 2, lit, lampes, TV, musique, frigo), sauvegarde versionnée, instanciation | 6–8 j | 1 | ✅ **fait** (fusionné) |
| **3. Lieux publics & navigation monde** | carte « Lieux », 1 lieu public (Café) en scène séparée chargée à la demande, transitions, spawn points, PNJ simples | 5–7 j | 1, 2 (réutilise meubles + nav) | à faire |
| **4. Identité avatar & garde-robe** | direction artistique YooWorld propre, slots (cheveux, haut, bas, chaussures, accessoires), écran de création, emotes supplémentaires, animation allongé (lit), clips cuits hors ligne | 8–12 j (+ production d’assets) | 1 | à faire |
| **5. Multijoueur réel** | serveur autoritaire (Colyseus ou Socket.io + Node), `RemoteTransport`, présence/chat/amis réels, visite d’appartements, validation serveur des éditions et achats, `ServerRepository`, modération du chat | 10–15 j | 2, 3 (et 4 pour l’apparence) | à faire |

## Ordre recommandé ensuite
1. **Phase 5 réduite (« vertical slice » réseau)** avant la 3 : présence + déplacement + chat dans *un* appartement avec 2 vrais clients. C’est le plus gros risque technique ; l’architecture (transport, NetMessage, contrôleur) est prête pour ça.
2. Phase 4 en parallèle côté art (c’est surtout de la production d’assets).
3. Phase 3 ensuite (le Café réutilise tout le système d’appartement).

## Risques
- Avatars : le style actuel est celui de Yooville ; tant que la direction YooWorld n’est pas définie, éviter de produire beaucoup de vêtements.
- Mobile réel : tests faits en viewport émulé 390×844 (Chrome + SwiftShader) — à valider sur un iPhone / Android milieu de gamme.
- Coût serveur et modération dès qu’il y a du chat réel.
