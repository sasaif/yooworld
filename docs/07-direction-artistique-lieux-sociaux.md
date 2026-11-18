# Direction artistique — lieux sociaux (validée par le propriétaire)

> « J’aime la scène de plage façon boîte de nuit avec le DJ, la piste de danse et le décor tropical.
> Garde cette direction visuelle pour les lieux sociaux. » — validation du propriétaire, nov. 2026

**Yoo Plage est la référence** pour tous les lieux publics / sociaux à venir (Café, Disco, Boutiques, rooftop, piscine…).
L’appartement reste un lieu *intime* (style pastel chaud, cosy) ; les lieux sociaux sont *festifs*.

## Principes
1. **Tropical-festif** : palmiers, guirlandes, lanternes, bois clair, sable, eau turquoise ; couleurs saturées mais chaudes
   (corail, turquoise, jaune soleil, rose néon le soir). Jamais de fond noir ou de vide : le décor va jusqu’aux bords de l’écran.
2. **Un pôle « boîte de nuit » par lieu** : cabine DJ + piste de danse lumineuse au centre de la composition,
   lisible depuis la vue d’ensemble ; musique on/off, bouton 💃 *Danser* qui amène l’avatar sur la piste.
3. **Jour → coucher de soleil → soirée** : chaque lieu social a au moins deux ambiances ; le soir, les lumières
   (lanternes, guirlandes, faisceaux DJ, lucioles) prennent le relais. Ombres longues, brume légère au coucher.
4. **Les avatars sont les stars** : décor lisible mais moins contrasté que les personnages (contour cartoon + lumière
   de contour sur les avatars seulement) ; zones dégagées autour de la piste et des sièges ; caméra qui suit l’avatar,
   « Vue perso » disponible (bouton 🔍).
5. **Socialiser naturellement** : beaucoup d’assises (bancs, transats, terrasse de café, poufs autour de la piste),
   points de danse multiples, interactions au toucher (s’asseoir, commander, regarder, danser).
6. **Mobile d’abord** : décor statique fusionné (1 draw call + ombre), éléments répétés instanciés, ≤ 2 lumières ponctuelles,
   ~15 k triangles de décor ; objectif < 40 draw calls par lieu (Yoo Plage : 15–22).
7. **Honnêteté** : pas de faux joueurs ni de PNJ déguisés en joueurs ; l’indicateur « Hors ligne » reste visible tant
   qu’il n’y a pas de vrai serveur multijoueur.

## Palette de référence (Yoo Plage)
| Rôle | Jour | Coucher / soir |
|---|---|---|
| Sable | `#f3d9a4` | `#e7b98a` |
| Mer | turquoise → bleu profond | or / pêche en reflets |
| Bois (ponton, café) | `#d9a273` / `#9c6a48` | idem, éclairé par les lanternes |
| Accents festifs | corail `#ff6f91`, jaune `#ffd166`, turquoise `#2ec4b6` | rose néon, violet, faisceaux DJ |

## Prochains lieux (même grammaire)
- **Disco** : version intérieure de la piste (sol lumineux, boule à facettes, banquettes) avec fenêtres sur la plage.
- **Café** : terrasse tropicale, petit DJ acoustique le soir.
- **Boutiques** : promenade avec stands en bois, guirlandes ; essayage de tenues.
