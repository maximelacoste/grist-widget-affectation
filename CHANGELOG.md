# Changelog

## [Non publié]

### Corrigé
- Les boutons « Précédent » / « Suivant » s'affichaient comme des carrés : `fr-btns-group` impose des règles d'icônes de groupe ; remplacé par un bloc flexible (`.step-nav`).
- Le texte « null » apparaissait sous la liste de recherche des établissements.
- Les icônes (flèches de navigation, loupe) s'affichaient comme des carrés pleins : les feuilles d'icônes du DSFR (`icons-arrows`, `icons-system`) n'étaient pas chargées.

### Ajouté
- Navigation entre les étapes : boutons « Précédent » et « Suivant », actifs seulement si l'étape visée est atteignable (recherche faite, élève choisi). Une nouvelle recherche désélectionne l'élève.

### Modifié
- `Affectation` : la liste déroulante devient un champ de recherche avec loupe (mots dans le désordre, sans accents, flèches/Entrée/Échap au clavier), plus adapté aux longues listes d'établissements.

## [0.1.0] - à publier

### Ajouté
- Recherche tolérante dans `Individus` (accents, casse, tirets).
- Création d'une fiche `Individus` avec garde anti-doublon sur la clé `Cle`.
- Liste, création et modification des lignes de `Scolarite` (repère « En cours »).
- Choix de `Niveau_saisi`, `Situation` et du libellé d'`Affectation` lus dans les métadonnées Grist.
- Tests de la normalisation (parité avec la formule Python de `Cle`), des dates et de la recherche.
