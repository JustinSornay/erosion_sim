# Tests v2 et recherche historique

## Validation de la version livree

| Commande | Ce qu'elle verifie |
| --- | --- |
| `npm test` | 43 tests : physique, reliefs, historique, stockage et sauvegardes |
| `npm run test:baseline` | Egalite exacte des 9 buffers physiques a 1000 pas avec la reference v2 |
| `npm run test:long` | Quatre scenarios, 45 000 pas + 1 500 pas apres arret de source |
| `npm run test:browser` | Construction autonome et 47 contrôles de navigateur avec le vrai moteur |
| `npm run test:navigation` | Navigation, molette, clavier, sauvegardes et redémarrage de l'application |
| `npm run test:layout` | 85 contrôles sur 8 tailles de fenêtre et chargement multi-fichiers |
| `npm run test:legacy` | SHA-256 des 10 fichiers JS initiaux, ancrage de 39 scripts historiques et determinisme du moteur archive |
| `node tests/regression/source-injection.js` | Centre, bords et coins ; debit injecte conserve |
| `node tests/regression/source-routing-stability.js` | La source reste a l'endroit clique quand le relief change |
| `node tests/regression/physics-determinism.js 1000` | Deux executions donnent exactement les memes champs |
| `npm run benchmark` | Temps des phases du moteur courant, sans rendu |

Les rapports de cette livraison sont dans `generated/terrain-validation/` et
`generated/design-validation/`. Les essais longs et les diagnostics historiques
ne sont pas relancés pour cette modification de navigation.
Les erreurs maximales des essais longs sont mesurees a chaque tranche de 1000 pas ;
le transport verifie en plus la positivite de la quantite d'eau restante a chaque pas.
Une comparaison binaire seule ne suffit pas : les invariants et comportements ont
leurs propres tests, independamment des valeurs de la reference.

## References binaires

La reference active est `fixtures/N192-conservative-v2/physics-1000.bin`, composee de
neuf buffers Float64 consecutifs : b, d, s, u, v, fL, fR, fT, fB. Elle utilise le
terrain naturel, graine 314159265, source (48,48), debit 2.2 et options v2 par defaut.
La commande de comparaison ne cree ni ne modifie ce fichier. La regeneration est
explicite : `node tests/regression/physics-regression.js 1000 --write-baseline` ;
un fichier existant demande `--force`. Toute promotion doit d'abord passer les
invariants et etre motivee, plutot que normaliser un resultat incorrect.

Les anciens fichiers `fixtures/N192/` et `fixtures/N192-incoming-source/` sont
inchanges. Ils ne correspondent deja pas exactement au JS contenu dans l'archive
initiale. `npm run audit:legacy` documente ces ecarts en lecture seule ;
`regression/legacy-physics-regression.js` reste disponible pour exposer cet echec
historique avec un code de sortie non nul. Il ne fait pas partie du passage de
validation v2 et ne doit pas etre presente comme un test reussi.

## Recherche v1

Les diagnostics et experiences historiques restent dans leurs repertoires.
Leurs chargements de JS sont diriges vers `fixtures/legacy-engine/`, copie exacte
et verifiable du moteur recu. Dans leurs anciens rapports, `CURRENT`, `production`
ou `unchanged` designent cette version historique, **pas** le moteur v2 livre.
Leur raisonnement et leurs sorties d'origine ne sont pas reecrits pour coller a v2.

La recherche complete n'a pas ete relancee apres cette separation. Certaines
experiences sont longues, injectent des variantes par remplacement de source
et peuvent ne pas etre des suites a resultat vert. Les relancer peut reecrire
leurs propres sorties générées : utiliser une copie de travail pour conserver
l'evidence historique. Aucun de ces scripts ne doit modifier le JS applicatif.

L'ancien README des tests, qui marquait encore des experiences comme `Pending`,
est conserve dans `../docs/HISTORIQUE_TESTS_V1.md`. Le rapport de finalisation
s'appuie sur les sorties effectivement presentes, pas sur ces statuts devenus anciens.

## Environnement

Node 22.16.0 pour les tests de calcul ; Python 3.13.5 et Chromium 144.0.7559.96
pour Playwright. Le navigateur de l'environnement bloque la navigation directe
`file://` et HTTP local par politique d'administration. Les tests ont donc charge
le contenu du **vrai fichier autonome** avec `page.set_content`, sans simulation
de DOM ni moteur factice. Aucune politique du navigateur n'a ete modifiee.
Les controles de telechargement JSON et de rechargement par champ fichier sont reels.
Aucune requete reseau n'a ete observee pendant ce parcours.

## Régression d'interface 2.0.1

`npm run test:browser` conserve les contrôles physiques et les interactions v2,
et vérifie aussi le titre compact, les couches visibles, les sections repliables,
les SVG locaux et la navigation clavier : **42 contrôles**.

`npm run test:layout` couvre **8 tailles de fenêtre**, les menus au bord du terrain,
la barre flottante, les panneaux mobiles et le chargement séparé des ressources :
**85 contrôles**. Les résultats sont dans `tests/generated/design-validation/`,
séparément des résultats de finalisation v2 conservés.

Les tests Chromium s'exécutent sans accès au réseau. Le test multi-fichiers
charge les scripts et feuilles de style originaux via interception locale ;
la navigation vers un serveur localhost est bloquée par la politique du navigateur
du conteneur. Cela ne constitue pas un test de double-clic sous Windows.

## Navigation et reliefs 2.1.0

`regression/terrain-navigation.test.js` ajoute 31 tests aux 20 tests physiques.
Les formes sont testées sur plusieurs graines, les chemins descendants sur
toutes les familles et échelles sur de vrais pas de simulation.
La référence physique v2 et les empreintes de l'ancien moteur restent inchangées.

`browser/navigation.py` vérifie les interactions réelles (clic, clavier, molette,
import JSON et mobile). Les redémarrages utilisent sept pages neuves et un backend
Storage injecté ; ce n'est pas un test de rechargement natif. Le stockage bloqué,
plein ou invalide est aussi couvert dans les tests Node.

Dans un environnement sans registre npm accessible, construire le HTML avec
`npm run build -- --skip-icons`, puis lancer directement les trois scripts Python.
Le build normal des icônes n'a pas été relancé dans cette livraison, car les
paquets npm ne sont pas accessibles ; le bundle Lucide livré est inchangé.

### Réintégration du terrain naturel (2.1.1)

`npm test` vérifie la fidélité des hauteurs du générateur naturel historique
avec quatre empreintes de grilles, la conservation des sauvegardes et la
migration non destructive des historiques 2.1.0. Le contrôle navigateur
`tests/browser/navigation.py` visite une génération classique, vérifie le
sous-titre et son retour exact via précédent/suivant.
