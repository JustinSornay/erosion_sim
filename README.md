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

`node tests/physics-regression.js 1000 --write-baseline` crée une baseline N128 avec seed
et source fixes. Une baseline existante exige `--force` pour être remplacée.
`node tests/physics-regression.js 1000` compare ensuite les buffers physiques à cette référence.
`node tests/physics-benchmark.js 5000` mesure la médiane des steps/s du moteur isolé.
`node tests/physics-profile.js 5000` mesure les cinq phases de `step()` hors production.
`node tests/browser-benchmark.js` mesure toutes les couches à N192 pour x1, x2, x5 et x10.
