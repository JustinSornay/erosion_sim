# Finalisation de la simulation d'érosion

Version livrée : **2.0.0 / conservative-v2**. Date : 7 octobre 2026.

## 1. Ce qui est achevé

La livraison fournit une application autonome, manipulable et sauvegardable : une
source injecte de l'eau au point cliqué, cette eau suit le relief, transporte des
sédiments, creuse et dépose. Les bords ouverts exportent réellement de l'eau et des
sédiments. Les bilans ne sont pas déduits d'une animation : ils sont calculés sur
les champs du moteur.

Le socle initial a été conservé : grille de 192 x 192 cellules, générateur de
terrain naturel, architecture de flux entre cellules et rendu Canvas. Le transport,
les échanges et les conditions de bord ont été repris pour obtenir une version
cohérente. La rivière de démonstration utilise une vallée explicitement construite ;
le terrain naturel historique reste un choix distinct, testé lui aussi.

Cette finalisation concerne un **bac à sable de paysage**, pas l'étalonnage d'un
modèle hydrologique. Les conclusions numériques portent sur les scénarios exécutés,
non sur l'ensemble des terrains, paramètres ou durées imaginables.

## 2. Lecture de la phase de recherche

L'archive ne contenait pas seulement des essais de rendu. Elle suivait le trajet
de l'eau, le transport des solides, la localisation des échanges avec le lit,
les changements de chenal et les interactions entre le relief et les sources.
Des variantes de pente, capacité, talus, lissage et limitation locale avaient déjà
été explorées sans donner une correction générale.

Trois enseignements ont guidé la livraison.

**La conservation était un défaut réel.** L'advection semi-lagrangienne de la charge
solide ne garantissait pas le bilan terrain + sédiments. Les essais conservatifs
corrigeaient cette famille d'erreur, sans suffire à expliquer tout le comportement
morphologique. Les traces de très petits nombres négatifs et les essais de positivité
justifiaient aussi de revoir le traitement des cellules presque sèches.

**Le sens attendu de l'écoulement n'était pas une condition physique.** Le dernier
audit factoriel concluait : `INITIAL-FACTOR-AUDIT C - RAW TERRAIN KEEPS NORTH SIGN;
MOUTH STRONGLY AMPLIFIES`. Le relief brut conservait le signe nord, et la bouche de
source l'amplifiait. Un franchissement faible d'une section fixée au sud ne prouve
donc pas, à lui seul, un blocage hydraulique. Le nouveau test de rotation vérifie
que l'eau change de direction avec le relief ; aucun sens cardinal n'est imposé
par le code de source.

**La source et les limites altéraient l'expérience.** L'ancien dispositif déplaçait
l'injection vers une bouche distribuée et protégeait son voisinage. De plus, la
présence d'une dépression de terrain nommée exutoire ne rendait pas les bords du
solveur ouverts. Les nouvelles commandes correspondent désormais au calcul :
source ponctuelle à la cellule visée, pas de couronne rocheuse cachée, limites
ouvertes ou fermées choisies explicitement.

Les preuves historiques restent consultables, notamment :
`tests/generated/initial-routing-factorial-audit/summary.json`,
`tests/generated/source-routing-causal-freeze/summary.json`,
`tests/generated/source-relative-routing-audit/summary.json` et
`tests/generated/conservative-transport-positivity/summary.json`.
Les anciens marqueurs de fin et les sorties ne sont pas remplacés par un nouveau
récit. Le README historique, parfois en retard sur ces sorties, est archivé dans
`docs/HISTORIQUE_TESTS_V1.md`.

## 3. Décisions de moteur

### Transport et bilan de masse

Les champs physiques utilisent des Float64. Une interface entre deux cellules
porte un flux net, sans deux conduites opposées simultanées. La somme des débits
sortants est bornée par l'eau disponible chez le donneur. Une marge de quelques
unités de dernier bit évite qu'un arrondi produise un volume restant négatif.

Le transport des sédiments utilise **les mêmes transferts d'eau acceptés**. Les parts
sont débitées du donneur puis créditées aux voisins, ou comptabilisées à la
frontière. Le calcul porte sur des rapports de volumes bornés, plutôt que sur une
concentration s/d potentiellement gigantesque dans un film presque sec.
Il n'y a ni correction globale a posteriori, ni normalisation cachée du bilan.

Avec une aire de cellule A, les invariants observés sont :

```
W(t) = somme(d * A)
W_initial + injection + pluie = W(t) + eau_sortie + evaporation

S(t) = somme((b + s) * A)
S_initial = S(t) + sediments_sortis
```

L'évaporation retire de l'eau, pas de la matière solide. Les sédiments secs se
déposent. Des traces solides inférieures à 1e-24 sont aussi transférées au lit,
avec comptabilisation, pour ne pas entretenir des calculs subnormaux très coûteux.
Les films d'eau inférieurs à 1e-11 sont immobiles mais restent dans le stock : ils
ne sont pas effacés. Les inévitables arrondis de sommation restent mesurés.

### Échanges avec le terrain

L'érosion et le dépôt sont calculés depuis le même état du lit, puis appliqués
ensemble. Une cellule n'utilise donc pas la pente d'un voisin déjà modifié pendant
le balayage. Les taux sont liés au pas de temps par une relaxation exponentielle.
La capacité est proportionnelle à la lame d'eau et bornée en concentration.

Un substrat fixe, à 0,32 unité sous le terrain initial, borne la profondeur
érodable. C'est un choix explicite de stabilité et de comportement du bac à sable,
non une profondeur géologique mesurée. Le coefficient de frottement, les taux et
la capacité sont des paramètres de modèle non calibrés.

### Observation et commandes

Le rendu ne pilote pas la physique. Les traceurs donnent une indication visuelle
du mouvement, et D8 montre un potentiel de drainage : ni l'un ni l'autre ne sont
la preuve d'un transport réel. La vue Érosion / dépôts compare directement le lit
courant au lit initial avec une échelle de couleur fixe.

L'eau en couche mince a été rendue visible, les vecteurs sont une couche optionnelle,
et le relief utilise un ombrage sans texture granuleuse ajoutée. L'interface propose
quatre terrains, des graines reproductibles, la pluie, la pause, les bilans et
l'enregistrement complet. Une sauvegarde se valide avant toute mutation du terrain.
La reprise a été testée sur les champs physiques, pas seulement sur l'image.

Le temps est intégré par pas fixes de 0,017 seconde de modèle. La boucle abandonne
le retard d'horloge si la machine ne suit pas, sans sauter un calcul physique ni
grossir son pas. L'accélération effective est affichée distinctement de la demande.

## 4. Mesures effectuées

### Audit de l'ancien moteur

Le script `tests/diagnostics/legacy-baseline-audit.js` exécute la copie exacte du
moteur initial, terrain naturel de graine 314159265, source (48,48), débit 2,2.
Après 5 000 pas, le stock terrain + sédiments a augmenté de **32,7331989701 unités**,
sans apport solide externe. Il diminuait d'environ 0,4196723054 à 1 000 pas.

Au même couple graine/source, le moteur v2 à 5 000 pas présente un résidu solide
absolu d'environ **2,30e-11**, en tenant compte des sédiments sortis. Il exporte
125,2569 unités d'eau et 3,8206 unités solides. Les chiffres complets sont dans
`tests/generated/v2-validation/legacy-audit.json`.

Ce n'est **pas** une expérience où un seul paramètre varie : précision, sources,
limites, transport et échanges diffèrent entre v1 et v2. La comparaison établit le
respect d'un invariant, pas l'identité des paysages ni un étalonnage physique.

### Essais longs de v2

Les quatre scénarios totalisent 45 000 pas, auxquels s'ajoutent 1 500 pas pour
vérifier l'écoulement après coupure de la source de la vallée. Les bilans et champs
sont contrôlés aux points de mesure espacés de 1 000 pas.

| Scénario | Pas principaux | Résidu d'eau maximal | Résidu solide maximal | Cellules creusées / déposées hors source |
| --- | ---: | ---: | ---: | ---: |
| Vallée, une source, bords ouverts | 20000 | 2.172e-10 | 2.317e-10 | 3229 / 2142 |
| Terrain naturel historique, bords ouverts | 10000 | 5.107e-11 | 5.241e-11 | 2994 / 2779 |
| Terrain naturel, trois sources, bords fermés | 10000 | 2.667e-10 | 1.492e-10 | 6614 / 10748 |
| Cuvette sous pluie, bords fermés | 5000 | 6.558e-12 | 2.146e-10 | 27230 / 5865 |

Le comptage exclut un rayon de huit cellules autour de chaque source et impose
un changement de hauteur supérieur à 1e-5. Il évite de faire passer un simple trou
au point d'injection pour une rivière qui modèle le paysage. Les champs contrôlés
restent finis, l'eau et les sédiments non négatifs, le substrat respecté.
Le débit de sortie reste actif tard dans l'essai de vallée ; couper sa source diminue
le stock d'eau de plus de 10 % durant les 1 500 pas suivants.

Source des valeurs : `tests/generated/v2-validation/long-run.json`. Ces faibles
résidus absolus attestent une conservation numérique dans les cas exécutés. Ils
n'attestent pas, à eux seuls, la justesse géomorphologique du résultat.

### Tests de comportement et interface

Les 20 tests automatisés couvrent notamment le lac au repos, la rotation du relief,
les sources au centre/bords/coins, l'absence d'injection quand une source est
coupée, la pluie, les exportations, les très petits nombres, le substrat, le
déterminisme et une continuation identique après sauvegarde JSON.
Des contrôles séparés comparent aussi les neuf buffers à la référence v2.

Le parcours navigateur compte 28 contrôles : vrai clic au bon endroit, injection,
pause, édition de débit, activation/suppression, démonstration qui exporte/érode/dépose,
visibilité de l'eau, vues de diagnostic, fichier JSON téléchargé puis rechargé,
sauvegarde invalide, rejeu, options, clavier et panneau mobile.
Les erreurs JavaScript et les requêtes réseau sont collectées ; aucune n'a été
observée dans le parcours validé. Le rapport et les captures sont dans
`tests/generated/v2-validation/browser/`.

Les essais de calcul utilisent Node 22.16.0. Le parcours d'interface utilise
Chromium 144.0.7559.96 piloté par Playwright/Python 3.13.5. Dans cet environnement,
la politique du navigateur interdit la navigation directe vers `file://` et HTTP
local : le HTML autonome a donc été chargé en mémoire avec `page.set_content`.
L'application, son DOM, les événements et les calculs sont réels, non simulés.
L'ouverture par double-clic sur Windows n'a pas été testée ici ; ni Firefox ni
Safari n'ont fait l'objet d'une validation de cette livraison.

## 5. Préservation et références

La copie initiale du moteur est conservée dans `tests/fixtures/legacy-engine/`.
Son manifeste contient les empreintes SHA-256 des dix fichiers JS et le commit
`73b63e20b676273afb89f1d3e21ecc33a5157b0f`. Trente-neuf lanceurs historiques chargent
explicitement cette copie plutôt que le moteur v2. Leur logique expérimentale n'a
pas été réécrite, et l'ensemble des expériences historiques n'a pas été relancé.

Point important : les deux références binaires historiques N192 et N192-incoming-source
ne correspondent déjà pas au JS de l'archive reçue. L'audit retrouve un écart maximal
par valeur de 1191,2845458984375 à 1 000 pas. Ces fichiers restent inchangés ;
l'échec n'est pas caché par une régénération automatique.

La nouvelle référence `N192-conservative-v2` est séparée. Le test `test:legacy`
vérifie l'intégrité des archives, pas l'accord avec les anciens binaires ;
`audit:legacy` produit un diagnostic explicite de leurs divergences.
Le fichier `legacy-physics-regression.js` expose toujours cet échec avec une sortie
non nulle lorsqu'on le lance directement.

## 6. Limites et portée scientifique

Le moteur reste un modèle de hauteur avec conduites virtuelles, pas un solveur
complet des équations de Saint-Venant avec quantité de mouvement bidimensionnelle,
transport solide multi-granulométrique et validation terrain. Les conditions de
sortie sont simples. Le frottement et la capacité sont des choix de modèle ; la
résolution, le pas de temps et le substrat influencent les formes obtenues.
Aucune étude de convergence spatiale ou temporelle n'est revendiquée.

Il n'y a pas de chimie du calcaire, de fracture mécanique, de nappe souterraine,
de banque de propriétés de roches ni de conversion fiable vers des années ou des
mètres réels. Les anciennes pistes rejetées ne sont pas toutes résolues en tant
que questions de recherche : elles ne sont simplement plus nécessaires au contrat
du bac à sable livré, dont les choix et les tests sont maintenant explicites.

La finalisation établit une base utilisable, observable, reproductible et conservatrice
sur les essais publiés. Une extension scientifique devra s'appuyer sur des mesures
et des cas de référence, sans confondre une rivière visuellement plausible avec
une prévision validée.
