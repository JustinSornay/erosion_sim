# Validation de la livraison 2.3.0

- `npm test` : **122 tests passants**, aucun échec ni test ignoré.
- Suite navigateur unifiée : **101 contrôles passants**, dont huit tailles de fenêtre.
- Audit de **576 générations aquatiques** (9 familles x 64 graines).
- Trois scènes avec pluie et sources configurées : **2 000 pas chacune**, soit 6 000 pas.
- Écart maximal de bilan sur ces essais longs : eau **6.348e-10**, solide **1.561e-10**.
- **108 grilles** des 18 anciens générateurs comparées à l'archive 2.2.0 : identiques octet par octet.
- Référence physique historique : les **9 buffers restent identiques à 1 000 pas**.
- Intégrité v1 : 10 empreintes JS inchangées, 39 lanceurs ancrés et déterminisme vérifié.
- HTML autonome reconstruit avec `npm run build:offline`.

## Ce qui a été contrôlé

Les mers et les lacs au repos, sans pluie, sources ni évaporation, ne déclenchent
pas d'écoulement parasite. Des déficits et excédents marins imposés déclenchent
les entrées et sorties attendues, qui figurent au bilan. L'eau reste non négative,
les sources sont sur terre et espacées, la pluie est stable par recette.
Les reprises JSON des scènes forcées conservent tous les champs, dont les flux marins.

L'interface conserve ses couleurs, propose uniquement le bouton de pluie et les
commandes simplifiées, gère la navigation, les sources, les imports invalides,
les deux vues et l'analyse secondaire. Les fichiers JSON sont réellement
téléchargés et rechargés par le champ fichier dans le navigateur de test.
Les aperçus sont capturés dans le vrai Canvas de l'application.

## Limites de cette validation

Chromium **144.0.7559.96** sous Linux, Node 22.16.0.
La politique du conteneur interdit `file://` et HTTP local : le vrai HTML autonome
est chargé en mémoire par Playwright. L'API de stockage est remplacée dans les tests
de cycle de vie par un adaptateur Storage. Ce n'est donc pas un test du stockage
natif des fichiers locaux ni du lancement par double-clic sous Windows.
Aucune politique d'administration n'a été modifiée. Aucune requête réseau observée.

Le registre npm n'étant pas résolvable ici, le bundle Lucide inchangé a été réutilisé
par le build hors ligne. Les nouveaux pictogrammes sont locaux et testés.
Les autres navigateurs et la recherche historique complète n'ont pas été relancés.
Les tests numériques ne constituent pas une validation géologique ou océanographique.

Les fichiers JSON et logs adjacents contiennent les mesures ; les répertoires
de résultats des versions précédentes restent explicitement historiques.
