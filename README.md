# Érosion — Sandbox Hydrographique 2.3.0

Des cartes prêtes à explorer, avec leur eau, leur pluie et leurs sources.
Le paysage évolue réellement dans le moteur : le bleu n'est pas une animation préenregistrée.

## Ouvrir

Ouvrir `index.html`, ou double-cliquer sur `start.cmd` sous Windows.
`dist/erosion-simulation.html` contient l'application complète dans un seul fichier.
L'application n'a besoin ni de Node, ni de npm, ni d'un compte, ni d'une connexion pour fonctionner.
Une politique d'entreprise peut toutefois interdire l'ouverture de fichiers HTML locaux.

## Explorer

Le sélecteur de carte est maintenant en haut du panneau, toujours accessible.
Les chevrons, les flèches du clavier et la molette après un clic dans ce sélecteur
parcourent le même historique. Le bouton suivant de la barre flottante fait de même.

**27 familles** : les 18 familles précédentes, dont le Terrain naturel historique,
plus neuf familles en eau : Île océanique, Archipel, Côte & criques, Estuaire,
Fjord, Lagune côtière, Atoll, Lac de vallée et Lac de cratère.
Certaines anciennes cartes à dépressions peuvent aussi commencer avec un bassin en eau.
Les terres sèches ne disparaissent pas. Les trois cadrages procéduraux restent présents ;
le Terrain naturel conserve sa génération classique.

Une première visite propose une carte en eau, puis toutes les familles sont explorées
par sacs mélangés. Chaque ouverture avance la graine. Les 60 dernières recettes sont
conservées si le navigateur autorise le stockage local. Sans stockage, le parcours
fonctionne en mémoire et une nouvelle graine est choisie au prochain démarrage.
Le stockage est propre à l'origine ou au fichier selon le navigateur : déplacer
l'application dans un nouveau dossier peut donner un historique distinct.

**Précédent et Recommencer retrouvent l'état initial de la carte**, avec son eau,
sa pluie et ses sources, pas la simulation abandonnée dessus.
Le temps, les sédiments mobiles et les bilans repartent de zéro ; la pause, la vitesse
et la vue choisie sont conservées. Utiliser Sauvegarder pour conserver une évolution.

## Pluie et sources

Le bouton de pluie fait uniquement **marche / arrêt**. L'intensité est fixée par
la recette de la carte, avec quatre pictogrammes : bruine, pluie fine, pluie soutenue,
averse. L'icône reste lisible, grisée lorsque la pluie est coupée.
Les cartes arides commencent plus souvent sans pluie ; les cartes humides plus souvent
avec pluie. Une carte sèche autorise toujours l'activation de son intensité prévue.
Changer de carte applique son propre réglage de départ, sans hériter du bouton précédent.

Une carte peut avoir **zéro à trois sources préconfigurées**. Leur placement privilégie
un parcours descendant vers une sortie ou un plan d'eau, loin des bords et hors de l'eau.
Le débit tient compte du type de paysage, du bassin amont et de la longueur du parcours.
Aucune source n'est forcée lorsque les candidats sont inadaptés.

Un clic sur une terre ajoute une source au débit adapté à la carte ; un clic sur
une source l'active ou la coupe. Le panneau et le menu contextuel permettent aussi de
la retirer. Il n'y a plus de saisie numérique du débit. Le débit exact reste
consultable dans l'infobulle de son niveau Faible / Modéré / Soutenu.
Retirer les sources ne supprime pas l'eau présente.

## Interface

La palette, le panneau compact, la typographie, les contours, les ombres et la barre
flottante sont conservés. Le panneau donne priorité à la carte et à la pluie.
Les sources sont regroupées ; **Affichage** et **Détails de la simulation** sont repliés.
Affichage propose Paysage ou Érosion & dépôts, puis trois repères facultatifs :
courbes du relief, courants, traceurs. Le réseau potentiel D8 reste dans les diagnostics.

La barre flottante ne contient plus que pause/reprise, vitesse et carte suivante.
Un clic sur la vitesse parcourt ×1, ×2, ×5, ×10. Espace commande la lecture lorsque
le focus n'est pas sur un autre contrôle. Sur mobile, Échap referme le panneau.

## Eau réelle, modèle simplifié

Les mers sont remplies depuis les bords connectés, sans noyer automatiquement les
cuvettes isolées. Les lacs sont remplis dans leur bassin. Les niveaux initiaux sont
horizontaux, les vitesses et flux initiaux nuls, et l'eau initiale figure dans le bilan.
La profondeur est rendue dans la palette bleue existante pour distinguer hauts-fonds
et eaux profondes.

La mer impose un niveau de référence **aux faces externes** de la grille. Entrées et
sorties sont comptées ; la surface intérieure n'est jamais artificiellement remise à niveau.
Un lac reste une réserve finie, qui évolue avec pluie, sources, évaporation et débordement.

Il ne s'agit pas d'un simulateur océanographique : pas de vagues, marées, salinité,
transport littoral par les vagues, ni réseau karstique souterrain. Les formes initiales
ne constituent pas une simulation des processus géologiques qui les ont créées.
Les unités sont non calibrées et ne représentent pas des mètres ou des années.

## Sauvegardes

Les nouveaux fichiers JSON sont en version 3 : champs physiques, options, climat de
carte et flux aux limites marines. La reprise ne se contente pas de reproduire une image.
Les sauvegardes version 2 restent importables, sans remplacer leurs sources ni leur
pluie active personnalisée. Cette intensité importée devient le niveau fixe du bouton.
Une importation ouvre la simulation en pause. Les anciennes versions de l'application
ne peuvent pas lire les nouveaux fichiers version 3.

## Construire et valider

Node 22+ est requis pour les tests, pas pour utiliser l'application.

```sh
npm test
npm run test:baseline
npm run test:legacy
npm run build:offline
npm run test:browser
npm run audit:scenes
```

`build:offline` utilise le bundle d'icônes Lucide déjà livré. Les pictogrammes de
pluie sont définis localement dans `js/ui/scene-icons.js`, sans dépendance externe.
Pour reconstruire le bundle Lucide lui-même, utiliser `npm ci`, puis `npm run build`.
Les tests navigateur nécessitent Python, Playwright et Chromium.

Les résultats de cette version sont exclusivement dans
`tests/generated/scenes-validation/`. Les autres rapports générés sont historiques.
Voir `docs/CHANGEMENTS_2.3.0.md`, `docs/RELIEFS_ET_NAVIGATION.md` et `tests/README.md`.
