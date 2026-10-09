# Validation 2.3.0

## Commandes actives

| Commande | Périmètre |
| --- | --- |
| `npm test` | Physique, reliefs bruts, navigation, scènes hydrologiques, sauvegardes v2/v3. |
| `npm run test:scenes` | Profils climatiques, placement des sources, mers/lacs, pluies figées, migration. |
| `npm run test:baseline` | Comparaison binaire aux 9 champs de la référence historique à 1 000 pas. |
| `npm run test:legacy` | Intégrité des dix fichiers initiaux, 39 lanceurs historiques et déterminisme de l'archive. |
| `npm run build:offline` | HTML autonome reconstruit avec les icônes locales déjà livrées. |
| `npm run test:browser` | Parcours réels Chromium, sauvegarde/import, pluie, sources, cartes et huit tailles de fenêtre. |
| `npm run test:navigation` / `npm run test:layout` | Alias de la même suite navigateur unifiée ; ne pas additionner ses résultats. |
| `npm run audit:scenes` | 576 cartes aquatiques échantillonnées et trois simulations de 2 000 pas. |

Les résultats actuels sont dans **`generated/scenes-validation/`**.
Lire `validation.md` pour les comptes et limites exacts.
Les autres répertoires de rapports sont conservés comme historiques, pas comme
résultats de cette version. Les trois anciens points d'entrée navigateur redirigent
vers `browser/scenes.py` pour éviter de tester l'ancienne disposition du panneau.

## Stratégie

`genTerrain` reste une API brute sèche utilisée par les régressions historiques.
`generateScene` est l'API utilisée par l'interface et fait l'objet de tests séparés.
Les cartes sont comparées à leur reconstruction exacte ; le contrôle ne se contente
pas de constater que la graine ou le nom change.

Les tests hydrostatiques désactivent explicitement sources, pluie et évaporation.
Les tests forcés vérifient séparément les bilans d'eau et de solide, les flux marins
entrants/sortants, la non-négativité et la reprise bit-à-bit après import JSON.
Les 108 empreintes des terrains v2.2.0 viennent de l'archive reçue, pas d'une
promotion des nouveaux résultats. Le fichier de référence physique n'est pas réécrit.

## Environnement et limites

Calcul sous Node 22.16.0. Interface dans le vrai Chromium Linux via Playwright.
La politique de ce navigateur interdit les navigations `file://` et HTTP local.
Le **vrai HTML autonome** est donc chargé avec `page.set_content`. Les scripts de
l'entrée source sont aussi assemblés dans l'ordre du document pour vérifier leur initialisation.
Le moteur, le DOM et le rendu Canvas ne sont pas simulés.

Les tests de persistance d'interface utilisent une implémentation de test de l'API
Storage, car `about:blank` ne donne pas de stockage natif exploitable.
Les transferts JSON par téléchargement et champ fichier sont réels.
Ces tests ne valident pas le double-clic Windows, le comportement natif du stockage
`file://` ni les autres navigateurs. Aucune politique du navigateur n'a été modifiée.

Le build avec reconstruction des icônes Lucide n'a pas pu être relancé ici : le
registre npm est inaccessible par DNS. `build:offline` a été utilisé ; le bundle
Lucide source n'a pas changé, et les nouveaux pictogrammes sont un fichier local distinct.

## Recherche ancienne

Les diagnostics et expériences v1 pointent toujours sur `fixtures/legacy-engine/`.
Leurs anciens rapports et baselines ne deviennent pas des vérifications de v2.3.0.
La comparaison aux vieilles baselines v1 est un diagnostic connu comme divergent,
indépendant de la référence active `fixtures/N192-conservative-v2/physics-1000.bin`.
La recherche v1 complète et la suite historique `test:long` ne sont pas relancées
pour cette livraison ; les nouveaux essais longs aquatiques sont dans l'audit dédié.
