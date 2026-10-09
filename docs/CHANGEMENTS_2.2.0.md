# Érosion Sandbox 2.2.0

## Ajouts

- Intégration de 9 nouvelles familles de reliefs dans le navigateur de générations :
  - Canyons
  - Badlands
  - Vallée glaciaire
  - Relief karstique
  - Caldeira
  - Cône de déjection
  - Mesas et buttes
  - Cuestas
  - Chenaux multiples
- Le catalogue de découverte comprend désormais 18 entrées au total :
  - 17 familles paysagères guidées
  - le `Terrain naturel` historique conservé bit-à-bit.

## Génération

- Les familles historiques restent inchangées dans leur intention visuelle.
- Les nouvelles familles passent par un échantillonnage régional dédié, avec variation de cadrage selon les 3 échelles déjà en place.
- Les générations conservent une diversité interne plus forte (branches secondaires, bancs, dolines, buttes, escarpements, éventails, etc.) afin d’éviter l’effet de simple rebricolage d’une même topologie.

## Historique / navigation

- Révision du catalogue portée à `3`.
- Les historiques existants sont migrés sans perte de recettes.
- Les nouvelles familles sont injectées dans le sac de découverte des anciennes sessions sans casser la navigation précédent/suivant.

## Validation

- Suite de non-régression mise à jour pour couvrir le nouveau catalogue.
- `npm test` : 75 tests passants.
- HTML autonome régénéré avec `node tools/build-standalone.js --skip-icons`.
