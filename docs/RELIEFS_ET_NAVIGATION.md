# Reliefs et navigation - 2.1.1

## Demande appliquée

La démonstration « Lancer une rivière » et la case d'activation de l'érosion
sont supprimées, avec leurs gestionnaires et leurs styles inutilisés.
Le formulaire de relief, graine, génération et rejeu devient un sélecteur compact
précédent / suivant. Le panneau, les couleurs, la typographie, le rendu du terrain,
la barre flottante, les couches, les sources et le fonctionnement mobile restent
ceux de l'interface fournie.

La navigation fonctionne avec les boutons, les flèches gauche/droite au clavier,
ou la molette après activation du sélecteur. Les gestes rapides sont temporisés ;
la molette du panneau et le zoom du navigateur ne sont pas détournés. Déplacer
le pointeur hors du sélecteur désarme la molette sans déplacer le focus clavier.
Le bouton circulaire de la barre du bas utilise le même historique.

## Parcours et reliefs

Les neuf familles sont Vallons, Vallée sinueuse, Versants, Confluence, Bassin
ouvert, Massif montagneux, Plateaux entaillés, Plaine fluviale et Terrain naturel.
Les huit paysages régionaux alternent automatiquement trois cadrages
(rapproché, paysage, ensemble),
déterminés par la graine et rejouables. Les vues d'ensemble ont des structures
multi-échelles : plusieurs montagnes, plateaux, confluences, affluents ou
cuvettes occupent la carte, plutôt qu'un seul détail agrandi. Le sous-titre du
sélecteur indique le cadrage sans ajouter de réglage.

Le neuvième choix reproduit le terrain naturel des toutes premières versions,
avec son bruit fractal et ses dépressions imprévues. Il est présenté comme
« Génération classique » car le dézoomer ou le modifier casserait cette fidélité.
Il est simplement inclus dans la rotation des familles. Sur un historique
2.1.0, il rejoint en tête les familles restant à parcourir, sans perte de
l'historique des terrains ou réinsertion à chaque rechargement.

Les amplitudes, ruptures de pente et jonctions sont continues : les paysages
ouverts ont des chemins de descente réels ; le bassin conserve volontairement
des dépressions et un exutoire. Tous les terrains commencent secs et sans source.
L'ancien cadrage rapproché des cinq familles initiales est conservé.

Chaque ouverture ajoute un nouveau relief au parcours, plutôt que de réinitialiser
une graine fixe. Le stockage local garde les 60 dernières recettes, l'avancement
d'une séquence de graines et les familles restant à explorer. Sans stockage,
la navigation continue en mémoire et le départ est aléatoire. Le stockage ne contient
aucune grille physique volumineuse. Les contenus corrompus sont ignorés.

Revenir en arrière retrouve le relief initial exact. Il ne restaure pas l'eau,
les sources ni l'érosion abandonnées dessus : ce point est indiqué dans le panneau.
La pause, la vitesse, les limites, la pluie et la visualisation sont conservées.
Une sauvegarde JSON reste le moyen de retrouver une simulation complète.

## Compatibilité

Le solveur d'eau et de sédiments, le rendu et les fichiers historiques n'ont pas
été modifiés. Les recettes historiques de vallée, cuvette et crête restent disponibles
pour les anciennes sauvegardes. Le terrain naturel historique est de nouveau
proposé à la génération et conserve ses empreintes physiques originales.
Les anciennes sauvegardes v2 sont restaurées fidèlement, y compris leur option
physique d'érosion. Le passage à un autre relief active toujours l'érosion pour
éviter un terrain neuf figé par une ancienne option devenue invisible.

Le format de sauvegarde reste v2. Les nouveaux noms de relief demandent
l'application 2.1.0 ou ultérieure pour les trois nouvelles familles. Les dépendances npm sont inchangées et leurs
versions restent identiques dans le manifeste et le lockfile.

## Vérifications (historique 2.1.0, complété en 2.1.1)

- 51 tests Node prévus : 20 tests physiques conservés et 31 tests de relief/navigation.
- 47 contrôles navigateur de simulation, sources, sauvegardes et interface validés.
- 85 contrôles de disposition validés sur huit tailles de fenêtre, dont 320 px,
  avec chargement des 22 ressources séparées de l'application.
- 44 contrôles navigateur de navigation, clavier, molette, cadrage, import et démarrage prévus.
- Les neuf champs de la référence physique v2 sont identiques bit à bit à 1000 pas.
- Les dix empreintes JS historiques sont intactes et les 39 scripts de recherche
  restent ancrés sur le moteur archivé.

Les rapports sont dans `tests/generated/terrain-validation/` et
`tests/generated/design-validation/`. Les essais longs de recherche ne sont pas
relancés pour cette modification du parcours de génération.

Le navigateur administré bloque les navigations natives file/HTTP. Les contrôles
chargent le vrai HTML autonome en mémoire ; la persistance de démarrage utilise
un backend Storage injecté dans sept pages neuves et 100 cycles indépendants côté
Node. Ce n'est pas une validation de rechargement natif ni de Windows.

Le registre npm n'étant pas accessible dans l'environnement, le HTML a été
assemblé avec `npm run build -- --skip-icons`. Cette option réutilise le bundle
Lucide fourni, inchangé. Le chevron de droite est le même pictogramme retourné
en CSS. Le build normal des icônes reste disponible après `npm ci`.

## Complément 2.1.1 : réintégration du terrain initial

Le code historique de `natural` est inchangé : quatre empreintes SHA-256
du terrain initial, prises avant modification, garantissent que les mêmes
graines produisent les mêmes grilles. Les nouveaux tests vérifient aussi
la compatibilité des anciennes recettes de navigation et l'affichage de
« Génération classique ». Aucun réglage ni changement de moteur n'est ajouté.

La version 2.1.1 valide 56 tests Node, 47 contrôles de simulation dans le
navigateur, 85 contrôles responsive et 47 contrôles de navigation. Une
régression physique à 1 000 pas conserve les neuf champs de référence sans
aucune différence. Les limites de validation navigateur, de chargement local
et d'OS restent celles indiquées plus haut.
