# Ajustement de l'interface — version 2.0.1

## Demande

Conserver les améliorations de la simulation finalisée tout en respectant davantage
le design de l'archive initiale `erosion_sim.zip`. La base fonctionnelle de cette
révision est `erosion_sim_terminee.zip`.

## Présentation rétablie

Le titre d'origine **Sandbox Hydrographique** revient à 14 px. Les mentions
« Erosion / Lab », le grand titre et le bouton de démonstration surdimensionné
sont retirés de la présentation principale. La palette, le fond, les ombres, les
pastilles de couches et la barre de lecture reprennent les composants initiaux.
Le panneau mesure 320 px sur ordinateur et 260 px sur tablette, comme avant.

Les couches Terrain et Eau & Dynamique sont visibles immédiatement, suivies de
la liste des sources. Les sources conservent leur débit modifiable. Les nouveaux
outils sont placés dans deux sections repliées : **Terrain & simulation** et
**Bilans & lecture**. Les sauvegardes restent accessibles en bas du panneau.

Le terrain retrouve un grand affichage carré. La correction évitant de le masquer
sous le panneau est conservée. Le terrain naturel et les couches topographiques
sont actifs au démarrage ; la vallée reproductible reste une démonstration
accessible dans **Terrain & simulation > Lancer une rivière**.
Les pictogrammes sont vectoriels et intégrés au document. Aucune police n'est
jointe ; les piles typographiques utilisent les polices disponibles localement.

## Fonctionnalités conservées

Les quatre reliefs, les graines, le rejeu, la pluie, les limites ouvertes/fermées,
l'activation de l'érosion, la vue Érosion / dépôts, l'analyse D8, les bilans,
l'export/import de l'état complet et le moteur conservatif restent présents.
Les huit fichiers de calcul, d'état et de sauvegarde sont identiques octet pour
octet à la version finalisée ; leurs SHA-256 sont enregistrés dans
`tests/generated/design-validation/engine-integrity.json`.

Les changements JavaScript concernent les contrôles de présentation, le choix du
terrain initial, les valeurs initiales des couches et le dimensionnement du canvas.
Les menu contextuels restent dans la zone de terrain. L'ouverture du panneau
mobile ne décale plus la page lors du transfert de focus. Un panneau fermé est
retiré du parcours clavier ; Échap fonctionne aussi depuis un champ ; Espace sur
un titre de section n'active pas la lecture par erreur.

## Validation de cette révision

| Contrôle | Résultat |
| --- | --- |
| `npm test` | 20 tests réussis |
| `npm run test:browser` | 42 contrôles réussis, aucune erreur JavaScript |
| `npm run test:layout` | 85 contrôles réussis sur 8 tailles et les ressources séparées |
| `npm run test:baseline` | 9 champs identiques à la référence v2 après 1 000 pas |
| `npm run test:legacy` | 10 empreintes historiques intactes, 39 scripts rattachés au moteur historique, déterminisme à 200 pas |
| Comparaison des fichiers physiques v2 | 8 fichiers inchangés |

Tailles testées : 1440×1000, 1365×768, 1920×1080, 1024×768, 768×1024,
390×844, 320×568 et 844×390. Les tests couvrent le canvas carré, les bords
cliquables, les menus non tronqués, le défilement du panneau, les paramètres et
les bilans accessibles, l'absence de débordement horizontal et la navigation clavier.

Le parcours navigateur continue de calculer une vraie rivière, de contrôler le
creusement, les dépôts et les bilans, puis d'exporter/restaurer une sauvegarde.
Les captures et rapports JSON sont dans `tests/generated/design-validation/`.

Les anciennes données de recherche et de validation sont conservées. La longue
campagne physique de 46 500 pas de la livraison précédente n'a pas été relancée
pour cette révision d'interface ; elle n'est pas comptée comme une nouvelle exécution.
Les anciennes divergences de référence historique ne sont pas masquées.

### Limites de validation

Tests réalisés sous Chromium 144 dans le conteneur. Le HTML autonome est chargé
en mémoire. Les 20 ressources distinctes du point d'entrée multi-fichiers sont
chargées via interception locale, sans modifier leur contenu. La politique du
navigateur bloque la navigation vers localhost : aucune validation HTTP réelle
ni aucun double-clic Windows n'est revendiqué. Pas de test sur navigateur mobile
physique : les petites tailles sont des fenêtres Chromium redimensionnées.

## Fichiers livrés

Le projet complet contient le code, le HTML autonome régénéré, les tests et
la recherche existante. Le HTML autonome fonctionne sans ressources annexes.
Le format de sauvegarde demeure la version 2 ; aucune migration n'est nécessaire
pour les sauvegardes de la livraison finalisée.
