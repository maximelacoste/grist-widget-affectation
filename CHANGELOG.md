# Changelog

## [Non publié]

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
