# Érosion — Sandbox hydrographique

Simulation d'érosion hydraulique exécutée entièrement dans le navigateur.

## Architecture

- `index.html` : structure sémantique et chargement unique de l'application.
- `css/core/` : fondations visuelles ; `css/components/` : styles des composants.
- `js/core/` : constantes, calculs génériques et état mutable.
- `js/simulation/` : terrain, érosion, drainage et particules.
- `js/rendering/` et `js/ui/` : rendu Canvas et interactions DOM.
- `js/main.js` : initialisation et boucle d'animation.

Les scripts applicatifs sont chargés dans le `<head>` avec `defer`, dans leur ordre de
dépendance. L'application reste compatible avec une ouverture directe via `file://`.

## Validation physique

`node tests/regression/physics-regression.js 1000 --baseline-version=incoming-source --write-baseline` crée une baseline N192 versionnée avec seed
et source fixes. Une baseline existante exige `--force` pour être remplacée.
`node tests/regression/physics-regression.js 1000` compare ensuite les buffers physiques à cette référence.
`node tests/regression/source-injection.js` valide conservation du débit injecté au centre, bord et coin.
`node tests/diagnostics/source-impact-profile.js` compare injection localisée et distribuée à 500, 2000, 5000 et 10000 steps.
`node tests/benchmarks/physics-benchmark.js 5000` mesure la médiane des steps/s du moteur isolé.
`node tests/benchmarks/physics-profile.js 5000` mesure les cinq phases de `step()` hors production.
`node tests/benchmarks/browser-benchmark.js` mesure toutes les couches à N192 pour x1, x2, x5 et x10.
