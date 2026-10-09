# Version 2.1.0 - Variete des paysages

L'interface de la version 2.0.2 est conservee : memes couleurs,
controles, panneaux, curseurs, vues et barre flottante.

- Navigation inchangee, mais trois cadrages alternent automatiquement :
  vue rapprochee, vue paysage et vue d'ensemble. Le cadrage est indique en
  sous-titre du selecteur, sans controle supplementaire.
- Huit familles de reliefs, au lieu de cinq : les cinq reliefs precedents,
  plus Massif montagneux, Plateaux entailles et Plaine fluviale.
- Les vues larges presentent des compositions regionales : reseaux d'affluents,
  reliefs en chaine, plateaux longitudinaux, meandres et bassins secondaires.
- Les vues rapprochees des cinq familles precedentes sont preservees.
- La numerotation persistante, l'historique des 60 derniers reliefs, les
  sauvegardes et le fonctionnement sans connexion sont preserves.
- Le solveur hydraulique, les sediments, l'erosion, le rendu, les options
  physiques et les anciens terrains de sauvegarde ne sont pas modifies.

Controle qualite : 51 tests Node, 47 controles navigateur generaux,
85 controles de presentation et 44 controles de navigation. Un audit de 640
terrains repartis sur les huit familles et trois cadrages n'a detecte ni
valeur non finie ni rupture de hauteur entre cellules superieure a 0.09.
La reference physique historique est identique apres 1000 pas.

Limites : le test navigateur passe par du HTML charge en memoire ; l'ouverture
native des fichiers Windows n'est pas testee dans cet environnement.
