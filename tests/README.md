# Tests v2 et recherche historique

## Validation de la version livree

| Commande | Ce qu'elle verifie |
| --- | --- |
| `npm test` | 20 tests : eau, sédiments, sources, rotation du relief, lac au repos, roche de fond, determinisme et sauvegarde |
| `npm run test:baseline` | Egalite exacte des 9 buffers physiques a 1000 pas avec la reference v2 |
| `npm run test:long` | Quatre scenarios, 45 000 pas + 1 500 pas apres arret de source |
| `npm run test:browser` | Construction autonome et 28 controles de navigateur avec le vrai moteur |
| `npm run test:legacy` | SHA-256 des 10 fichiers JS initiaux, ancrage de 39 scripts historiques et determinisme du moteur archive |
| `node tests/regression/source-injection.js` | Centre, bords et coins ; debit injecte conserve |
| `node tests/regression/source-routing-stability.js` | La source reste a l'endroit clique quand le relief change |
| `node tests/regression/physics-determinism.js 1000` | Deux executions donnent exactement les memes champs |
| `npm run benchmark` | Temps des phases du moteur courant, sans rendu |

Les rapports effectifs de cette livraison sont dans `generated/v2-validation/`.
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
