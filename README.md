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
