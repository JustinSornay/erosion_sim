# Érosion — Sandbox Hydrographique

Une simulation locale d'eau, de transport de sédiments, d'erosion et de depot.
Le relief evolue réellement : l'image n'est pas une animation preenregistree.

## Demarrer

Ouvrir `index.html` dans le navigateur, ou double-cliquer sur `start.cmd` sous
Windows. Aucun serveur, installation npm, compte ou connexion Internet n'est
necessaire pour utiliser l'application.

Le fichier **`dist/erosion-simulation.html`** contient aussi toute l'application
dans un seul HTML, sans fichiers annexes : c'est la version a partager facilement.

Ouvrir **Terrain & simulation**, puis cliquer sur **Lancer une rivière** pour une demonstration reproductible. Attendre
quelques secondes, puis passer a **Érosion / dépôts** pour voir le travail du
courant : orange = creusement, vert = accumulation. La vitesse demandee est x5
pour la demonstration ; la vitesse réellement atteinte est affichee séparément.

## Interface rapprochée du design d'origine (2.0.1)

Le titre **Sandbox Hydrographique**, le panneau compact de 320 px, les couleurs
historiques, les six couches visibles et la barre flottante sont rétablis.
Le terrain reprend toute la place disponible sans passer sous le panneau.
Le démarrage utilise le terrain naturel et les courbes topographiques ; la vallée
reste accessible en démonstration. Les pictogrammes viennent de [Lucide](https://lucide.dev/),
intégré localement sans police d'icônes ni dépendance distante à l'exécution.

Les fonctionnalités v2 restent présentes : **Terrain & simulation** regroupe
reliefs, graine, rejeu, démonstration, pluie, limites et activation de l'érosion ;
**Bilans & lecture** regroupe les mesures et leurs explications. Les deux sections
sont repliées au départ. Les boutons **Sauvegarder** et **Ouvrir** restent visibles.
Le moteur et le format de sauvegarde v2 n'ont pas été modifiés.

Voir `docs/AJUSTEMENT_INTERFACE.md` pour le périmètre et les vérifications.

## Manipuler

Un clic ajoute une source exactement dans la cellule visee. Un clic pres d'une
source existante l'active ou la coupe. Son debit se modifie dans le panneau de
droite ; le clic droit donne aussi acces aux commandes de source.

Choisir un relief et une graine, puis **Generer**, cree un terrain neuf sans source.
**Rejouer** restaure le terrain initial avec les memes sources, debits et options.
Le bouton fleche circulaire de la barre du bas genere une nouvelle graine ; le
bouton de suppression des sources supprime les sources mais laisse le terrain et l'eau existants.
La barre espace met en pause/reprend hors des champs de formulaire.

Quatre reliefs sont disponibles : vallee sinueuse, terrain naturel historique,
cuvette et crete. Les limites peuvent etre ouvertes (eau et sédiments sortent)
ou fermees (ils restent, sauf evaporation). La pluie peut etre ajoutee ; decocher
l'erosion fige les echanges avec le sol, mais laisse circuler l'eau et les sédiments.

**Terrain (D8)** montre un drainage potentiel du terrain : ce n'est pas l'eau réelle
et ce reseau ne pilote pas la simulation. Courbes topographiques et vecteurs de
courant sont activables dans **Couches visuelles**, avec les courbes topographiques et les vecteurs de courant
actifs par defaut, comme dans l'interface historique. Les traceurs sont decoratifs : les bilans reposent sur les
champs physiques, pas sur des particules dessinees.

**Sauvegarder** exporte un JSON contenant le terrain, l'eau, les sédiments, les
flux, les sources, les options et les bilans. **Ouvrir** restaure cet etat en pause.
Les fichiers incompatibles ou invalides sont rejetes avant de modifier la session.
La version 2 est requise ; le JSON n'est pas un format de sauvegarde de l'ancien moteur.

## Lire les bilans

La section repliable **Bilans & lecture** affiche l'eau presente, l'eau sortie, la matiere erodee et la matiere
deposee cumulees. Cette meme section affiche les residus de bilan,
l'evaporation et les sédiments sortis. Une matiere peut etre erodee puis deposee
plusieurs fois : les cumuls d'echange ne sont pas le changement net de relief.

Les unites sont internes au modele. Le temps affiche est un temps de simulation,
pas une duree geologique calibree. Cette application est un bac a sable de paysage,
**pas un outil de prevision hydrologique**.

## Verification et developpement

L'application n'a aucune dependance d'execution. Les commandes ci-dessous utilisent
Node.js 22 ou plus ; cette livraison a ete testee avec Node 22.16.0. Il n'y a pas de
`npm install` a effectuer pour les tests du moteur.

```sh
npm test
npm run test:baseline
npm run test:legacy
npm run test:long
npm ci
npm run build
```

`npm test` execute les 20 tests de comportement et de conservation.
`test:baseline` compare exactement les neuf champs a une reference v2 de 1000 pas.
`test:legacy` verifie l'integrite du moteur historique et son determinisme :
il ne pretend pas que ses anciennes references binaires sont coherentes.
`test:long` execute 46 500 pas sur quatre scenarios, y compris un arret de source.

Les tests navigateur demandent en plus Python et Playwright/Chromium :

```sh
python -m pip install playwright
python -m playwright install chromium
npm run test:browser
npm run test:layout
```

Ils chargent le HTML autonome en memoire et exercent les vrais clics, fichiers
et calculs. `CHROMIUM_EXECUTABLE` permet de choisir un executable Chromium existant.
Cette livraison a valide ce parcours sous Chromium 144 ; elle ne pretend pas
avoir ete testee sur Windows ni dans tous les navigateurs.

## Recherche preservee, choix explicites

Lire **`docs/RECHERCHE_ET_VALIDATION.md`** pour les resultats, les compromis et les
limites. **`tests/README.md`** distingue les tests v2 de la recherche historique.
Les donnees générées de l'archive initiale sont conservées ; les nouveaux resultats
sont dans **`tests/generated/v2-validation/`**. Le moteur initial est fige dans
`tests/fixtures/legacy-engine/`, avec ses empreintes SHA-256 et son commit d'origine.

L'audit `npm run audit:legacy` reproduit notamment la creation artificielle de
matiere dans l'ancien moteur et signale ses references binaires deja divergentes.
Il ne reecrit aucune reference historique et n'est pas une validation de celles-ci.

## Structure

`js/core/` contient l'etat, les calculs et le format de sauvegarde ; `js/simulation/`
contient le moteur, le terrain et les couches de visualisation du courant.
`js/rendering/`, `js/ui/` et `css/` restent independants du calcul physique.
`tools/build-standalone.js` compile les icônes Lucide avec esbuild, puis assemble le HTML autonome.
`js/ui/icons.js` est généré et livré pour ouvrir `index.html` sans installation npm.
Les scripts classiques sont charges avec `defer` dans leur ordre de dependance.
