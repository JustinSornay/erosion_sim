# Cartes, climat et navigation — 2.3.0

## Recette d'une carte

La paire `preset` + `seed` détermine le relief, son cadrage procédural, la présence
initiale d'eau, la pluie prévue et les sources. Les paramètres de climat utilisent
un générateur aléatoire séparé : ils ne déplacent pas la suite du générateur
historique. Leurs valeurs ne dépendent pas de l'heure ni d'un service en ligne.

`genTerrain` conserve le comportement de calcul brut des versions antérieures.
`generateScene` effectue, dans cet ordre :

1. Génération du relief brut, réinitialisation des champs et du réseau potentiel.
2. Création du profil climatique et remise des options physiques aux valeurs de la carte.
3. Remplissage connecté des mers, lacs ou petites dépressions retenues.
4. Placement de sources adaptées au parcours aval, hors des zones déjà en eau.
5. Comptage de l'eau initiale, remise à zéro des bilans, rafraîchissement des observations.

## Nouvelles familles

| Famille | Eau initiale et composition |
| --- | --- |
| Île océanique | Une terre centrale irrégulière, hauts-fonds puis mer profonde. |
| Archipel | Plusieurs îles, îlots et passages ; nombre adapté au cadrage. |
| Côte & criques | Littoral asymétrique, caps et ouvertures marines. |
| Estuaire | Fond de vallée s'élargissant vers la mer ; apports fluviaux plus forts. |
| Fjord | Vallée noyée, versants abrupts, embranchements selon le cadrage. |
| Lagune côtière | Eau abritée par un cordon, passe submergée vers la mer. |
| Atoll | Relief annulaire discontinu et lagon relié à l'océan ; pas de source automatique. |
| Lac de vallée | Bassin fermé allongé et apports amont possibles. |
| Lac de cratère | Bassin fermé au centre d'un relief annulaire. |

Certaines recettes des anciennes familles Bassin ouvert, Caldeira, Relief karstique
et Terrain naturel reçoivent un petit lac uniquement si une dépression fermée existe.
Aucune digue cachée ni modification du fond ne force ce plan d'eau.

## Pluie

`SCENE_CLIMATES` contient pour chaque famille un intervalle d'intensité, une probabilité
d'activation initiale et une plage de nombre de sources. Les valeurs sont figées
après tirage par graine. L'interface ne permet jamais de choisir une intensité.
Les quatre apparences du bouton sont dérivées de la valeur réelle : bruine,
pluie fine, pluie soutenue, averse. Un bouton coupé conserve son pictogramme d'intensité.

## Sources

Les candidats sont des terres émergées, à au moins 14 cellules des bords, sans pente
locale excessive, avec un parcours descendant d'au moins 22 cellules vers l'eau
ou une sortie. Deux sources de départ sont séparées d'au moins 23 % du côté de
la carte. Le nombre demandé reste une limite : un placement inadapté est omis.

Le débit dépend du type de paysage, du parcours aval et de l'accumulation amont,
avec une variation modérée par graine. L'ajout manuel utilise le débit de référence
de la carte. Activer, couper et retirer restent disponibles, sans éditeur numérique.
Une sauvegarde importée garde cependant ses débits existants exactement.

## Mers et lacs

Le remplissage marin parcourt les cellules sous le niveau zéro reliées aux limites
par une face. Une connexion uniquement diagonale n'est pas suffisante.
Un lac est rempli depuis un minimum intérieur, sans connexion à un bord submergé.
La hauteur d'eau ajoutée est comptée dans `budget.initialWater`.

Les faces externes marines utilisent une charge de référence et une quantité de
mouvement signée. Le limiteur de flux s'applique aux sorties, les entrées proviennent
d'un réservoir externe sans sédiment. `budget.waterIn` enregistre ces apports.
Le bilan devient : eau initiale + sources + pluie + entrées marines - sorties -
évaporation - eau présente. Les échanges internes eau/sédiment restent conservatifs.

Aucun maintien forcé du niveau dans les cellules intérieures. Aucun vent, vague,
marée, sel ou aquifère n'est modélisé. Les lacs peuvent monter ou baisser.

## Historique

La clé `erosion.terrain-browser.v1` conserve 60 recettes compactes et la suite des
générations, pas les tableaux physiques. La révision 4 du catalogue insère une fois
les neuf nouvelles familles dans les historiques révision 3. Les anciennes recettes
restent accessibles. Sur une première visite, une permutation place une famille en
eau en tête sans la dupliquer dans le sac.

Chaque réouverture ajoute une nouvelle recette en fin de parcours. Revenir en
arrière reconstruit les conditions initiales ; cela ne recharge pas une session.
Recommencer fait la même reconstruction sans créer une nouvelle entrée.
L'historique n'est pas partagé entre origines distinctes ou fichiers locaux isolés
par le navigateur. Sans stockage autorisé, il reste utilisable pendant la session.

## Persistance complète

Une sauvegarde v3 ajoute `scene`, `marine.level`, `marine.flux` et `budget.waterIn`.
Toutes les données sont validées avant de toucher à la simulation. Les flux marins
signés sont nécessaires à une reprise identique et ne sont pas reconstruits arbitrairement.
Les fichiers v2 sont lus sans mer implicite et avec leurs champs et options d'origine.
