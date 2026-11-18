# 11 · Audit « expérience » et 3 améliorations prioritaires

Branche `feature/polish-experience` (depuis `feature/perf-foundations`). Direction artistique conservée : avatars,
meubles et interface existants **améliorés, pas remplacés**.

## 1. Sources de l'analyse
- **Captures iPhone réelles de l'utilisateur (6, paysage, site en ligne)**, telles que décrites dans la conversation.
  Les fichiers n'étaient pas présents sur la machine de travail au moment de l'analyse, donc pas de copie dans
  `shots/experience/user_iphone/` : les constats ci-dessous ont été **reproduits dans le jeu** (Chrome headless,
  vrais événements tactiles CDP).
- Captures fraîches et mesures automatiques : `tools/exp-audit.mjs` → `shots/experience/before/metrics.json`
  (iPhone 15 paysage 852×393, Pixel 7 paysage 915×412, iPad 1024×768, ordinateur 1440×900 ; appartement, Vue perso, plage).
- Lecture du code (caméra, sièges, chat, réseau) et hauteur réelle des assises (`tools/seat_heights.py`).

## 2. Constats chiffrés (avant)

### Cadrage par défaut (V3, chargement)
| Appareil | Pièce % de l'écran | Part de la pièce visible | Avatar (px) | Avatar Vue perso (px) |
|---|---:|---:|---:|---:|
| iPhone 15 paysage | 89,2 % | 77 % | 93 | 156 |
| Pixel 7 paysage | 90,0 % | 75,7 % | 100 | 167 |
| iPad paysage | 84,2 % | 80,9 % | 135 | 226 |
| Ordinateur 1440×900 | 77,9 % | 89,7 % | 158 | 264 |

Au chargement, le cadrage est déjà serré. **Le rose vide vient d'ailleurs :**

### Bugs vus sur iPhone réel, puis reproduits
1. **Bande mauve en bas (~15 %).** La scène était dimensionnée en `100dvh`. WebKit ne recalcule pas toujours cette
   valeur après une rotation ou quand les barres de Safari se replient. Le fond mauve de la page apparaît alors sous le jeu.
2. **Caméra partie hors de l'appartement.** Le glisser à un doigt déplaçait la caméra sans aucune limite :
   - après 3 grands glissés, la pièce occupe **0 %** de l'écran et l'avatar est hors champ ;
   - c'est pareil en Vue perso (`shots/experience/before_roam/*_pan.png`).
   Quand la caméra suit l'avatar dans un coin, la pièce tombe à **55–62 %** de l'écran.
3. **Chat trop grand en paysage.** C'est un panneau latéral de 360 px × ~280 px (40 % de la largeur et 70 % de la
   hauteur d'un iPhone), qui recouvre la pièce et les avatars.
4. **S'asseoir et s'allonger.** Une seule hauteur, réglée pour le canapé (0,276 m), servait pour **toutes** les assises,
   et les hanches étaient toujours placées 0,17 m devant le siège. Mesures dans l'ancien jeu (`before_seats`) :
   - **chaise en bois** : hanches à **0,205 m** du centre, alors que l'assise ne fait que 0,12 m. L'avatar est
     **assis dans le vide devant la chaise** ;
   - **tabouret de bar** (assise à 0,522 m) : hanches **0,20 m sous l'assise**. L'avatar traverse le tabouret ;
   - **bord du lit** : hanches 2 cm sous le matelas et jambes dans le cadre du lit. L'avatar paraît « à moitié dans le lit ».
     Il n'existait pas de vraie position allongée.
5. **Social.** Seul un petit badge gris « ● Hors ligne » (10 px) existait. Juan/Juanita, le personnage local de test,
   n'était distingué nulle part : on pouvait le prendre pour un joueur.

## 3. Les 3 améliorations prioritaires (et pourquoi)
1. **Cadrage fiable : plein écran garanti + caméra bornée à la pièce.** C'est ce qui produit réellement le
   « rose vide » et l'écran perdu (bugs 1 et 2) sur le téléphone de l'utilisateur. C'est le plus gros impact
   ressenti, et le style n'est pas touché.
2. **Fondation des interactions avec les meubles.** Elle corrige les bugs signalés (lit, tabouret, chaise) et
   ajoute de vraies interactions : s'allonger, regarder la télé, un registre d'actions par meuble. C'est le cœur
   du gameplay « appartement » d'un jeu social.
3. **Social clair et non bloquant.** Le chat devient compact en paysage, avec un « Mode local » explicite et un
   tag PNJ sur l'avatar local. Ça corrige le bug 3 et répond au point 5 du brief, sans faux joueurs.

Ensuite (4ᵉ, plus petit) : **ambiance**. Poussières qui flottent dans les rayons de soleil, rayons qui
« respirent » lentement, et la télé allumée, déjà animée.
Plus tard : **visages, coiffures et animations des avatars**. C'est un gros travail sur les modèles 3D, à faire
avec ton accord sur la direction (pas de remplacement des avatars sans approbation).

## 4. Pourquoi « toute la pièce visible » n'est pas le cadrage par défaut sur téléphone
En vue isométrique, la pièce projetée a un rapport largeur/hauteur de 1,46. Un iPhone en paysage fait 2,17.
Pour voir 100 % de la pièce, il faudrait un zoom de 61 au lieu de 104, avec des avatars d'environ 55 px au lieu
de 93 px. C'est contraire au choix V3 (avatars plus grands). Le compromis retenu :
- la vue reste **toujours sur la pièce** (pan, suivi, pincement, rotation) ;
- l'avatar reste **toujours à l'écran** ;
- un pincement vers l'extérieur montre la pièce presque entière.

Voir la section « Résultats » pour les chiffres après.
