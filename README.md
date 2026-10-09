# Érosion — Sandbox Hydrographique

Une simulation locale d'eau, de transport de sédiments, d'erosion et de depot.
Le relief evolue réellement : l'image n'est pas une animation preenregistree.

## Demarrer

Ouvrir `index.html` dans le navigateur, ou double-cliquer sur `start.cmd` sous
Windows. Aucun serveur, installation npm, compte ou connexion Internet n'est
necessaire pour utiliser l'application.

Le fichier **`dist/erosion-simulation.html`** contient aussi toute l'application
dans un seul HTML, sans fichiers annexes : c'est la version a partager facilement.

Cliquer sur le terrain pour ajouter une source. Ouvrir **Terrain & simulation**
pour parcourir les reliefs, puis passer à **Érosion / dépôts** pour observer
le creusement (orange) et les accumulations (vert).

## Reliefs et navigation (2.1.1)

Le design existant est conservé : panneau compact de 320 px, couleurs,
typographie, couches visibles, barre flottante, accordéons et comportement mobile.
Les pictogrammes Lucide sont toujours intégrés localement. La nouvelle navigation
réutilise leurs chevrons et les styles du panneau, sans nouvelle dépendance.

**Lancer une rivière** et la case **Le terrain peut s'éroder** ont été retirés.
Le formulaire relief / graine / générer / rejouer est remplacé par une ligne
**précédent / nom du relief / suivant**. Les sections secondaires restent repliées
au départ ; aucune nouvelle interface n'est ajoutée sur le terrain.

Chaque ouverture commence sur un nouveau relief. L'application garde localement
les recettes des **60 derniers reliefs**, quand le navigateur autorise le stockage.
Elle conserve aussi l'avancement de la séquence : rafraîchir ne reprend pas une
liste fixe depuis le début. Sans stockage, la navigation fonctionne en mémoire et
chaque ouverture utilise une nouvelle valeur aléatoire.

Les neuf familles sont **Vallons**, **Vallée sinueuse**, **Versants**,
**Confluence**, **Bassin ouvert**, **Massif montagneux**, **Plateaux entaillés**,
**Plaine fluviale** et **Terrain naturel**. L'ordre est mélangé ; toutes les familles sont
proposées avant une répétition. Orientation, pentes et structures varient.
**Terrain naturel** retrouve exactement le générateur fractal des premières versions :
les cartes y sont plus imprévisibles et comportent parfois des creux fermés.
Elles sont présentées comme « Génération classique », pas comme une vue
dézoomée : leur échelle n'a pas été modifiée. Une migration discrète permet de
retrouver ce relief dès le prochain parcours pour les historiques de 2.1.0.

Chaque nouvelle génération régionale choisit automatiquement entre **vue rapprochée**,
**vue paysage** et **vue d'ensemble**. Le cadrage figure discrètement sous le
nom du relief : aucune nouvelle commande ni modification de la caméra n'est
nécessaire. Les vues larges ne grossissent pas simplement un seul massif :
elles incluent plusieurs sommets, terrasses, vallées, tributaires ou dépressions
suivant le type de terrain. Les reliefs régionaux ouverts offrent des écoulements vers
les limites et les bassins gardent des cuvettes susceptibles de retenir l'eau.
Le terrain naturel historique conserve quant à lui ses cuvettes spontanées.
Aucune eau, source ou rivière n'est insérée automatiquement.

Voir `docs/RELIEFS_ET_NAVIGATION.md` pour le périmètre et les vérifications.
`docs/AJUSTEMENT_INTERFACE.md` conserve le compte rendu de la version 2.0.1.

## Manipuler

Un clic ajoute une source exactement dans la cellule visee. Un clic pres d'une
source existante l'active ou la coupe. Son debit se modifie dans le panneau de
droite ; le clic droit donne aussi acces aux commandes de source.

Les boutons **précédent / suivant** parcourent les reliefs. Après un clic dans
le sélecteur, les flèches gauche / droite du clavier et la molette font de même.
La molette n'est interceptée que dans ce contrôle explicitement activé, jamais sur
l'ensemble du panneau ; Ctrl + molette reste disponible pour le zoom du navigateur.
Le bouton circulaire existant dans la barre du bas rejoint le même parcours.

**Changer de relief remet le terrain à son état initial et efface l'eau, les
sédiments en suspension, les sources, le temps et les bilans.** Revenir en arrière
retrouve exactement le relief initial, pas la simulation abandonnée dessus.
Utiliser **Sauvegarder** pour conserver un état de simulation complet.
La pause, la vitesse, la pluie, les limites et le mode de visualisation sont
conservés pendant la navigation. Les nouveaux terrains sont toujours érodables.

Les limites peuvent être ouvertes (eau et sédiments sortent) ou fermées (ils
restent, sauf évaporation). La pluie reste réglable. La suppression des sources
laisse le terrain et l'eau existants. La barre espace met en pause ou reprend,
hors des champs et boutons de formulaire.

**Terrain (D8)** montre un drainage potentiel du terrain : ce n'est pas l'eau réelle
et ce reseau ne pilote pas la simulation. Courbes topographiques et vecteurs de
courant sont activables dans **Couches visuelles**, avec les courbes topographiques et les vecteurs de courant
actifs par defaut, comme dans l'interface historique. Les traceurs sont decoratifs : les bilans reposent sur les
champs physiques, pas sur des particules dessinees.

**Sauvegarder** exporte un JSON contenant le terrain, l'eau, les sédiments, les
flux, les sources, les options et les bilans. **Ouvrir** restaure cet etat en pause.
Les fichiers incompatibles ou invalides sont rejetes avant de modifier la session.
La version 2 est requise ; le JSON n'est pas un format de sauvegarde de l'ancien moteur.
Les anciennes sauvegardes v2, y compris les anciens reliefs et une érosion désactivée,
restent lisibles sans altérer leur état physique. Passer ensuite à un autre relief
réactive l'érosion. Les sauvegardes des nouveaux reliefs demandent la version 2.1.0
ou ultérieure pour les trois nouvelles familles (2.0.2 pour les précédentes) pour être ouvertes.


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

`npm test` exécute 51 tests : conservation, comportement physique, nouveaux reliefs,
compatibilité des sauvegardes, historique et stockage.
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
npm run test:navigation
```

Ils chargent le HTML autonome en memoire et exercent les vrais clics, fichiers
et calculs. `CHROMIUM_EXECUTABLE` permet de choisir un executable Chromium existant.
Les parcours navigateur couvrent les interactions, huit tailles de fenêtre et la
navigation entre reliefs. Le stockage est injecté pour les essais de redémarrage,
car la politique du navigateur de test bloque les navigations directes file/HTTP.
Les rechargements natifs et le double-clic sous Windows ne sont pas revendiqués.

Pour réassembler le HTML hors ligne après une modification du terrain ou de l'interface :

```sh
npm run build -- --skip-icons
```

Cette option réutilise `js/ui/icons.js`, déjà livré. Après toute modification de
`UiIcons.js` ou de Lucide, utiliser `npm ci` puis le build normal pour reconstruire
les icônes. Les dépendances et le bundle d'icônes ne changent pas dans cette version.

## Recherche preservee, choix explicites

Lire **`docs/RECHERCHE_ET_VALIDATION.md`** pour les resultats, les compromis et les
limites. **`tests/README.md`** distingue les tests v2 de la recherche historique.
Les donnees générées de l'archive initiale sont conservées ; les nouveaux resultats
de cette livraison sont dans **`tests/generated/terrain-validation/`** et
**`tests/generated/design-validation/`**. Le moteur initial est fige dans
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
