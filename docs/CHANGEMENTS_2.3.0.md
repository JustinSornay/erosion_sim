# Version 2.3.0 — Cartes prêtes à explorer

## Livré

- Neuf nouvelles familles en eau, soit 27 familles au total.
- Eau initiale réelle, niveaux horizontaux, remplissage des seules zones connectées.
- Limites marines à niveau prescrit avec flux signés, entrées/sorties comptabilisées.
- Pluie déterministe propre à chaque carte : intensité fixe, quatre pictogrammes,
  activation initiale liée au type de paysage, seul marche/arrêt exposé.
- Sources facultatives en amont, débits adaptés, aucune source artificiellement placée dans la mer.
- Saisie numérique du débit et choix manuel des limites retirés.
- Carte et pluie visibles immédiatement, deux vues d'affichage secondaires, trois
  repères facultatifs, analyse D8 dans les diagnostics.
- Trois commandes flottantes : lecture, vitesse, suivant. Recommencer dans le panneau.
- Sauvegardes v3, import v2 et migration du catalogue d'historique vers la révision 4.
- Palette et composants visuels existants conservés ; profondeur des mers lisible
  avec des nuances de la même famille de bleus.

## Compatibilité et comportement

Le générateur brut `genTerrain` reste sec : c'est l'API des fixtures historiques.
La navigation appelle `generateScene`, qui ajoute eau, pluie et sources et remet
les bilans à zéro en comptant l'eau initiale. Les anciennes grilles ne sont pas modifiées.
La pluie et les sources sont réinitialisées selon la carte lors d'une navigation ou
d'un redémarrage. Pause, vitesse et vue ne sont pas changées par cette action.

Les limites marines ne sont actives que pour les nouvelles scènes marines ; les
calculs historiques gardent leur chemin d'exécution. Le moteur n'introduit ni marée
ni vagues fictives et ne remplace pas l'évolution d'un lac par un remplissage permanent.

## Vérification

Voir `../tests/generated/scenes-validation/validation.md` et les logs du même dossier.
Les captures proviennent du vrai rendu de l'application, pas d'illustrations générées.
